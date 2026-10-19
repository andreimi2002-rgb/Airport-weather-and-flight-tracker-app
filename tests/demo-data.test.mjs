import test from "node:test";
import assert from "node:assert/strict";
import * as demo from "../public/js/demo-data.js";
import { boardStats } from "../public/js/flight-model.js";
const { demoFlights } = demo;

test("demo flights exist only for SEA and all touch SEA", () => {
  assert.deepEqual(Object.keys(demoFlights), ["SEA"]);
  for (const f of demoFlights.SEA) {
    assert.ok(f.departure.airport.iata === "SEA" || f.arrival.airport.iata === "SEA", f.number);
    assert.equal(f.demo, true);
  }
});

test("demo flights use the shared flight model and their counts match the board", () => {
  const s = boardStats(demoFlights.SEA);
  assert.equal(s.departures + s.arrivals, demoFlights.SEA.length);
  assert.equal(s.departures, 7);
  assert.equal(s.arrivals, 6);
  assert.equal(s.delays, 3);
  assert.equal(s.cancellations, 1);
  assert.deepEqual(boardStats([]), { departures: 0, departuresOnTime: 0, arrivals: 0, arrivalsOnTime: 0, delays: 0, cancellations: 0 });
  const as214 = demoFlights.SEA[0];
  assert.equal(as214.departure.scheduled.local, "2000-01-01T05:35");
  assert.equal(as214.scheduledDurationMinutes, 165);
});

test("no demo weather remains (it comes from the weather function now)", () => {
  assert.equal(demo.demoWeather, undefined);
});

test("no demo airport/city photos remain (they come from Wikimedia now)", () => {
  assert.equal(demo.demoPhotos, undefined);
});
