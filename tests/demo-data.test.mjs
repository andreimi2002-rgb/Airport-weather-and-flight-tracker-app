import test from "node:test";
import assert from "node:assert/strict";
import * as demo from "../public/js/demo-data.js";
const { demoFlights, demoWeather, flightStats } = demo;

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

test("no demo weather remains (it comes from the weather function now)", () => {
  assert.equal(demoWeather, undefined);
});

test("no demo airport/city photos remain (they come from Wikimedia now)", () => {
  assert.equal(demo.demoPhotos, undefined);
});
