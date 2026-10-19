import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAircraft, manufacturerOf } from "../netlify/lib/flights/aerodatabox.mjs";
import { getAircraft, getFlightStatus, AIRCRAFT_FRESH_MS, STATUS_FRESH_MS, isRegistration, isFlightNumber } from "../netlify/lib/flights/details.mjs";
import { memoryStore, readUsage, UNITS } from "../netlify/lib/flights/budget.mjs";
import { getBoard } from "../netlify/lib/flights/board.mjs";
import handler, { config } from "../netlify/functions/flight-details.mjs";

// SYNTHETIC aircraft record written by hand to match the AeroDataBox spec (AircraftContract). Not a real aircraft.
const AIRCRAFT = {
  id: 1, reg: "YR-TST", active: true, serial: "12345", hexIcao: "4A0000", airlineName: "Test Air",
  iataType: "320", icaoCode: "A320", model: "A320", modelCode: "A320-214", numSeats: 180,
  deliveryDate: "2015-03-10T00:00:00", firstFlightDate: "2015-02-01T00:00:00", typeName: "Airbus A320-200",
  numEngines: 2, engineType: "Jet", isFreighter: false, productionLine: "Airbus A320", ageYears: 11.6, verified: true,
  image: { url: "https://example.org/yr-tst.jpg", webUrl: "https://example.org/yr-tst", author: "Example Spotter", license: "AttributionCC", htmlAttributions: ["Example Spotter, CC BY"] },
};
const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/aerodatabox-fids-synthetic.json", import.meta.url)));
const NOW = Date.parse("2026-10-19T12:45:00Z");
const OTP = { iata: "OTP", icao: "LROP", name: "Bucharest Henri Coandă International Airport", city: "Otopeni", tz: "Europe/Bucharest" };
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
function fakeFetch(answer) {
  const f = async (url, opts) => { f.calls.push({ url, opts }); if (answer instanceof Error) throw answer; return typeof answer === "function" ? answer(url) : answer; };
  f.calls = [];
  return f;
}

test("normalizes an aircraft; manufacturer only from a known name", () => {
  const a = normalizeAircraft(AIRCRAFT);
  assert.equal(a.registration, "YR-TST");
  assert.equal(a.model, "Airbus A320-200");
  assert.equal(a.manufacturer, "Airbus");
  assert.equal(a.seats, 180);
  assert.equal(a.engines, 2);
  assert.equal(a.engineType, "Jet");
  assert.equal(a.ageYears, 11.6);
  assert.equal(a.deliveryDate, "2015-03-10");
  assert.equal(a.photo.kind, "this-aircraft");
  assert.equal(a.photo.author, "Example Spotter");
  const empty = normalizeAircraft({ reg: "YR-XXX" });
  assert.deepEqual([empty.model, empty.manufacturer, empty.seats, empty.ageYears, empty.photo], [null, null, null, null, null]);
  assert.equal(manufacturerOf("De Havilland Canada DHC-8-400"), "De Havilland Canada");
  assert.equal(manufacturerOf("Boeing 737-800"), "Boeing");
  assert.equal(manufacturerOf("Airbusiness X"), null, "no partial-word match");
  assert.equal(manufacturerOf("Unknown Jet 9"), null);
});

test("input checks", () => {
  assert.ok(isRegistration("YR-ASA") && isRegistration("N622CZ") && isRegistration("D-AIBL"));
  assert.ok(!isRegistration("") && !isRegistration("YR ASA") && !isRegistration("-ABC"));
  assert.ok(isFlightNumber("RO391") && isFlightNumber("W43140") && isFlightNumber("AA2774"));
  assert.ok(!isFlightNumber("RO 391") && !isFlightNumber("391"));
});

test("aircraft: looked up once, stored 7 days, 1 unit; key in a header", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => ok(AIRCRAFT));
  let r = await getAircraft("YR-TST", { key: "k", store, fetchImpl: f, now: NOW });
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.aircraft.model, "Airbus A320-200");
  assert.match(f.calls[0].url, /\/aircrafts\/reg\/YR-TST\?withImage=true&withRegistrations=false$/);
  assert.equal(f.calls[0].opts.headers["X-RapidAPI-Key"], "k");
  r = await getAircraft("YR-TST", { key: "k", store, fetchImpl: f, now: NOW + AIRCRAFT_FRESH_MS - 1000 });
  assert.equal(f.calls.length, 1, "reused for 7 days");
  await getAircraft("YR-TST", { key: "k", store, fetchImpl: f, now: NOW + AIRCRAFT_FRESH_MS + 1 });
  assert.equal(f.calls.length, 2);
  assert.equal((await readUsage(store, NOW)).units, 2 * UNITS.aircraft);
});

test("aircraft not found (204) is stored too, so it is not asked again", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => new Response(null, { status: 204 }));
  const r = await getAircraft("YR-NOP", { key: "k", store, fetchImpl: f, now: NOW });
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.aircraft, null);
  await getAircraft("YR-NOP", { key: "k", store, fetchImpl: f, now: NOW + 3600000 });
  assert.equal(f.calls.length, 1);
});

test("board and aircraft share one monthly unit budget", async () => {
  const store = memoryStore();
  const f = fakeFetch(url => (url.includes("/aircrafts/") ? ok(AIRCRAFT) : ok(SAMPLE)));
  await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW, cap: 3 });              // 2 units
  let r = await getAircraft("YR-TST", { key: "k", store, fetchImpl: f, now: NOW, cap: 3 }); // 1 unit -> 3
  assert.equal(r.body.status, "ok");
  r = await getAircraft("YR-OTH", { key: "k", store, fetchImpl: f, now: NOW, cap: 3 });     // would be 4
  assert.equal(r.body.status, "quota");
  assert.equal(f.calls.length, 2);
});

test("old usage records counted board calls; they convert to units", async () => {
  const store = memoryStore();
  await store.setJSON("usage/2026-10", { calls: 7, exhausted: false });
  assert.equal((await readUsage(store, NOW)).units, 14);
});

test("no key: says not connected, never calls out", async () => {
  const f = fakeFetch(() => ok(AIRCRAFT));
  const r = await getAircraft("YR-TST", { key: null, store: memoryStore(), fetchImpl: f, now: NOW });
  assert.equal(r.body.status, "unconfigured");
  assert.equal(f.calls.length, 0);
});

test("flight status: picks the leg at this airport, stored 5 minutes, 2 units", async () => {
  const store = memoryStore();
  // Two legs of the same number: FRA->OTP (arrival here) and OTP->LHR (departure here).
  const legs = [SAMPLE.arrivals[0], SAMPLE.departures[0]];
  const f = fakeFetch(() => ok(legs));
  let r = await getFlightStatus("TEST391", "2026-10-19", OTP, { key: "k", store, fetchImpl: f, now: NOW });
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.flight.direction, "departure");
  assert.equal(r.body.flight.arrival.airport.iata, "LHR");
  assert.match(f.calls[0].url, /\/flights\/number\/TEST391\/2026-10-19\?/);
  await getFlightStatus("TEST391", "2026-10-19", OTP, { key: "k", store, fetchImpl: f, now: NOW + STATUS_FRESH_MS - 1000 });
  assert.equal(f.calls.length, 1);
  assert.equal((await readUsage(store, NOW)).units, UNITS.flightStatus);
  // Not at this airport -> null, not a guess.
  r = await getFlightStatus("TEST391", "2026-10-19", { ...OTP, iata: "CLJ" }, { key: "k", store, fetchImpl: f, now: NOW });
  assert.equal(r.body.flight, null);
});

test("errors keep an older stored answer, marked stale", async () => {
  const store = memoryStore();
  await getAircraft("YR-TST", { key: "k", store, fetchImpl: fakeFetch(() => ok(AIRCRAFT)), now: NOW });
  const r = await getAircraft("YR-TST", { key: "k", store, fetchImpl: fakeFetch(() => new Response("x", { status: 503 })), now: NOW + AIRCRAFT_FRESH_MS + 1 });
  assert.equal(r.body.status, "error");
  assert.equal(r.body.stale, true);
  assert.equal(r.body.aircraft.registration, "YR-TST");
});

test("function: routes and input checks", async () => {
  assert.deepEqual(config.path, ["/api/aircraft/:reg", "/api/flight-status/:number/:date/:code"]);
  let res = await handler(new Request("http://x/api/aircraft/bad%20reg"), { params: { reg: "bad reg" } });
  assert.equal(res.status, 400);
  res = await handler(new Request("http://x/api/flight-status/391/2026-10-19/OTP"), { params: { number: "391", date: "2026-10-19", code: "OTP" } });
  assert.equal(res.status, 400);
  res = await handler(new Request("http://x/api/flight-status/RO391/19-10-2026/OTP"), { params: { number: "RO391", date: "19-10-2026", code: "OTP" } });
  assert.equal(res.status, 400);
  res = await handler(new Request("http://x/api/flight-status/RO391/2026-10-19/QQQ"), { params: { number: "RO391", date: "2026-10-19", code: "QQQ" } });
  assert.equal(res.status, 404);
  const saved = process.env.AERODATABOX_RAPIDAPI_KEY;
  delete process.env.AERODATABOX_RAPIDAPI_KEY;
  try {
    res = await handler(new Request("http://x/api/aircraft/yr-asa"), { params: { reg: "yr-asa" } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "unconfigured");
  } finally {
    if (saved !== undefined) process.env.AERODATABOX_RAPIDAPI_KEY = saved;
  }
});
