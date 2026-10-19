import { test } from "node:test";
import assert from "node:assert/strict";
import { getAircraftNow } from "../netlify/lib/flights/live.mjs";
import { getAircraftFlights } from "../netlify/lib/flights/details.mjs";
import { memoryStore } from "../netlify/lib/flights/budget.mjs";
import { asRegistration, liveProgressPct } from "../public/js/flights.js";

const AIRPORTS = { LROP: { iata: "OTP", lat: 44.5711, lon: 26.085 }, EGLL: { iata: "LHR", lat: 51.4706, lon: -0.4619 } };
const airportByIcao = icao => AIRPORTS[icao] || null;
const now = Date.parse("2026-10-19T20:00:00Z");
const res = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function fakeFetch(ac) {
  const calls = [];
  const fn = async url => {
    calls.push(String(url));
    if (String(url).includes("/v2/reg/")) return res({ ac });
    if (String(url).includes("/routes/schema-01/T/TST-all.csv")) return res("Callsign,Code,Number,AirlineCode,AirportCodes\nTST1AB,TST,1AB,TST,LROP-EGLL\n");
    return res("", 404);
  };
  fn.calls = calls;
  return fn;
}

test("aircraft now: on the route's line -> route shown", async () => {
  const fetchImpl = fakeFetch([{ r: "YR-ASA", flight: "TST1AB  ", t: "A318", hex: "4a0000", alt_baro: 36000, gs: 450, lat: 48.6, lon: 13.6, seen: 1 }]);
  const { body } = await getAircraftNow("YR-ASA", { store: memoryStore(), now, fetchImpl, airportByIcao });
  assert.equal(body.aircraft.callsign, "TST1AB");
  assert.equal(body.route.from, "OTP");
  assert.equal(body.route.to, "LHR");
});

test("aircraft now: callsign's usual route but far off its line -> no route", async () => {
  const fetchImpl = fakeFetch([{ r: "YR-ASA", flight: "TST1AB", alt_baro: 36000, lat: 40.0, lon: 2.0, seen: 1 }]);
  const { body } = await getAircraftNow("YR-ASA", { store: memoryStore(), now, fetchImpl, airportByIcao });
  assert.equal(body.route, null);
  assert.match(body.routeNote, /not on that line/);
});

test("aircraft now: not transmitting -> no aircraft, stored for 2 minutes", async () => {
  const store = memoryStore();
  const fetchImpl = fakeFetch([]);
  const a = await getAircraftNow("YR-ASA", { store, now, fetchImpl, airportByIcao });
  assert.equal(a.body.aircraft, null);
  await getAircraftNow("YR-ASA", { store, now: now + 60000, fetchImpl, airportByIcao });
  assert.equal(fetchImpl.calls.length, 1);
});

test("aircraft flights: 2 units, newest first, past days kept", async () => {
  const store = memoryStore();
  let calls = 0;
  const raw = t => ({ number: "RO 391", status: "Arrived", airline: { name: "TAROM" }, departure: { airport: { iata: "OTP" }, scheduledTime: { utc: t + "Z", local: t + "+03:00" } }, arrival: { airport: { iata: "LHR" } } });
  const fetchImpl = async url => { calls++; assert.match(String(url), /\/flights\/reg\/YR-ASA\/2026-10-17\?dateLocalRole=Both/); return res([raw("2026-10-17 08:00"), raw("2026-10-17 15:00")]); };
  const a = await getAircraftFlights("YR-ASA", "2026-10-17", { key: "k", store, now, fetchImpl });
  assert.equal(a.body.status, "ok");
  assert.equal(a.body.flights.length, 2);
  assert.ok(a.body.flights[0].departure.scheduled.utc > a.body.flights[1].departure.scheduled.utc);
  // A past day: the stored copy is used a day later.
  await getAircraftFlights("YR-ASA", "2026-10-17", { key: "k", store, now: now + 86400000, fetchImpl });
  assert.equal(calls, 1);
});

test("registration in search: needs a hyphen or a US N-number", () => {
  assert.equal(asRegistration(" yr-asa "), "YR-ASA");
  assert.equal(asRegistration("N123AB"), "N123AB");
  assert.equal(asRegistration("D-AIZZ"), "D-AIZZ");
  assert.equal(asRegistration("OTP"), null);
  assert.equal(asRegistration("Heathrow"), null);
  assert.equal(asRegistration("NYC"), null);
});

test("live progress from the position", () => {
  assert.equal(liveProgressPct({ lat: 44.5711, lon: 26.085 }, AIRPORTS.LROP, AIRPORTS.EGLL), 0);
  const mid = liveProgressPct({ lat: 48.6, lon: 13.6 }, AIRPORTS.LROP, AIRPORTS.EGLL);
  assert.ok(mid > 35 && mid < 65, String(mid));
  assert.equal(liveProgressPct({ lat: null, lon: null }, AIRPORTS.LROP, AIRPORTS.EGLL), null);
});
