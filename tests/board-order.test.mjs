import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBoard, schedMs, isPastFlight } from "../public/js/flights.js";

const now = Date.parse("2026-10-20T12:00:00Z");
const iso = min => new Date(now + min * 60000).toISOString().slice(0, 16) + "Z"; // provider style, no seconds
const dep = (id, min, status = "expected", extra = {}) => ({ id, direction: "departure", status, departure: { scheduled: { utc: iso(min) }, ...extra }, arrival: {} });

test("board order: scheduled time as a time; earlier flights split off at now", () => {
  const list = [
    dep("late-at-0058", 58, "delayed", { revised: { utc: iso(83) } }),
    dep("at-0055", 55),
    dep("left", -30, "departed"),
    dep("overdue-no-report", -40),
    dep("cancelled-earlier", -10, "cancelled"),
    dep("cancelled-later", 30, "cancelled"),
    dep("soon", 5),
  ];
  const { earlier, upcoming } = splitBoard(list, now);
  assert.deepEqual(earlier.map(f => f.id), ["overdue-no-report", "left", "cancelled-earlier"]);
  // Scheduled order: 00:55 before the delayed 00:58 (shown with its new time under it)
  assert.deepEqual(upcoming.map(f => f.id), ["soon", "cancelled-later", "at-0055", "late-at-0058"]);
});

test("scheduled time: UTC first, local as fallback, unknown last-resort 0", () => {
  assert.equal(schedMs(dep("x", 0)), now);
  assert.equal(schedMs({ direction: "departure", departure: { scheduled: { local: "2026-10-20T15:00+03:00" } } }), now);
  assert.equal(schedMs({ direction: "departure", departure: {} }), 0);
});

test("past flights: done, or cancelled/unreported with the time passed; demo never", () => {
  assert.equal(isPastFlight(dep("a", 10, "departed"), now), true);
  assert.equal(isPastFlight(dep("b", -40), now), true);
  assert.equal(isPastFlight(dep("c", -5), now), false); // overdue only after 15 min
  assert.equal(isPastFlight({ ...dep("d", -40), demo: true }, now), false);
});
