import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeBoard, fetchBoard, WINDOW } from "../netlify/lib/flights/aerodatabox.mjs";
import { getBoard, memoryStore, FRESH_MS, monthKey, nextMonthStart } from "../netlify/lib/flights/board.mjs";
import { boardStats, isDelayed, isDone } from "../public/js/flight-model.js";
import handler, { config } from "../netlify/functions/flights.mjs";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/aerodatabox-fids-synthetic.json", import.meta.url)));
const OTP = { iata: "OTP", name: "Bucharest Henri Coandă International Airport", tz: "Europe/Bucharest" };
const NOW = Date.parse("2026-10-19T12:45:00Z");
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "x-ratelimit-requests-remaining": "199" } });
function fakeFetch(answer) {
  const f = async (url, opts) => { f.calls.push({ url, opts }); if (answer instanceof Error) throw answer; return typeof answer === "function" ? answer() : answer; };
  f.calls = [];
  return f;
}

test("normalizes AeroDataBox flights without inventing fields", () => {
  const b = normalizeBoard(SAMPLE);
  assert.equal(b.departures.length, 3);
  assert.equal(b.arrivals.length, 1);
  assert.equal(b.live, true);
  // sorted by scheduled time at this airport
  assert.deepEqual(b.departures.map(f => f.number), ["TEST 7", "TEST 391", "TEST 12"]);

  const d = b.departures[1];
  assert.equal(d.direction, "departure");
  assert.equal(d.status, "delayed");
  assert.equal(d.delayMinutes, 25);
  assert.equal(d.departure.scheduled.local, "2026-10-19T16:30+03:00");
  assert.equal(d.departure.gate, "B4");
  assert.equal(d.departure.live, true);
  assert.equal(d.arrival.airport.city, "London");
  assert.equal(d.arrival.airport.name, "Heathrow");
  assert.equal(d.distanceKm, 2097);
  assert.equal(d.scheduledDurationMinutes, 195);
  assert.equal(d.aircraft.registration, "YR-TST");
  assert.equal(d.aircraft.photo.kind, "representative");
  assert.equal(d.aircraft.photo.author, "Example Author");

  const unknown = b.departures[0];
  assert.equal(unknown.status, "scheduled");
  assert.equal(unknown.departure.live, false);
  assert.equal(unknown.departure.gate, null);
  assert.equal(unknown.delayMinutes, null);
  assert.equal(unknown.distanceKm, null);
  assert.equal(unknown.scheduledDurationMinutes, null);
  assert.deepEqual(unknown.aircraft, { registration: null, model: null, manufacturer: null, modeS: null, photo: null });
  assert.equal(unknown.airline.iata, null);

  const arr = b.arrivals[0];
  assert.equal(arr.status, "arrived");
  assert.equal(arr.delayMinutes, -8);
  assert.equal(arr.arrival.baggageBelt, "3");
  assert.equal(arr.arrival.runway.utc, "2026-10-19T11:38Z");
  assert.equal(isDone(arr), true);
});

test("fills in the requested airport when the provider leaves it out", () => {
  const raw = structuredClone(SAMPLE);
  delete raw.arrivals[0].arrival.airport;           // as seen in real answers for OTP arrivals
  raw.departures[0].departure.airport = {};
  const here = { iata: "OTP", icao: "LROP", name: "Bucharest Henri Coandă International Airport", city: "Otopeni", country: null };
  const b = normalizeBoard(raw, here);
  assert.equal(b.arrivals[0].arrival.airport.iata, "OTP");
  assert.equal(b.arrivals[0].arrival.airport.city, "Otopeni");
  assert.equal(b.departures.find(f => f.number === "TEST 391").departure.airport.icao, "LROP");
  // The other end is never filled in from our side.
  assert.equal(b.arrivals[0].departure.airport.iata, "FRA");
});

test("board statistics", () => {
  const b = normalizeBoard(SAMPLE);
  const all = [...b.departures, ...b.arrivals];
  assert.deepEqual(boardStats(all), { departures: 3, departuresOnTime: 1, arrivals: 1, arrivalsOnTime: 1, delays: 1, cancellations: 1 });
  assert.equal(isDelayed({ status: "expected", delayMinutes: 20 }), true);
  assert.equal(isDelayed({ status: "expected", delayMinutes: 10 }), false);
  assert.equal(isDelayed({ status: "cancelled", delayMinutes: 40 }), false);
});

test("calls the provider with the key in a header and the 12-hour window", async () => {
  const f = fakeFetch(ok(SAMPLE));
  const { board, usage } = await fetchBoard({ iata: "OTP", icao: "LROP", name: "Bucharest", city: "Otopeni" }, "secret-key", { fetchImpl: f });
  assert.equal(board.departures.length, 3);
  assert.equal(usage["x-ratelimit-requests-remaining"], "199");
  const { url, opts } = f.calls[0];
  assert.match(url, /^https:\/\/aerodatabox\.p\.rapidapi\.com\/flights\/airports\/iata\/OTP\?/);
  assert.match(url, /offsetMinutes=-120&durationMinutes=720&direction=Both&withLeg=true/);
  assert.ok(!url.includes("secret-key"), "key must not be in the URL");
  assert.equal(opts.headers["X-RapidAPI-Key"], "secret-key");
  assert.equal(WINDOW.durationMinutes, 720); // Basic plan maximum
});

test("no key: says not connected and never calls out", async () => {
  const f = fakeFetch(ok(SAMPLE));
  const { body } = await getBoard(OTP, { key: null, store: memoryStore(), fetchImpl: f, now: NOW });
  assert.equal(body.status, "unconfigured");
  assert.equal(f.calls.length, 0);
});

test("stored board is reused while fresh, then refreshed", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => ok(SAMPLE));
  let r = await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW });
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.stale, false);
  assert.equal(r.body.board.fetchedAt, "2026-10-19T12:45:00.000Z");
  assert.equal(r.body.board.from, "2026-10-19T10:45:00.000Z");
  assert.equal(r.cacheSeconds, FRESH_MS / 1000);
  r = await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW + 10 * 60000 });
  assert.equal(f.calls.length, 1, "fresh board reused");
  assert.equal(r.cacheSeconds, 15 * 60);
  await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW + FRESH_MS + 1 });
  assert.equal(f.calls.length, 2, "refreshed after FRESH_MS");
  assert.equal((await store.get("usage/2026-10")).units, 4, "2 boards x 2 units");
});

test("monthly cap stops calls and serves the last board as stale", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => ok(SAMPLE));
  await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW, cap: 2 });
  const r = await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW + FRESH_MS + 1, cap: 2 });
  assert.equal(f.calls.length, 1);
  assert.equal(r.body.status, "quota");
  assert.equal(r.body.stale, true);
  assert.equal(r.body.board.departures.length, 3);
  assert.match(r.body.notice, /2026-11-01/);
  // A different airport with no stored board: quota message, no data.
  const r2 = await getBoard({ ...OTP, iata: "CLJ" }, { key: "k", store, fetchImpl: f, now: NOW, cap: 2 });
  assert.equal(r2.body.status, "quota");
  assert.equal(r2.body.board, null);
});

test("provider 429 for the monthly quota marks the month as used up", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => new Response(JSON.stringify({ message: "You have exceeded the MONTHLY quota for Units on your current plan, BASIC." }), { status: 429 }));
  const r = await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW });
  assert.equal(r.body.status, "quota");
  assert.equal((await store.get("usage/2026-10")).exhausted, true);
  await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW + 1000 });
  assert.equal(f.calls.length, 1, "no more calls this month");
});

test("provider errors: stale board if there is one, otherwise an error; bad key explained", async () => {
  const store = memoryStore();
  await getBoard(OTP, { key: "k", store, fetchImpl: fakeFetch(() => ok(SAMPLE)), now: NOW });
  const down = fakeFetch(() => new Response("x", { status: 503 }));
  let r = await getBoard(OTP, { key: "k", store, fetchImpl: down, now: NOW + FRESH_MS + 1 });
  assert.equal(r.body.status, "error");
  assert.equal(r.body.stale, true);
  assert.equal(r.body.board.departures.length, 3);
  assert.equal(r.cacheSeconds, 300);
  const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
  r = await getBoard({ ...OTP, iata: "CLJ" }, { key: "k", store, fetchImpl: fakeFetch(timeout), now: NOW });
  assert.equal(r.body.status, "error");
  assert.equal(r.body.board, null);
  assert.match(r.body.notice, /did not answer in time/);
  r = await getBoard({ ...OTP, iata: "IAS" }, { key: "k", store, fetchImpl: fakeFetch(() => new Response("{}", { status: 403 })), now: NOW });
  assert.match(r.body.notice, /refused the key/);
  assert.equal((await store.get("usage/2026-10")).units, 4, "refused key not counted (1 ok + 1 503 counted, 2 units each)");
});

test("provider 429 'Too many requests' (per-second limit) is temporary, not the month", async () => {
  const store = memoryStore();
  const f = fakeFetch(() => new Response(JSON.stringify({ message: "Too many requests" }), { status: 429 }));
  const r = await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW });
  assert.equal(r.body.status, "error");
  assert.match(r.body.notice, /busy/);
  assert.equal((await store.get("usage/2026-10")).exhausted, false);
  await getBoard(OTP, { key: "k", store, fetchImpl: f, now: NOW + 1000 });
  assert.equal(f.calls.length, 2, "next request may try again");
});

test("month helpers", () => {
  assert.equal(monthKey(NOW), "2026-10");
  assert.equal(nextMonthStart(Date.parse("2026-12-31T23:00:00Z")), "2027-01-01T00:00:00.000Z");
});

test("function: input checks, not-connected answer, cache header", async () => {
  assert.equal(config.path, "/api/flights/:code");
  assert.ok(config.rateLimit.windowLimit > 0);
  let res = await handler(new Request("http://x/api/flights/x"), { params: { code: "x" } });
  assert.equal(res.status, 400);
  res = await handler(new Request("http://x/api/flights/QQQ"), { params: { code: "QQQ" } });
  assert.equal(res.status, 404);
  const saved = process.env.AERODATABOX_RAPIDAPI_KEY;
  delete process.env.AERODATABOX_RAPIDAPI_KEY;
  try {
    res = await handler(new Request("http://x/api/flights/OTP"), { params: { code: "OTP" } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "unconfigured");
    assert.equal(res.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=300");
  } finally {
    if (saved !== undefined) process.env.AERODATABOX_RAPIDAPI_KEY = saved;
  }
});

test("page helpers: status pill, update time, duration", async () => {
  const { statusView, updateTime, fmtDuration, hhmm, nextFlight } = await import("../public/js/flights.js");
  const b = normalizeBoard(SAMPLE);
  const [unknown, delayed, cancelled] = b.departures;
  const T0 = Date.parse("2026-10-19T12:00:00Z"); // before every sample flight
  assert.deepEqual(statusView(delayed, T0), { label: "Delayed", cls: "delayed" });
  assert.deepEqual(statusView(cancelled, T0), { label: "Cancelled", cls: "cancelled" });
  assert.deepEqual(statusView(unknown, T0), { label: "Scheduled", cls: "" });
  assert.deepEqual(statusView({ ...unknown, status: "expected", delayMinutes: 30 }, T0), { label: "Delayed", cls: "delayed" });
  assert.deepEqual(statusView(b.arrivals[0], T0), { label: "Arrived", cls: "landed" });
  assert.deepEqual(updateTime(delayed), { time: "16:55", note: "Estimated" });
  assert.deepEqual(updateTime(b.arrivals[0]), { time: "14:42", note: "Actual" });
  assert.deepEqual(updateTime(unknown), { time: "—", note: "No update" });
  assert.equal(hhmm(unknown.departure.scheduled), "15:10");
  assert.equal(fmtDuration(195), "3h 15m");
  assert.equal(fmtDuration(45), "45m");
  assert.equal(fmtDuration(null), null);
  const at1300 = Date.parse("2026-10-19T13:00:00Z");
  assert.equal(nextFlight(b.departures, "departure", Date.parse("2026-10-19T12:00:00Z")).number, "TEST 7");
  assert.equal(nextFlight(b.departures, "departure", at1300).number, "TEST 391", "past schedule-only flight skipped");
  assert.equal(nextFlight(b.arrivals, "arrival", at1300), undefined);
});

test("overdue flights show 'No recent update' instead of a stale 'Expected'", async () => {
  const { statusView, ago } = await import("../public/js/flights.js");
  const { isOverdue } = await import("../public/js/flight-model.js");
  const b = normalizeBoard(SAMPLE);
  const delayed = b.departures.find(f => f.number === "TEST 391"); // revised 13:55Z
  const cancelled = b.departures.find(f => f.number === "TEST 12"); // 14:00Z, cancelled
  const arrived = b.arrivals[0];                                    // arrived 11:42Z
  const at = iso => Date.parse(iso);
  assert.equal(isOverdue(delayed, at("2026-10-19T14:05:00Z")), false, "10 min past: not yet");
  assert.equal(isOverdue(delayed, at("2026-10-19T14:11:00Z")), true, "16 min past revised time");
  assert.deepEqual(statusView(delayed, at("2026-10-19T14:11:00Z")), { label: "No recent update", cls: "landed" });
  assert.equal(isOverdue(cancelled, at("2026-10-19T18:00:00Z")), false, "cancelled stays cancelled");
  assert.equal(isOverdue(arrived, at("2026-10-19T18:00:00Z")), false, "finished flights keep their status");
  const demo = { direction: "departure", status: "expected", departure: { scheduled: { utc: null, local: "2000-01-01T05:35" }, revised: null } };
  assert.equal(isOverdue(demo, at("2026-10-19T18:00:00Z")), false, "demo flights have no real time");
  assert.equal(ago("2026-10-19T12:00:00Z", at("2026-10-19T12:18:00Z")), "18 min ago");
  assert.equal(ago("2026-10-19T12:00:00Z", at("2026-10-19T13:05:00Z")), "1 h 5 min ago");
  assert.equal(ago("2026-10-19T12:00:00Z", at("2026-10-19T12:00:20Z")), "just now");
});
