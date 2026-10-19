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
  assert.deepEqual(config.path, ["/api/aircraft-photo/:reg", "/api/aircraft-now/:reg", "/api/live/:callsign", "/api/identify/:airline/:number/:from/:to/:lat/:lon"]);
  let res = await handler(new Request("http://x/api/aircraft-photo/bad%20reg"), { params: { reg: "bad reg" } });
  assert.equal(res.status, 400);
  res = await handler(new Request("http://x/api/live/x"), { params: { callsign: "x" } });
  assert.equal(res.status, 400);
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


test("flight number digits for the identify request", async () => {
  const { flightDigits } = await import("../public/js/flights.js");
  assert.equal(flightDigits({ number: "LO 646" }), "646");
  assert.equal(flightDigits({ number: "W4 0346" }), "346");
  assert.equal(flightDigits({ number: "BA 48A" }), "48A");
  assert.equal(flightDigits({ number: "—" }), "-");
});



test("on the route's line: geometry", async () => {
  const { onRoute } = await import("../netlify/lib/flights/live.mjs");
  const OTPg = { lat: 44.57, lon: 26.08 }, VLCg = { lat: 39.49, lon: -0.48 };
  assert.equal(onRoute({ lat: 44.4, lon: 24.0 }, OTPg, VLCg).ok, true, "west of OTP on the way to VLC");
  assert.equal(onRoute({ lat: 47.0, lon: 28.8 }, OTPg, VLCg).ok, false, "Chisinau area: not on OTP-VLC");
  assert.equal(onRoute({ lat: 44.575, lon: 26.09 }, OTPg, VLCg).ok, true, "at OTP");
});

// ---------- identify by airline + route (VRS standing data CSV files, mocked) ----------
const ROUTES_WMT = "﻿Callsign,Code,Number,AirportCodes,AirportCodes\n".replace("AirportCodes,AirportCodes", "AirlineCode,AirportCodes")
  + "WMT1LH,WMT,1LH,WMT,LROP-LEVC\nWMT367,WMT,367,WMT,LLBG-LROP\nWMT3FJ,WMT,3FJ,WMT,LIPE-LUKK\nWMT515N,WMT,515N,WMT,LRCL-LIRF\nWMT3185,WMT,3185,WMT,LROP-LEBL\nWMTX,WMT,X,WMT,LROP-LOWW-EGLL\n";
const AIRLINES = "Code,Name,ICAO,IATA,PositioningFlightPattern,CharterFlightPattern\nWMT,Wizz Air Malta,WMT,W4,,\nHYS,HiSky Europe,HYS,H4,,\nIIN,Inter Islands Airlines,IIN,H4,,\nH4,Heli Securite,,H4,,\nLOT,LOT Polish Airlines,LOT,LO,,\n";
const ICAO2IATA = { LROP: "OTP", LEVC: "VLC", LLBG: "TLV", LIPE: "BLQ", LUKK: "RMO", LRCL: "CLJ", LIRF: "FCO", LEBL: "BCN", EPWA: "WAW" };
const iataForIcao = c => ICAO2IATA[c] || null;
const OTPp = { lat: 44.57, lon: 26.08 }, VLCp = { lat: 39.49, lon: -0.48 }, TLVp = { lat: 32.01, lon: 34.89 }, WAWp = { lat: 52.17, lon: 20.97 };
const text = (body, status = 200) => new Response(body, { status });
function standing(near, files, calls = []) {
  return async url => {
    calls.push(url);
    if (url.includes("/v2/point/")) return ok(near);
    const m = /standing-data\/main\/(.+)$/.exec(url);
    if (m && files[m[1]] !== undefined) return files[m[1]] instanceof Response ? files[m[1]] : text(files[m[1]]);
    if (m) return text("404: Not Found", 404);
    throw new Error("unexpected " + url);
  };
}

test("standing data CSV parsing", async () => {
  const { parseRoutesCsv, parseAirlinesCsv } = await import("../netlify/lib/flights/live.mjs");
  const r = parseRoutesCsv(ROUTES_WMT);
  assert.equal(r.WMT1LH, "LROP-LEVC");
  assert.equal(r.WMTX, undefined, "routes with stops are left out");
  const a = parseAirlinesCsv(AIRLINES);
  assert.deepEqual(a.W4, ["WMT"]);
  assert.deepEqual(a.H4, ["HYS", "IIN"], "an IATA code used by two airlines gives both");
});

test("identify: the one aircraft of this airline on exactly this route, from the open route files", async () => {
  const { identifyFlight } = await import("../netlify/lib/flights/live.mjs");
  const near = { ac: [
    { flight: "WMT3FJ  ", r: "9H-A", t: "A21N", alt_baro: 30000, lat: 46.9, lon: 28.5 },   // BLQ-RMO, near Chisinau: off the line
    { flight: "WMT515N ", r: "9H-B", t: "A21N", alt_baro: 30000, lat: 46.6, lon: 23.5 },   // CLJ-FCO: off the line
    { flight: "WMT1LH  ", r: "HA-LXP", t: "A321", alt_baro: 18000, lat: 44.5, lon: 24.6 }, // OTP-VLC, on the line
  ] };
  const calls = [];
  const f = standing(near, { "routes/schema-01/W/WMT-all.csv": ROUTES_WMT }, calls);
  const store = memoryStore();
  const r = await identifyFlight({ airline: "WMT", number: "3185", from: "OTP", to: "VLC", lat: 44.57, lon: 26.08, fromPos: OTPp, toPos: VLCp }, { store, now: NOW, fetchImpl: f, iataForIcao });
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.aircraft.registration, "HA-LXP");
  assert.deepEqual(r.body.checked, [{ callsign: "WMT1LH", route: "OTP-VLC" }], "off-line aircraft are not even checked");
  assert.equal(calls.filter(u => u.includes("adsb.lol")).length, 1, "one adsb.lol call");
  // The route file is kept for a day: a second flight doesn't download it again.
  await identifyFlight({ airline: "WMT", number: "-", from: "TLV", to: "OTP", lat: 44.57, lon: 26.08, fromPos: TLVp, toPos: OTPp }, { store, now: NOW + 3600000, fetchImpl: f, iataForIcao });
  assert.equal(calls.filter(u => u.includes("WMT-all.csv")).length, 1);
});

test("identify: callsign = airline ICAO + our number counts when the route is unknown; a known route that contradicts wins", async () => {
  const { identifyFlight } = await import("../netlify/lib/flights/live.mjs");
  const near = { ac: [{ flight: "LOT646  ", r: "SP-LVT", t: "B38M", alt_baro: 3375, lat: 44.6, lon: 26.0 }] };
  const noFile = standing(near, {});
  let r = await identifyFlight({ airline: "LOT", number: "646", from: "WAW", to: "OTP", lat: 44.57, lon: 26.08, fromPos: WAWp, toPos: OTPp }, { store: memoryStore(), now: NOW, fetchImpl: noFile, iataForIcao });
  assert.equal(r.body.aircraft.registration, "SP-LVT");
  assert.equal(r.body.aircraft.route.byNumber, true);
  const other = standing(near, { "routes/schema-01/L/LOT-all.csv": "Callsign,Code,Number,AirlineCode,AirportCodes\nLOT646,LOT,646,LOT,EPWA-LRCL\n" });
  r = await identifyFlight({ airline: "LOT", number: "646", from: "WAW", to: "OTP", lat: 44.57, lon: 26.08, fromPos: WAWp, toPos: OTPp }, { store: memoryStore(), now: NOW, fetchImpl: other, iataForIcao: c => ({ ...ICAO2IATA, LRCL: "CLJ" })[c] });
  assert.equal(r.body.aircraft, null, "the route file says WAW-CLJ, not WAW-OTP");
});

test("identify: an IATA airline code tries every airline that uses it; two matches are not trusted", async () => {
  const { identifyFlight } = await import("../netlify/lib/flights/live.mjs");
  const near = { ac: [
    { flight: "HYS482  ", r: "ER-SKY", t: "A319", alt_baro: 9025, lat: 44.8, lon: 26.4 },
    { flight: "WMT367  ", r: "HA-LGI", t: "A21N", alt_baro: 13000, lat: 44.0, lon: 27.5 },
  ] };
  const files = { "airlines/schema-01/airlines.csv": AIRLINES, "routes/schema-01/H/HYS-all.csv": "Callsign,Code,Number,AirlineCode,AirportCodes\nHYS482,HYS,482,HYS,LUKK-LROP\n" };
  const r = await identifyFlight({ airline: "H4", number: "482", from: "RMO", to: "OTP", lat: 44.57, lon: 26.08, fromPos: { lat: 46.93, lon: 28.93 }, toPos: OTPp }, { store: memoryStore(), now: NOW, fetchImpl: standing(near, files), iataForIcao });
  assert.deepEqual(r.body.airlines, ["HYS", "IIN"]);
  assert.equal(r.body.aircraft.registration, "ER-SKY");
  const unknown = await identifyFlight({ airline: "Q9", number: "1", from: "RMO", to: "OTP", lat: 44.57, lon: 26.08 }, { store: memoryStore(), now: NOW, fetchImpl: standing(near, files), iataForIcao });
  assert.equal(unknown.body.airlineUnknown, true);
  // Two aircraft on the same route: none.
  const twin = { ac: [near.ac[1], { ...near.ac[1], flight: "WMT368  ", r: "HA-LGJ" }] };
  const twinRoutes = "Callsign,Code,Number,AirlineCode,AirportCodes\nWMT367,WMT,367,WMT,LLBG-LROP\nWMT368,WMT,368,WMT,LLBG-LROP\n";
  const t = await identifyFlight({ airline: "WMT", number: "-", from: "TLV", to: "OTP", lat: 44.57, lon: 26.08, fromPos: TLVp, toPos: OTPp }, { store: memoryStore(), now: NOW, fetchImpl: standing(twin, { "routes/schema-01/W/WMT-all.csv": twinRoutes }), iataForIcao });
  assert.equal(t.body.aircraft, null);
  assert.equal(t.body.matches, 2);
});

test("identify: if GitHub fails, an older stored route file is used; with none, a clear error", async () => {
  const { identifyFlight, ROUTES_FRESH_MS } = await import("../netlify/lib/flights/live.mjs");
  const near = { ac: [{ flight: "WMT367  ", r: "HA-LGI", t: "A21N", alt_baro: 13000, lat: 44.0, lon: 27.5 }] };
  const store = memoryStore();
  const q = { airline: "WMT", number: "-", from: "TLV", to: "OTP", lat: 44.57, lon: 26.08, fromPos: TLVp, toPos: OTPp };
  await identifyFlight(q, { store, now: NOW, fetchImpl: standing(near, { "routes/schema-01/W/WMT-all.csv": ROUTES_WMT }), iataForIcao });
  const down = standing(near, { "routes/schema-01/W/WMT-all.csv": text("busy", 503) });
  let r = await identifyFlight(q, { store, now: NOW + ROUTES_FRESH_MS + 1, fetchImpl: down, iataForIcao });
  assert.equal(r.body.aircraft.registration, "HA-LGI", "older copy used");
  r = await identifyFlight(q, { store: memoryStore(), now: NOW, fetchImpl: down, iataForIcao });
  assert.equal(r.body.status, "error");
  assert.match(r.body.notice, /^Route data \(GitHub\)/);
});

test("type check: a swap within the family is fine, another family is a conflict", async () => {
  const { typeConflicts, typeDiffers } = await import("../public/js/flights.js");
  assert.equal(typeConflicts("A321", "Airbus A320"), false, "A321 for a planned A320: same family");
  assert.equal(typeDiffers("A321", "Airbus A320"), true);
  assert.equal(typeConflicts("A21N", "Airbus A320 NEO"), false);
  assert.equal(typeConflicts("B38M", "Boeing 737-800"), false);
  assert.equal(typeConflicts("E195", "Embraer 190"), false);
  assert.equal(typeConflicts("B738", "Airbus A320"), true, "737 for an A320: conflict");
  assert.equal(typeConflicts("AT76", "Airbus A320"), true);
  assert.equal(typeConflicts("A320", "Airbus A320"), false);
  assert.equal(typeDiffers("A320", "Airbus A320"), false);
  assert.equal(typeConflicts("ZZZZ", "Airbus A320"), false, "unknown code: no conflict claimed");
});

test("live fields say altitude, speed and climb in plain words", async () => {
  const { liveFields } = await import("../public/js/flights.js");
  assert.deepEqual(liveFields({ onGround: false, altitudeFt: 10475, groundSpeedKt: 271, verticalRateFpm: 1216 }),
    [["ALTITUDE", "10,475 ft · 3,193 m"], ["GROUND SPEED", "271 kt · 502 km/h"], ["VERTICAL", "Climbing 1,200 ft/min"]]);
  assert.equal(liveFields({ onGround: false, altitudeFt: 37000, groundSpeedKt: 450, verticalRateFpm: 0 })[0][1], "37,000 ft · 11,278 m (FL370)");
  assert.equal(liveFields({ onGround: false, altitudeFt: 37000, groundSpeedKt: 450, verticalRateFpm: 64 })[2][1], "Level");
  assert.equal(liveFields({ onGround: false, altitudeFt: 1175, groundSpeedKt: 128, verticalRateFpm: -576 })[2][1], "Descending 600 ft/min");
  assert.equal(liveFields({ onGround: true, altitudeFt: null, groundSpeedKt: 7, verticalRateFpm: null })[0][1], "On the ground");
  const { normalizeAdsb } = await import("../netlify/lib/flights/live.mjs");
  assert.equal(normalizeAdsb({ flight: "X", r: "Y", alt_baro: 23750, gs: 420.6, baro_rate: 1216 }, NOW).verticalRateFpm, 1216);
});

test("not-found message: turboprops get the plain explanation, service problems keep their wording", async () => {
  const { notFoundMessage } = await import("../public/js/flights.js");
  const ATR = "Aircraft not visible in live ADS-B data (some aircraft, e.g. older ATR 72s, don't broadcast their position)";
  assert.equal(notFoundMessage("ATR 72", "checked ROT648P CLJ-OTP; none on OTP–SCV"), ATR);
  assert.equal(notFoundMessage("ATR 72-500", "no ROT aircraft within 250 nm (80 aircraft seen)"), ATR);
  assert.equal(notFoundMessage("De Havilland Canada Dash 8-400", ""), ATR);
  assert.equal(notFoundMessage("Airbus A320", "checked WMT3FJ BLQ-RMO; none on OTP–VLC"), "Aircraft not found in live ADS-B data: checked WMT3FJ BLQ-RMO; none on OTP–VLC");
  assert.equal(notFoundMessage("ATR 72", "Live aircraft lookups are used up for today."), "Aircraft not found in live ADS-B data: Live aircraft lookups are used up for today.");
  assert.equal(notFoundMessage("ATR 72", "adsb.lol is busy (too many requests)"), "Aircraft not found in live ADS-B data: adsb.lol is busy (too many requests)");
  assert.equal(notFoundMessage(null, ""), "Aircraft not found in live ADS-B data");
});
