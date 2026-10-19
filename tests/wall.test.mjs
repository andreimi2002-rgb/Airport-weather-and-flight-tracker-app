import { test } from "node:test";
import assert from "node:assert/strict";
import { wallRows, shouldReload, isNight, localHourAt, pageOf, WALL_REFRESH_MS } from "../public/js/wall-model.js";

const now = Date.parse("2026-10-19T12:00:00Z");
const t = min => ({ utc: new Date(now + min * 60000).toISOString() });
const dep = (id, min, status = "expected", extra = {}) => ({ id, direction: "departure", status, departure: { scheduled: t(min), ...extra }, arrival: {} });

test("wall rows: finished flights first (only for a short while), then the rest in scheduled order", () => {
  const flights = [
    dep("later", 90), dep("soon", 10),
    dep("left-long-ago", -60, "departed"), dep("left-just-now", -10, "departed"),
    dep("overdue", -40), dep("very-overdue", -120),
    dep("cancelled-old", -45, "cancelled"),
    { id: "arr", direction: "arrival", status: "expected", departure: {}, arrival: { scheduled: t(5) } },
  ];
  assert.deepEqual(wallRows(flights, "departure", now).map(f => f.id), ["left-just-now", "overdue", "soon", "later"]);
  // A flight cancelled for later stays in time order
  const later = [dep("a", 10), dep("cancelled-later", 5, "cancelled"), dep("b", 20)];
  assert.deepEqual(wallRows(later, "departure", now).map(f => f.id), ["cancelled-later", "a", "b"]);
  assert.deepEqual(wallRows(flights, "arrival", now).map(f => f.id), ["arr"]);
});

test("wall rows: a revised time keeps a delayed flight on the board", () => {
  const f = dep("late", -50, "delayed", { revised: t(30) });
  assert.equal(wallRows([f], "departure", now).length, 1);
});

test("reload: hourly, never at night (airport time)", () => {
  assert.equal(shouldReload(NaN, "Europe/Bucharest", now), true);
  assert.equal(shouldReload(now - 30 * 60000, "Europe/Bucharest", now), false);
  assert.equal(shouldReload(now - WALL_REFRESH_MS, "Europe/Bucharest", now), true);
  // 01:30 in Bucharest (UTC+3 in October) = 22:30 UTC
  const night = Date.parse("2026-10-19T22:30:00Z");
  assert.equal(localHourAt("Europe/Bucharest", night), 1);
  assert.equal(isNight("Europe/Bucharest", night), true);
  assert.equal(shouldReload(night - 3 * WALL_REFRESH_MS, "Europe/Bucharest", night), false);
  // Unknown time zone: UTC
  assert.equal(localHourAt(null, night), 22);
});

test("pages wrap around and never go empty", () => {
  const rows = Array.from({ length: 7 }, (_, i) => i);
  assert.deepEqual(pageOf(rows, 3, 0), { rows: [0, 1, 2], page: 0, pages: 3 });
  assert.deepEqual(pageOf(rows, 3, 2).rows, [6]);
  assert.deepEqual(pageOf(rows, 3, 3).rows, [0, 1, 2]);
  assert.deepEqual(pageOf([], 3, 5), { rows: [], page: 0, pages: 1 });
});
