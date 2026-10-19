// Monthly budget for the flight data provider, counted in provider units
// (AeroDataBox Basic: 400 units/month; board = 2, aircraft = 1, flight
// status = 2). Shared by every flight function through one Blobs record
// per calendar month (UTC). A "monthly quota" answer from the provider
// marks the month as used up.

export const DEFAULT_MONTHLY_UNIT_CAP = 360; // keep a margin below 400
export const UNITS = { board: 2, aircraft: 1, flightStatus: 2 };

export const monthKey = now => new Date(now).toISOString().slice(0, 7);
export function nextMonthStart(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}
export const quotaNotice = now => `The free monthly flight data allowance is used up. New data from ${nextMonthStart(now).slice(0, 10)}.`;

// Same shape as a Netlify Blobs store; used in tests and when Blobs is unavailable.
export function memoryStore() {
  const m = new Map();
  return {
    async get(key) { return m.has(key) ? structuredClone(m.get(key)) : null; },
    async setJSON(key, value) { m.set(key, structuredClone(value)); },
  };
}

export async function readUsage(store, now) {
  const u = (await store.get("usage/" + monthKey(now), { type: "json" })) || {};
  // Records written before units were counted held board calls (2 units each).
  return { ...u, units: u.units ?? (u.calls || 0) * UNITS.board, exhausted: !!u.exhausted };
}

export const canSpend = (usage, units, cap) => !usage.exhausted && usage.units + units <= cap;

// After a provider call. err: the ProviderError, if the call failed.
export async function recordCall(store, now, usage, units, { headers, err } = {}) {
  // A refused key (401/403) or no answer at all was not billed.
  const billed = !err || (err.status !== null && err.status !== undefined && err.status !== 401 && err.status !== 403);
  if (billed) usage.units += units;
  if (err?.quota) usage.exhausted = true;
  if (err) usage.lastError = { at: new Date(now).toISOString(), message: err.message };
  else { usage.lastCallAt = new Date(now).toISOString(); if (headers) usage.lastHeaders = headers; }
  delete usage.calls;
  await store.setJSON("usage/" + monthKey(now), usage);
}
