// The flight board for one airport, kept inside the provider's free quota:
// - the last board per airport is stored and reused for FRESH_MS,
// - a monthly call budget (calendar month, UTC) stops calls before the
//   provider's limit; a 429 from the provider also stops them,
// - when no new call is possible, the last stored board is returned and
//   marked stale, never presented as current.
import { fetchBoard, PROVIDER, WINDOW } from "./aerodatabox.mjs";

export const FRESH_MS = 25 * 60 * 1000;
export const DEFAULT_MONTHLY_CAP = 180; // Basic plan: 400 units = 200 calls; keep a margin

export const monthKey = now => new Date(now).toISOString().slice(0, 7);
export function nextMonthStart(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

// Same shape as a Netlify Blobs store; used in tests and when Blobs is unavailable.
export function memoryStore() {
  const m = new Map();
  return {
    async get(key) { return m.has(key) ? structuredClone(m.get(key)) : null; },
    async setJSON(key, value) { m.set(key, structuredClone(value)); },
  };
}

function response(status, airport, extra = {}) {
  return {
    version: 1,
    status,                 // "ok" | "unconfigured" | "quota" | "error"
    provider: PROVIDER,
    airport: { iata: airport.iata, name: airport.name, tz: airport.tz },
    board: null,            // { fetchedAt, from, to, live, departures, arrivals } when there is one
    stale: false,           // true: the board is older than normal, see notice
    notice: null,
    ...extra,
  };
}

// Returns { body, cacheSeconds }.
export async function getBoard(airport, { key, store, now = Date.now(), fetchImpl, cap = DEFAULT_MONTHLY_CAP } = {}) {
  if (!key) return { body: response("unconfigured", airport, { notice: "Flight data is not connected yet." }), cacheSeconds: 300 };

  const boardKey = "board/" + airport.iata;
  const usageKey = "usage/" + monthKey(now);
  const saved = await store.get(boardKey, { type: "json" });
  if (saved && now - Date.parse(saved.fetchedAt) < FRESH_MS) {
    return { body: response("ok", airport, { board: saved }), cacheSeconds: Math.max(60, Math.round((FRESH_MS - (now - Date.parse(saved.fetchedAt))) / 1000)) };
  }

  const usage = (await store.get(usageKey, { type: "json" })) || { calls: 0, exhausted: false };
  const staleOr = (status, notice) => ({
    body: response(status, airport, { board: saved || null, stale: !!saved, notice, usage: { calls: usage.calls, cap } }),
    cacheSeconds: 300,
  });
  if (usage.exhausted || usage.calls >= cap) {
    return staleOr("quota", `The free monthly flight data allowance is used up. New data from ${nextMonthStart(now).slice(0, 10)}.`);
  }

  try {
    const { board, usage: headers } = await fetchBoard(airport.iata, key, { fetchImpl });
    usage.calls += 1;
    usage.lastHeaders = headers;
    usage.lastCallAt = new Date(now).toISOString();
    await store.setJSON(usageKey, usage);
    const from = new Date(now + WINDOW.offsetMinutes * 60000).toISOString();
    const to = new Date(now + (WINDOW.offsetMinutes + WINDOW.durationMinutes) * 60000).toISOString();
    const stored = { fetchedAt: new Date(now).toISOString(), from, to, ...board };
    await store.setJSON(boardKey, stored);
    return { body: response("ok", airport, { board: stored, usage: { calls: usage.calls, cap } }), cacheSeconds: Math.round(FRESH_MS / 1000) };
  } catch (err) {
    // The provider answered, so the call may have counted; a refused key did not.
    if (err.status !== null && err.status !== undefined && err.status !== 401 && err.status !== 403) usage.calls += 1;
    if (err.quota) usage.exhausted = true;
    usage.lastError = { at: new Date(now).toISOString(), message: err.message };
    await store.setJSON(usageKey, usage);
    if (err.quota) return staleOr("quota", `The free monthly flight data allowance is used up. ${err.message}`);
    return staleOr("error", err.message || "Flight data is unavailable right now.");
  }
}
