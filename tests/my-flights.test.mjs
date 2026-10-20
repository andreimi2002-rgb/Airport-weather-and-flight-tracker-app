import { test } from "node:test";
import assert from "node:assert/strict";
import { prune, slugOf } from "../public/js/my-flights.js";

const now = Date.parse("2026-10-20T12:00:00Z");
const item = (arrUtc, depUtc = null) => ({ id: "x", flight: { number: "KL 1377", direction: "arrival", departure: { scheduled: depUtc ? { utc: depUtc } : null }, arrival: { scheduled: arrUtc ? { utc: arrUtc } : null } } });

test("my flights: dropped a day after (scheduled or actual) arrival", () => {
  assert.equal(prune([item("2026-10-20T10:00Z")], now).length, 1);
  assert.equal(prune([item("2026-10-19T11:00Z")], now).length, 0);
  assert.equal(prune([item(null, "2026-10-18T10:00Z")], now).length, 0); // no arrival time: the departure decides
  assert.equal(prune([item(null)], now).length, 1); // no times at all: kept until removed by hand
});

test("my flights: drawer link slug is the same as the board's", () => {
  assert.equal(slugOf({ number: "KL 1377", direction: "arrival" }), "KL1377-a");
  assert.equal(slugOf({ number: "w6 3055", direction: "departure" }), "W63055-d");
});
