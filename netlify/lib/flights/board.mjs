// The flight board for one airport, kept inside the provider's free quota:
// - the last board per airport is stored and reused for FRESH_MS,
// - the shared monthly unit budget (budget.mjs) stops calls before the
//   provider's limit; a "monthly quota" answer also stops them,
// - when no new call is possible, the last stored board is returned and
//   marked stale, never presented as current.
import { fetchBoard, PROVIDER, WINDOW } from "./aerodatabox.mjs";
import { readUsage, canSpend, recordCall, quotaNotice, UNITS, DEFAULT_MONTHLY_UNIT_CAP } from "./budget.mjs";

export { memoryStore, monthKey, nextMonthStart } from "./budget.mjs";
export const FRESH_MS = 25 * 60 * 1000;

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

// Returns { body, cacheSeconds }. cap: monthly unit cap.
export async function getBoard(airport, { key, store, now = Date.now(), fetchImpl, cap = DEFAULT_MONTHLY_UNIT_CAP } = {}) {
  if (!key) return { body: response("unconfigured", airport, { notice: "Flight data is not connected yet." }), cacheSeconds: 300 };

  const boardKey = "board/" + airport.iata;
  const saved = await store.get(boardKey, { type: "json" });
  if (saved && now - Date.parse(saved.fetchedAt) < FRESH_MS) {
    return { body: response("ok", airport, { board: saved }), cacheSeconds: Math.max(60, Math.round((FRESH_MS - (now - Date.parse(saved.fetchedAt))) / 1000)) };
  }

  const usage = await readUsage(store, now);
  const staleOr = (status, notice) => ({
    body: response(status, airport, { board: saved || null, stale: !!saved, notice, usage: { units: usage.units, cap } }),
    cacheSeconds: 300,
  });
  if (!canSpend(usage, UNITS.board, cap)) return staleOr("quota", quotaNotice(now));

  try {
    const { board, usage: headers } = await fetchBoard(airport, key, { fetchImpl });
    await recordCall(store, now, usage, UNITS.board, { headers });
    const from = new Date(now + WINDOW.offsetMinutes * 60000).toISOString();
    const to = new Date(now + (WINDOW.offsetMinutes + WINDOW.durationMinutes) * 60000).toISOString();
    const stored = { fetchedAt: new Date(now).toISOString(), from, to, ...board };
    await store.setJSON(boardKey, stored);
    return { body: response("ok", airport, { board: stored, usage: { units: usage.units, cap } }), cacheSeconds: Math.round(FRESH_MS / 1000) };
  } catch (err) {
    await recordCall(store, now, usage, UNITS.board, { err });
    if (err.quota) return staleOr("quota", `The free monthly flight data allowance is used up. ${err.message}`);
    return staleOr("error", err.message || "Flight data is unavailable right now.");
  }
}
