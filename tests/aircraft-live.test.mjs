import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlanespotters, normalizeAdsb, getAircraftPhoto, getLiveAircraft, PHOTO_FRESH_MS, LIVE_FRESH_MS, UA } from "../netlify/lib/flights/live.mjs";
import { memoryStore } from "../netlify/lib/flights/budget.mjs";
import handler, { config } from "../netlify/functions/aircraft-live.mjs";
import { callsignFor, typeMatches, liveLine } from "../public/js/flights.js";

// Shapes as returned by the real services on 2026-10-19 (values trimmed).
const PS = { photos: [{ id: "1772532", thumbnail: { src: "https://t.plnspttrs.net/00534/1772532_c1a5efbc72_t.jpg", size: { width: 200, height: 113 } }, thumbnail_large: { src: "https://t.plnspttrs.net/00534/1772532_c1a5efbc72_280.jpg", size: { width: 498, height: 280 } }, link: "https://www.planespotters.net/photo/1772532/yr-asa-tarom-airbus-a318-111?utm_source=api", photographer: "Tekler Zsolt" }] };
const ADSB = { ac: [{ hex: "76cd79", flight: "SIA326  ", r: "9V-SKY", t: "A388", alt_baro: 40000, gs: 467.2, seen: 2 }], msg: "No error" };
const NOW = Date.parse("2026-10-19T15:30:00Z");
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
function fakeFetch(answer) {
  const f = async (url, opts) => { f.calls.push({ url, opts }); return typeof answer === "function" ? answer(url) : answer; };
  f.calls = [];
  return f;
}

test("Planespotters answer becomes a credited photo of this aircraft", () => {
  const p = normalizePlanespotters(PS);
  assert.equal(p.url, "https://t.plnspttrs.net/00534/1772532_c1a5efbc72_280.jpg");
  assert.equal(p.author, "Tekler Zsolt");
  assert.match(p.pageUrl, /^https:\/\/www\.planespotters\.net\/photo\/1772532\//);
  assert.equal(p.kind, "planespotters");
  assert.equal(normalizePlanespotters({ photos: [] }), null);
  assert.equal(normalizePlanespotters({ photos: [{ thumbnail_large: { src: "http://insecure/x.jpg" } }] }), null, "only https images");
});

test("adsb.lol record: altitude, ground, speed", () => {
  const a = normalizeAdsb(ADSB.ac[0], NOW);
  assert.deepEqual([a.registration, a.typeCode, a.callsign, a.onGround, a.altitudeFt, a.groundSpeedKt], ["9V-SKY", "A388", "SIA326", false, 40000, 467]);
  assert.equal(a.seenAt, "2026-10-19T15:29:58.000Z");
  const g = normalizeAdsb({ flight: "DLH8VC", r: "D-AIUG", t: "A320", alt_baro: "ground", gs: 0 }, NOW);
  assert.equal(g.onGround, true);
  assert.equal(g.altitudeFt, null);
});

test("photo lookup is stored 7 days (also 'no photo') and identifies the app", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => ok(PS));
  let r = await getAircraftPhoto("YR-ASA", { store, now: NOW, fetchImpl: f });
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.photo.author, "Tekler Zsolt");
  assert.equal(f.calls[0].url, "https://api.planespotters.net/pub/photos/reg/YR-ASA");
  assert.equal(f.calls[0].opts.headers["User-Agent"], UA);
  await getAircraftPhoto("YR-ASA", { store, now: NOW + PHOTO_FRESH_MS - 1000, fetchImpl: f });
  assert.equal(f.calls.length, 1);
  const none = fakeFetch(() => ok({ photos: [] }));
  r = await getAircraftPhoto("YR-NONE", { store, now: NOW, fetchImpl: none });
  assert.equal(r.body.photo, null);
  await getAircraftPhoto("YR-NONE", { store, now: NOW + 3600000, fetchImpl: none });
  assert.equal(none.calls.length, 1);
});

test("live lookup: exactly one aircraft with exactly this callsign, stored 5 minutes", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => ok(ADSB));
  let r = await getLiveAircraft("SIA326", { store, now: NOW, fetchImpl: f });
  assert.equal(r.body.aircraft.registration, "9V-SKY");
  assert.equal(f.calls[0].url, "https://api.adsb.lol/v2/callsign/SIA326");
  await getLiveAircraft("SIA326", { store, now: NOW + LIVE_FRESH_MS - 1000, fetchImpl: f });
  assert.equal(f.calls.length, 1);
  const two = fakeFetch(() => ok({ ac: [ADSB.ac[0], { ...ADSB.ac[0], r: "9V-SKA" }] }));
  r = await getLiveAircraft("SIA326", { store: memoryStore(), now: NOW, fetchImpl: two });
  assert.equal(r.body.aircraft, null, "two aircraft with one callsign: not trusted");
  const other = fakeFetch(() => ok({ ac: [{ ...ADSB.ac[0], flight: "SIA3260" }] }));
  r = await getLiveAircraft("SIA326", { store: memoryStore(), now: NOW, fetchImpl: other });
  assert.equal(r.body.aircraft, null, "a different callsign is not this flight");
});

test("live lookup respects the daily cap and reports errors without failing", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => ok(ADSB));
  await getLiveAircraft("SIA326", { store, now: NOW, fetchImpl: f, dailyCap: 1 });
  const r = await getLiveAircraft("BAW12", { store, now: NOW, fetchImpl: f, dailyCap: 1 });
  assert.equal(r.body.status, "quota");
  assert.equal(f.calls.length, 1);
  const busy = fakeFetch(() => new Response("{}", { status: 429 }));
  const e = await getLiveAircraft("SIA326", { store: memoryStore(), now: NOW, fetchImpl: busy });
  assert.equal(e.body.status, "error");
  assert.match(e.body.notice, /adsb\.lol is busy/);
});

test("callsign: provider's own is trusted, a guessed one needs a matching aircraft type", () => {
  assert.deepEqual(callsignFor({ callSign: "WZZ3185", number: "W4 3185", airline: { icao: "WMT" } }), { callsign: "WZZ3185", fromProvider: true });
  assert.deepEqual(callsignFor({ callSign: null, number: "W4 3185", airline: { icao: "WMT" } }), { callsign: "WMT3185", fromProvider: false });
  assert.deepEqual(callsignFor({ callSign: null, number: "RO 0391", airline: { icao: "ROT" } }), { callsign: "ROT391", fromProvider: false });
  assert.equal(callsignFor({ callSign: null, number: "W4 3185", airline: { icao: null } }), null);
  assert.equal(typeMatches("A21N", "Airbus A321 NEO"), true);
  assert.equal(typeMatches("B38M", "Boeing 737 MAX 8"), true);
  assert.equal(typeMatches("A320", "Airbus A321"), false);
  assert.equal(typeMatches("E75L", "Embraer 175"), true);
  assert.equal(typeMatches("ZZZZ", "Airbus A320"), false, "unknown type code: no match");
  assert.equal(typeMatches("A320", null), false, "no board type: no match");
});

test("live line", () => {
  assert.equal(liveLine({ onGround: true }), "On the ground");
  assert.equal(liveLine({ onGround: false, altitudeFt: 40000, groundSpeedKt: 467 }), "FL400 · 467 kt");
  assert.equal(liveLine({ onGround: false, altitudeFt: 4500, groundSpeedKt: 180 }), "4,500 ft · 180 kt");
});

test("function: routes and input checks", async () => {
  assert.deepEqual(config.path, ["/api/aircraft-photo/:reg", "/api/live/:callsign", "/api/identify/:airline/:number/:from/:to/:lat/:lon"]);
  let res = await handler(new Request("http://x/api/aircraft-photo/bad%20reg"), { params: { reg: "bad reg" } });
  assert.equal(res.status, 400);
  res = await handler(new Request("http://x/api/live/x"), { params: { callsign: "x" } });
  assert.equal(res.status, 400);
});

test("route match: one aircraft of this airline on exactly this route; unknown routes are not errors", async () => {
  const { identifyFlight, normalizeRoute } = await import("../netlify/lib/flights/live.mjs");
  assert.deepEqual(normalizeRoute({ _airport_codes_iata: "OTP-VLC", airline_code: "WMT", plausible: true }), { from: "OTP", to: "VLC", airline: "WMT", plausible: true });
  assert.equal(normalizeRoute({ _airport_codes_iata: "OTP-VIE-CDG" }), null, "multi-leg routes are not used");
  const near = { ac: [
    { flight: "WMT1LH  ", r: "HA-LXP", t: "A321", alt_baro: 18500, gs: 300, lat: 44.9, lon: 25.5 },
    { flight: "WMT5CS  ", r: "9H-WDG", t: "A21N", alt_baro: 3650, gs: 200, lat: 44.6, lon: 26.2 },
    { flight: "WMT7003 ", r: "HA-LYA", t: "A21N", alt_baro: 35000, gs: 450, lat: 47.2, lon: 21.8 },
    { flight: "ROT276H ", r: "YR-ATL", t: "AT76", alt_baro: 8275, gs: 250, lat: 44.4, lon: 26.0 },
  ] };
  const routes = { WMT1LH: { _airport_codes_iata: "OTP-VLC", plausible: true }, WMT5CS: { _airport_codes_iata: "MXP-OTP", plausible: true } };
  const f = async url => {
    if (url.includes("/v2/point/")) return ok(near);
    const cs = /route\/([A-Z0-9]+)\//.exec(url)[1];
    return routes[cs] ? ok(routes[cs]) : new Response("Internal Server Error", { status: 500 });
  };
  let r = await identifyFlight({ airline: "WMT", from: "OTP", to: "VLC", lat: 44.57, lon: 26.08 }, { store: memoryStore(), now: NOW, fetchImpl: f });
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.aircraft.registration, "HA-LXP");
  assert.equal(r.body.candidates, 3, "only this airline's aircraft are checked");
  r = await identifyFlight({ airline: "WMT", from: "OTP", to: "BCN", lat: 44.57, lon: 26.08 }, { store: memoryStore(), now: NOW, fetchImpl: f });
  assert.equal(r.body.aircraft, null, "no aircraft on this route");
  // Two aircraft claiming the same route: none is trusted.
  routes.WMT7003 = { _airport_codes_iata: "OTP-VLC", plausible: true };
  r = await identifyFlight({ airline: "WMT", from: "OTP", to: "VLC", lat: 44.57, lon: 26.08 }, { store: memoryStore(), now: NOW, fetchImpl: f });
  assert.equal(r.body.aircraft, null);
  assert.equal(r.body.matches, 2);
});

test("estimated position follows the route by the flight's own times", async () => {
  const { estimatedPosition, greatCirclePoint } = await import("../public/js/insights.js");
  const OTPc = { lat: 44.57, lon: 26.08 }, VLCc = { lat: 39.49, lon: -0.48 };
  const fl = { departure: { scheduled: { utc: "2026-10-19T15:00Z" } }, arrival: { scheduled: { utc: "2026-10-19T19:00Z" } } };
  const start = estimatedPosition(fl, OTPc, VLCc, Date.parse("2026-10-19T14:00Z"));
  assert.ok(Math.abs(start.lat - 44.57) < 1e-6 && Math.abs(start.lon - 26.08) < 1e-6, "before departure: at the origin");
  const end = estimatedPosition(fl, OTPc, VLCc, Date.parse("2026-10-19T20:00Z"));
  assert.ok(Math.abs(end.lat - 39.49) < 1e-6 && Math.abs(end.lon + 0.48) < 1e-6, "after arrival: at the destination");
  const mid = greatCirclePoint(OTPc, VLCc, 0.5);
  assert.ok(mid.lat > 39.49 && mid.lat < 46 && mid.lon > -0.48 && mid.lon < 26.08, JSON.stringify(mid));
});

test("callsign equal to airline ICAO + our flight number counts even when the route is unknown", async () => {
  const { identifyFlight } = await import("../netlify/lib/flights/live.mjs");
  const near = { ac: [
    { flight: "LOT646  ", r: "SP-LVT", t: "B38M", alt_baro: 3375, gs: 200, lat: 44.6, lon: 26.0 },
    { flight: "LOT4JH  ", r: "SP-LND", t: "E195", alt_baro: 36000, gs: 450, lat: 45.5, lon: 24.0 },
  ] };
  const f = async url => url.includes("/v2/point/") ? ok(near) : new Response("Internal Server Error", { status: 500 });
  let r = await identifyFlight({ airline: "LOT", number: "646", from: "WAW", to: "OTP", lat: 44.57, lon: 26.08 }, { store: memoryStore(), now: NOW, fetchImpl: f });
  assert.equal(r.body.aircraft.registration, "SP-LVT");
  assert.equal(r.body.aircraft.route.byNumber, true);
  r = await identifyFlight({ airline: "LOT", number: "647", from: "OTP", to: "WAW", lat: 44.57, lon: 26.08 }, { store: memoryStore(), now: NOW, fetchImpl: f });
  assert.equal(r.body.aircraft, null, "a different number is not this flight");
  // A known route that contradicts wins over the number.
  const g = async url => url.includes("/v2/point/") ? ok(near) : ok({ _airport_codes_iata: "WAW-CLJ", plausible: true });
  r = await identifyFlight({ airline: "LOT", number: "646", from: "WAW", to: "OTP", lat: 44.57, lon: 26.08 }, { store: memoryStore(), now: NOW, fetchImpl: g });
  assert.equal(r.body.aircraft, null);
});

test("flight number digits for the identify request", async () => {
  const { flightDigits } = await import("../public/js/flights.js");
  assert.equal(flightDigits({ number: "LO 646" }), "646");
  assert.equal(flightDigits({ number: "W4 0346" }), "346");
  assert.equal(flightDigits({ number: "BA 48A" }), "48A");
  assert.equal(flightDigits({ number: "—" }), "-");
});

test("only aircraft on the route's line (or at an airport) are checked", async () => {
  const { identifyFlight, onRoute } = await import("../netlify/lib/flights/live.mjs");
  const OTPp = { lat: 44.57, lon: 26.08 }, VLCp = { lat: 39.49, lon: -0.48 };
  assert.equal(onRoute({ lat: 44.4, lon: 24.0 }, OTPp, VLCp).ok, true, "west of OTP on the way to VLC");
  assert.equal(onRoute({ lat: 47.0, lon: 28.8 }, OTPp, VLCp).ok, false, "Chisinau area: not on OTP-VLC");
  assert.equal(onRoute({ lat: 44.575, lon: 26.09 }, OTPp, VLCp).ok, true, "at OTP");
  const near = { ac: [
    { flight: "WMT3FJ  ", r: "9H-A", t: "A21N", alt_baro: 30000, lat: 46.9, lon: 28.5 },   // BLQ-RMO, near Chisinau
    { flight: "WMT515N ", r: "9H-B", t: "A21N", alt_baro: 30000, lat: 46.6, lon: 23.5 },   // CLJ-FCO, north
    { flight: "WMT969  ", r: "9H-C", t: "A321", alt_baro: 30000, lat: 42.0, lon: 20.0 },   // far south-west
    { flight: "WMT1LH  ", r: "HA-LXP", t: "A321", alt_baro: 18000, lat: 44.5, lon: 24.6 }, // on the OTP-VLC line
  ] };
  const routes = { WMT1LH: "OTP-VLC", WMT3FJ: "BLQ-RMO", WMT515N: "CLJ-FCO", WMT969: "TIA-TRF" };
  const asked = [];
  const f = async url => {
    if (url.includes("/v2/point/")) return ok(near);
    const cs = /route\/([A-Z0-9]+)\//.exec(url)[1]; asked.push(cs);
    return ok({ _airport_codes_iata: routes[cs], plausible: true });
  };
  const r = await identifyFlight({ airline: "WMT", number: "3185", from: "OTP", to: "VLC", lat: 44.57, lon: 26.08, fromPos: OTPp, toPos: VLCp }, { store: memoryStore(), now: NOW, fetchImpl: f });
  assert.equal(r.body.aircraft.registration, "HA-LXP");
  assert.deepEqual(asked, ["WMT1LH"], "off-route aircraft are not looked up");
});

test("a momentary 500 from the route service is asked again; 'unknown' is kept only 20 minutes", async () => {
  const { identifyFlight, UNKNOWN_ROUTE_FRESH_MS } = await import("../netlify/lib/flights/live.mjs");
  const near = { ac: [{ flight: "WMT367  ", r: "HA-LGI", t: "A21N", alt_baro: 13000, lat: 44.6, lon: 26.0 }] };
  let routeCalls = 0, fail = true;
  const f = async url => {
    if (url.includes("/v2/point/")) return ok(near);
    routeCalls++;
    if (fail) { fail = false; return new Response("Internal Server Error", { status: 500 }); }
    return ok({ _airport_codes_iata: "TLV-OTP", plausible: true });
  };
  const q = { airline: "WMT", number: "-", from: "TLV", to: "OTP", lat: 44.57, lon: 26.08 };
  const r = await identifyFlight(q, { store: memoryStore(), now: NOW, fetchImpl: f });
  assert.equal(r.body.aircraft.registration, "HA-LGI", "second try found the route");
  assert.equal(routeCalls, 2);
  // Always unknown: stored, but asked again after 20 minutes.
  const store = memoryStore(); let calls = 0;
  const g = async url => url.includes("/v2/point/") ? ok(near) : (calls++, new Response("x", { status: 500 }));
  await identifyFlight(q, { store, now: NOW, fetchImpl: g });
  const before = calls;
  await identifyFlight(q, { store, now: NOW + 5 * 60000, fetchImpl: g });
  assert.equal(calls, before, "within 20 minutes: not asked again");
  await identifyFlight(q, { store, now: NOW + UNKNOWN_ROUTE_FRESH_MS + 60000, fetchImpl: g });
  assert.ok(calls > before, "after 20 minutes: asked again");
});
