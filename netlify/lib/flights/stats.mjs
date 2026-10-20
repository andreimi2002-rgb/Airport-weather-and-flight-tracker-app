// Free statistics: every flight board we fetch anyway (no extra units) leaves
// a compact record per flight in Netlify Blobs, by airport and local day.
// A later board for the same day updates the same flights, so the last known
// status and times win. Days older than KEEP_DAYS are deleted (owner: 90 days).
// The pages that read these come later (phase 2); /api/stats shows a summary.
export const KEEP_DAYS = 90;
export const ON_TIME_MIN = 15; // the usual definition: within 15 minutes

const DONE = new Set(["departed", "en-route", "approaching", "arrived"]);
const T = v => Date.parse(v?.utc);

// Minutes later than scheduled at this airport, from the provider's own times only.
export function delayMinutes(m) {
  const s = T(m?.scheduled), t = T(m?.runway) || T(m?.revised);
  return Number.isFinite(s) && Number.isFinite(t) ? Math.round((t - s) / 60000) : null;
}

// One board flight -> its compact record. Local day from the provider's local time.
export function flightRecord(f) {
  const here = f.direction === "departure" ? f.departure : f.arrival, other = f.direction === "departure" ? f.arrival : f.departure;
  const day = String(here.scheduled?.local || here.scheduled?.utc || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return {
    day,
    rec: {
      n: f.number, al: f.airline?.iata || null, ai: f.airline?.icao || null,
      d: f.direction === "departure" ? "d" : "a", o: other.airport?.iata || null,
      s: here.scheduled?.utc || null, dl: delayMinutes(here),
      st: f.status === "cancelled" ? "x" : DONE.has(f.status) ? "done" : "open",
    },
  };
}

const dayKey = (iata, day) => `stats/${iata}/${day}`;
const indexKey = iata => `stats/${iata}/index`;
const daysBefore = (now, n) => new Date(now - n * 86400000).toISOString().slice(0, 10);

// Adds a freshly fetched board to the airport's daily records; prunes old days.
export async function recordBoard(store, iata, board, now = Date.now()) {
  const byDay = {};
  for (const f of [...(board.departures || []), ...(board.arrivals || [])]) {
    const r = flightRecord(f);
    if (r) (byDay[r.day] ??= {})[f.id] = r.rec;
  }
  for (const [day, recs] of Object.entries(byDay)) {
    const saved = (await store.get(dayKey(iata, day), { type: "json" })) || { day, flights: {} };
    Object.assign(saved.flights, recs);
    saved.updatedAt = new Date(now).toISOString();
    await store.setJSON(dayKey(iata, day), saved);
  }
  const index = new Set((await store.get(indexKey(iata), { type: "json" }))?.days || []);
  for (const day of Object.keys(byDay)) index.add(day);
  const cutoff = daysBefore(now, KEEP_DAYS);
  for (const day of [...index]) if (day < cutoff) { await store.delete?.(dayKey(iata, day)); index.delete(day); }
  await store.setJSON(indexKey(iata), { days: [...index].sort() });
}

// A day's records -> totals: flights, finished, cancelled, on-time share and average delay of finished flights with known times.
export function summarize(flights) {
  const list = Object.values(flights || {});
  const done = list.filter(f => f.st === "done"), timed = done.filter(f => f.dl !== null);
  const onTime = timed.filter(f => f.dl <= ON_TIME_MIN).length;
  return {
    flights: list.length, departures: list.filter(f => f.d === "d").length, arrivals: list.filter(f => f.d === "a").length,
    finished: done.length, cancelled: list.filter(f => f.st === "x").length, withTimes: timed.length,
    onTimePct: timed.length ? Math.round((100 * onTime) / timed.length) : null,
    avgDelayMin: timed.length ? Math.round(timed.reduce((a, f) => a + Math.max(0, f.dl), 0) / timed.length) : null,
  };
}

export async function readDay(store, iata, day) {
  const saved = await store.get(dayKey(iata, day), { type: "json" });
  const index = (await store.get(indexKey(iata), { type: "json" }))?.days || [];
  return { day, days: index, updatedAt: saved?.updatedAt || null, summary: saved ? summarize(saved.flights) : null };
}
