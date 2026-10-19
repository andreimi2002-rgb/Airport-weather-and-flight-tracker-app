import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeBoard } from "../netlify/lib/flights/aerodatabox.mjs";
import { punctuality, hourlyTraffic, topBy, airlineKey, routeKey, lateMinutes, flightProgress, relative, haversineKm, milestones } from "../public/js/insights.js";
import { tafGroups } from "../public/js/weather.js";
import { trafficSvg, forecastSvg } from "../public/js/charts.js";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/aerodatabox-fids-synthetic.json", import.meta.url)));
const board = normalizeBoard(SAMPLE);
const all = [...board.departures, ...board.arrivals];
const t = iso => ({ utc: iso, local: iso });
const flight = (over = {}) => ({
  id: "x", direction: "departure", number: "T 1", status: "expected", airline: { name: "Test", iata: "TS" }, delayMinutes: null,
  departure: { airport: { iata: "OTP" }, scheduled: t("2026-10-19T10:00Z"), revised: null, runway: null },
  arrival: { airport: { iata: "LHR", city: "London" }, scheduled: t("2026-10-19T13:00Z"), revised: null, runway: null },
  aircraft: { model: "A320" }, ...over,
});

test("late minutes come only from the provider's own times", () => {
  const d = board.departures.find(f => f.number === "TEST 391");
  assert.equal(lateMinutes(d), 25);
  assert.equal(lateMinutes(board.departures.find(f => f.number === "TEST 7")), null);
});

test("punctuality counts delays, cancellations and average lateness", () => {
  const p = punctuality(all);
  assert.equal(p.total, 4);
  assert.ok(p.delayed >= 1);
  assert.equal(p.avgDelayMin !== null, true);
  assert.deepEqual(punctuality([]).onTimePct, null);
  const fs = [flight(), flight({ status: "cancelled" }), flight({ delayMinutes: 30, departure: { ...flight().departure, revised: t("2026-10-19T10:30Z") } })];
  const q = punctuality(fs);
  assert.equal(q.cancelled, 1);
  assert.equal(q.delayed, 1);
  assert.equal(q.onTimePct, 50); // 1 of the 2 not-cancelled flights
  assert.equal(q.avgDelayMin, 30);
});

test("hourly traffic buckets flights by scheduled hour", () => {
  const b = hourlyTraffic(all, "2026-10-19T11:00:00Z", "2026-10-19T17:00:00Z");
  assert.equal(b.length, 6);
  assert.equal(b.reduce((s, x) => s + x.dep + x.arr, 0), all.filter(f => (f.direction === "departure" ? f.departure : f.arrival).scheduled).length);
  assert.deepEqual(hourlyTraffic([], "bad", "bad"), []);
});

test("top lists group by airline and route", () => {
  const fs = [flight(), flight(), flight({ airline: { name: "Other", iata: "OT" }, arrival: { ...flight().arrival, airport: { iata: "VIE", city: "Vienna" } } })];
  assert.deepEqual(topBy(fs, airlineKey).map(x => [x.id, x.count]), [["TS", 2], ["OT", 1]]);
  assert.deepEqual(topBy(fs, routeKey).map(x => [x.label, x.count]), [["London", 2], ["Vienna", 1]]);
});

test("progress uses only reported times", () => {
  const now = Date.parse("2026-10-19T11:30Z");
  assert.equal(flightProgress(flight(), now).state, "before");
  const air = flightProgress(flight({ status: "en-route" }), now);
  assert.equal(air.state, "air");
  assert.equal(air.pct, 50);
  assert.equal(air.remainingMin, 90);
  assert.equal(flightProgress(flight({ status: "arrived" }), now).pct, 100);
  assert.equal(flightProgress(flight({ arrival: { ...flight().arrival, scheduled: null } }), now).pct, null);
});

test("relative times and distance", () => {
  const now = Date.parse("2026-10-19T10:00Z");
  assert.equal(relative("2026-10-19T10:25Z", now), "in 25 min");
  assert.equal(relative("2026-10-19T08:50Z", now), "1 h 10 min ago");
  assert.equal(relative(null, now), "");
  const km = haversineKm({ lat: 44.57, lon: 26.08 }, { lat: 51.47, lon: -0.45 });
  assert.ok(km > 2050 && km < 2150, String(km));
  assert.equal(haversineKm({ lat: 1 }, { lat: 2, lon: 3 }), null);
});

test("milestones mark what has happened", () => {
  const m = milestones(flight({ status: "en-route", departure: { ...flight().departure, runway: t("2026-10-19T10:12Z") } }));
  assert.equal(m.find(x => x.key === "dep").done, true);
  assert.equal(m.find(x => x.key === "dep").kind, "actual");
  assert.equal(m.find(x => x.key === "arr").done, false);
  assert.ok(milestones(flight({ status: "cancelled" })).some(x => x.label === "Cancelled"));
});

test("TAF is split into readable change groups", () => {
  const g = tafGroups("TAF KSEA 191720Z 1918/2024 18008KT P6SM BKN040 FM200000 20012G20KT P6SM OVC025 TEMPO 2002/2006 4SM RA BR PROB30 2010/2014 2SM BR BECMG 2021/2023 VRB03KT");
  assert.deepEqual(g.map(x => x.kind), ["base", "fm", "tempo", "prob", "becmg"]);
  assert.equal(g[1].label, "From 00:00 on the 20th UTC");
  assert.equal(g[2].label, "Temporarily 02:00–06:00 on the 20th UTC");
  assert.equal(g[3].label, "30% chance 10:00–14:00 on the 20th UTC");
  assert.equal(g[0].text, "KSEA 191720Z 1918/2024 18008KT P6SM BKN040");
  assert.equal(tafGroups("TAF AMD EGLL 011100Z 0112/0218 22010KT 9999 FM012100 25008KT")[1].label, "From 21:00 on the 1st UTC");
});

test("charts render SVG and handle empty input", () => {
  const b = hourlyTraffic(all, "2026-10-19T11:00:00Z", "2026-10-19T17:00:00Z");
  assert.match(trafficSvg(b, { tz: "Europe/Bucharest", now: Date.parse("2026-10-19T12:45Z") }), /^<svg[\s\S]*NOW[\s\S]*<\/svg>$/);
  assert.equal(trafficSvg([]), "");
  assert.equal(forecastSvg([{ time: "2026-10-19T10:00Z", tempC: 5 }]), "");
  assert.match(forecastSvg([{ time: "2026-10-19T10:00Z", tempC: 5, precipMm: 1 }, { time: "2026-10-19T11:00Z", tempC: 7, precipMm: 0 }], { tz: "UTC" }), /<path/);
});
