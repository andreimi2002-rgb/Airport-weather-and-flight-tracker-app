// On-demand details, only when someone opens a flight:
// - aircraft by registration (1 unit), stored 7 days (Basic plan caching limit),
// - current status of one flight (2 units), stored 5 minutes,
// - one aircraft's flights on a day (2 units, only on request): today 10 minutes, past days 7 days.
// Both use the shared monthly unit budget and never present old data as new.
import { fetchAircraft, fetchFlightStatus, fetchAircraftFlights, normalizeFlight, PROVIDER } from "./aerodatabox.mjs";
import { readUsage, canSpend, recordCall, quotaNotice, UNITS, DEFAULT_MONTHLY_UNIT_CAP } from "./budget.mjs";

export const AIRCRAFT_FRESH_MS = 7 * 24 * 3600 * 1000;
export const STATUS_FRESH_MS = 5 * 60 * 1000;

export const isRegistration = s => /^[A-Z0-9][A-Z0-9-]{1,9}$/.test(s);
// Airline code (IATA "RO", "W4", "9W" or ICAO "ROT") + 1-5 digits (+ optional suffix letter).
export const isFlightNumber = s => /^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d{1,5}[A-Z]?$/.test(s);
export const isLocalDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

const base = (status, extra) => ({ version: 1, status, provider: PROVIDER, notice: null, ...extra });

// Shared flow: stored answer if fresh, else budget check, provider call, store.
async function cachedCall({ store, storeKey, freshMs, units, cap, now, call, key }) {
  if (!key) return { body: base("unconfigured", { notice: "Flight data is not connected yet." }), cacheSeconds: 300 };
  const saved = await store.get(storeKey, { type: "json" });
  if (saved && now - Date.parse(saved.fetchedAt) < freshMs) {
    return { body: base("ok", saved), cacheSeconds: Math.max(60, Math.min(3600, Math.round((freshMs - (now - Date.parse(saved.fetchedAt))) / 1000))) };
  }
  const usage = await readUsage(store, now);
  const old = saved ? { ...saved, stale: true } : {};
  if (!canSpend(usage, units, cap)) return { body: base("quota", { ...old, notice: quotaNotice(now) }), cacheSeconds: 300 };
  try {
    const { value, usage: headers } = await call();
    await recordCall(store, now, usage, units, { headers });
    const stored = { fetchedAt: new Date(now).toISOString(), ...value };
    await store.setJSON(storeKey, stored);
    return { body: base("ok", stored), cacheSeconds: Math.min(3600, Math.round(freshMs / 1000)) };
  } catch (err) {
    await recordCall(store, now, usage, units, { err });
    return { body: base(err.quota ? "quota" : "error", { ...old, notice: err.message || "Flight data is unavailable right now." }), cacheSeconds: 60 };
  }
}

// reg: upper-case tail number. Body: { status, aircraft|null, fetchedAt, ... }
export function getAircraft(reg, { key, store, now = Date.now(), fetchImpl, cap = DEFAULT_MONTHLY_UNIT_CAP } = {}) {
  return cachedCall({
    key, store, now, cap, units: UNITS.aircraft, freshMs: AIRCRAFT_FRESH_MS, storeKey: "aircraft/" + reg,
    call: async () => {
      const { aircraft, usage } = await fetchAircraft(reg, key, { fetchImpl });
      return { value: { aircraft }, usage };
    },
  });
}

// The flight with this number on this local date, seen from airport `here`
// (the leg that departs from or arrives at it). Body: { status, flight|null, fetchedAt, ... }
export function getFlightStatus(number, dateLocal, here, { key, store, now = Date.now(), fetchImpl, cap = DEFAULT_MONTHLY_UNIT_CAP } = {}) {
  return cachedCall({
    key, store, now, cap, units: UNITS.flightStatus, freshMs: STATUS_FRESH_MS, storeKey: `status/${number}/${dateLocal}/${here.iata}`,
    call: async () => {
      const { flights, usage } = await fetchFlightStatus(number, dateLocal, key, { fetchImpl });
      const hereRef = { iata: here.iata, icao: here.icao || null, name: here.name || null, city: here.city || null, country: null };
      const dep = flights.find(f => f.departure?.airport?.iata === here.iata);
      const arr = flights.find(f => f.arrival?.airport?.iata === here.iata);
      const flight = dep ? normalizeFlight(dep, "departure", hereRef) : arr ? normalizeFlight(arr, "arrival", hereRef) : null;
      return { value: { flight }, usage };
    },
  });
}

export const HISTORY_TODAY_FRESH_MS = 10 * 60 * 1000;

// Flights of aircraft reg on a local date, newest first. Body: { status, flights: [Flight], fetchedAt, ... }
// A past day doesn't change, so it is kept longer (UTC date: close enough to "past").
export function getAircraftFlights(reg, dateLocal, { key, store, now = Date.now(), fetchImpl, cap = DEFAULT_MONTHLY_UNIT_CAP } = {}) {
  const past = dateLocal < new Date(now - 24 * 3600 * 1000).toISOString().slice(0, 10);
  return cachedCall({
    key, store, now, cap, units: UNITS.flightStatus, freshMs: past ? AIRCRAFT_FRESH_MS : HISTORY_TODAY_FRESH_MS, storeKey: `history/${reg}/${dateLocal}`,
    call: async () => {
      const { flights, usage } = await fetchAircraftFlights(reg, dateLocal, key, { fetchImpl });
      const list = flights.map(f => normalizeFlight(f, "departure")).sort((a, b) => String(b.departure.scheduled?.utc || "").localeCompare(String(a.departure.scheduled?.utc || "")));
      return { value: { flights: list }, usage };
    },
  });
}
