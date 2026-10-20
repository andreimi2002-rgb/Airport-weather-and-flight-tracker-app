import { test } from "node:test";
import assert from "node:assert/strict";
import { recordBoard, readDay, summarize, delayMinutes, KEEP_DAYS } from "../netlify/lib/flights/stats.mjs";
import { memoryStore } from "../netlify/lib/flights/budget.mjs";

const f = (id, status, sched, revised, dir = "departure") => {
  const here = { scheduled: { utc: sched + "Z", local: sched.replace(" ", "T") + "+03:00" }, ...(revised ? { revised: { utc: revised + "Z" } } : {}), airport: { iata: "OTP" } };
  const other = { airport: { iata: "LHR" } };
  return { id, number: "RO " + id, direction: dir, status, airline: { iata: "RO", icao: "ROT" }, departure: dir === "departure" ? here : other, arrival: dir === "departure" ? other : here };
};
const now = Date.parse("2026-10-20T12:00:00Z");

test("stats: a later board updates the same flights; summary counts finished flights only", async () => {
  const store = memoryStore();
  await recordBoard(store, "OTP", { departures: [f("1", "expected", "2026-10-20 08:00", null), f("2", "departed", "2026-10-20 09:00", "2026-10-20 09:40")], arrivals: [] }, now);
  await recordBoard(store, "OTP", { departures: [f("1", "departed", "2026-10-20 08:00", "2026-10-20 08:05"), f("3", "cancelled", "2026-10-20 10:00", null)], arrivals: [] }, now + 1800000);
  const d = await readDay(store, "OTP", "2026-10-20");
  assert.deepEqual(d.days, ["2026-10-20"]);
  assert.deepEqual(d.summary, { flights: 3, departures: 3, arrivals: 0, finished: 2, cancelled: 1, withTimes: 2, onTimePct: 50, avgDelayMin: 23 });
});

test("stats: days older than 90 are deleted", async () => {
  const store = memoryStore();
  await recordBoard(store, "OTP", { departures: [f("1", "departed", "2026-07-01 08:00", null)], arrivals: [] }, Date.parse("2026-07-01T12:00:00Z"));
  await recordBoard(store, "OTP", { departures: [f("2", "departed", "2026-10-20 08:00", null)], arrivals: [] }, now);
  const d = await readDay(store, "OTP", "2026-07-01");
  assert.equal(KEEP_DAYS, 90);
  assert.deepEqual(d.days, ["2026-10-20"]);
  assert.equal(d.summary, null);
});

test("stats: delay only from the provider's own times", () => {
  assert.equal(delayMinutes({ scheduled: { utc: "2026-10-20T08:00Z" }, runway: { utc: "2026-10-20T08:20Z" } }), 20);
  assert.equal(delayMinutes({ scheduled: { utc: "2026-10-20T08:00Z" } }), null);
  assert.equal(summarize({}).onTimePct, null);
});
