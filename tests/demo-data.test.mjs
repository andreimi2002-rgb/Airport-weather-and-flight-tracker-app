import test from "node:test";
import assert from "node:assert/strict";
import { demoFlights, demoWeather, demoPhotos, flightStats } from "../public/js/demo-data.js";

test("demo flights exist only for SEA and all touch SEA", () => {
  assert.deepEqual(Object.keys(demoFlights), ["SEA"]);
  for (const f of demoFlights.SEA) assert.ok(f.from === "SEA" || f.to === "SEA", f.flight);
});

test("flightStats counts match the listed flights", () => {
  const s = flightStats(demoFlights.SEA);
  assert.equal(s.departures + s.arrivals, demoFlights.SEA.length);
  assert.equal(s.departures, 7);
  assert.equal(s.arrivals, 6);
  assert.equal(s.delays, 3);
  assert.equal(s.cancellations, 1);
  assert.deepEqual(flightStats([]), { departures: 0, departuresOnTime: 0, arrivals: 0, arrivalsOnTime: 0, delays: 0, cancellations: 0 });
});

test("demo weather only for the four prototype airports", () => {
  assert.deepEqual(Object.keys(demoWeather).sort(), ["JFK", "LHR", "OTP", "SEA"]);
});

test("wrong 'Bucharest' city photo (actually Tbilisi) is gone", () => {
  assert.equal(demoPhotos.OTP.city, undefined);
  assert.ok(!JSON.stringify(demoPhotos).includes("1565008576549"));
});
