// Airport insights computed from the flight board the page already has.
// No extra provider calls: everything here is arithmetic on normalized
// flights (see flight-model.js). Nothing is estimated beyond what the
// provider's own times say; where a value can't be computed it is null.
import { isDelayed, isCancelled, isDone } from "./flight-model.js";

const T = t => Date.parse(t?.utc);
export const hereMove = f => (f.direction === "departure" ? f.departure : f.arrival);
export const otherMove = f => (f.direction === "departure" ? f.arrival : f.departure);

// Late minutes at this airport, only when the provider gave a revised (or runway) time.
export function lateMinutes(f) {
  const m = hereMove(f);
  const s = T(m.scheduled), r = T(m.revised || m.runway);
  return Number.isFinite(s) && Number.isFinite(r) ? Math.round((r - s) / 60000) : null;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const avg = list => (list.length ? Math.round(list.reduce((s, x) => s + x, 0) / list.length) : null);

// Headline numbers for one direction (or all flights).
export function punctuality(flights) {
  const judged = flights.filter(f => !isCancelled(f) && f.status !== "diverted");
  const late = judged.filter(isDelayed);
  const withTimes = judged.map(lateMinutes).filter(m => m !== null);
  const positive = withTimes.filter(m => m > 0);
  return {
    total: flights.length,
    onTimePct: pct(judged.length - late.length, judged.length),
    delayed: late.length,
    cancelled: flights.filter(isCancelled).length,
    diverted: flights.filter(f => f.status === "diverted").length,
    avgDelayMin: avg(positive),           // average lateness of the flights that are late
    maxDelayMin: positive.length ? Math.max(...positive) : null,
    reportedTimes: withTimes.length,       // flights with a revised/actual time (how much the averages are based on)
  };
}

// Flights per hour of the board window, split by direction, with delays.
// Returns [{ start: ms, dep, arr, depLate, arrLate, cancelled }].
export function hourlyTraffic(flights, fromIso, toIso) {
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  const times = flights.map(f => T(hereMove(f).scheduled)).filter(Number.isFinite);
  const lo = Number.isFinite(from) ? from : Math.min(...times);
  const hi = Number.isFinite(to) ? to : Math.max(...times) + 1;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const start = Math.floor(lo / 3600000) * 3600000;
  const n = Math.min(48, Math.ceil((hi - start) / 3600000));
  const buckets = Array.from({ length: n }, (_, i) => ({ start: start + i * 3600000, dep: 0, arr: 0, depLate: 0, arrLate: 0, cancelled: 0 }));
  for (const f of flights) {
    const t = T(hereMove(f).scheduled);
    if (!Number.isFinite(t)) continue;
    const b = buckets[Math.floor((t - start) / 3600000)];
    if (!b) continue;
    const d = f.direction === "departure";
    b[d ? "dep" : "arr"]++;
    if (isDelayed(f)) b[d ? "depLate" : "arrLate"]++;
    if (isCancelled(f)) b.cancelled++;
  }
  return buckets;
}

// Most frequent values, e.g. airlines or destinations. key(f) -> { id, label, sub? } or null.
export function topBy(flights, key, limit = 5) {
  const map = new Map();
  for (const f of flights) {
    const k = key(f);
    if (!k || !k.id) continue;
    const e = map.get(k.id) || { ...k, count: 0, late: 0 };
    e.count++;
    if (isDelayed(f)) e.late++;
    map.set(k.id, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

export const airlineKey = f => (f.airline?.name || f.airline?.iata ? { id: f.airline.iata || f.airline.icao || f.airline.name, label: f.airline.name || f.airline.iata, code: f.airline.iata || f.airline.icao || null } : null);
export const routeKey = f => {
  const a = otherMove(f).airport;
  if (!a?.iata && !a?.name) return null;
  return { id: a.iata || a.name, label: a.city || a.name || a.iata, code: a.iata || null };
};
export const aircraftKey = f => (f.aircraft?.model ? { id: f.aircraft.model, label: f.aircraft.model } : null);

// Progress of a flight in the air, from the provider's own times only:
// departure actual (revised/runway) and arrival estimate (or schedule).
// Returns { pct 0..100, state: "before"|"air"|"after"|null, elapsedMin, remainingMin }.
export function flightProgress(f, now = Date.now()) {
  const dep = f.departure, arr = f.arrival;
  const leftAt = T(dep.runway) || T(dep.revised) || T(dep.scheduled);
  const landAt = T(arr.runway) || T(arr.revised) || T(arr.scheduled);
  if (!Number.isFinite(leftAt) || !Number.isFinite(landAt) || landAt <= leftAt) return { pct: null, state: null, elapsedMin: null, remainingMin: null };
  const landed = f.status === "arrived";
  const departed = landed || ["departed", "en-route", "approaching"].includes(f.status);
  if (landed || (departed && now >= landAt)) return { pct: 100, state: "after", elapsedMin: Math.round((landAt - leftAt) / 60000), remainingMin: 0 };
  if (!departed) return { pct: 0, state: "before", elapsedMin: 0, remainingMin: Math.round((landAt - leftAt) / 60000) };
  const p = Math.max(0, Math.min(100, ((now - leftAt) / (landAt - leftAt)) * 100));
  return { pct: Math.round(p), state: "air", elapsedMin: Math.max(0, Math.round((now - leftAt) / 60000)), remainingMin: Math.max(0, Math.round((landAt - now) / 60000)) };
}

// "in 25 min", "12 min ago", "now"
export function relative(iso, now = Date.now()) {
  const t = Date.parse(iso?.utc ?? iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((t - now) / 60000);
  if (Math.abs(min) < 1) return "now";
  const abs = Math.abs(min), h = Math.floor(abs / 60), m = abs % 60;
  const txt = h ? `${h} h${m ? " " + m + " min" : ""}` : `${m} min`;
  return min > 0 ? "in " + txt : txt + " ago";
}

// Great-circle distance between two lat/lon points (km). Used only when
// the provider gives no distance and both airports are in our list.
export function haversineKm(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return null;
  const R = 6371, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// Milestones for the flight timeline: only events the provider's data supports.
// Each { key, label, time: Time|null, done: boolean, kind: "scheduled"|"estimated"|"actual" }.
export function milestones(f, now = Date.now()) {
  const dep = f.departure, arr = f.arrival;
  const departed = ["departed", "en-route", "approaching", "arrived"].includes(f.status);
  const landed = f.status === "arrived";
  const pick = (m, isDoneNow) => {
    if (m.runway) return { time: m.runway, kind: "actual" };
    if (m.revised) return { time: m.revised, kind: isDoneNow ? "actual" : "estimated" };
    return { time: m.scheduled, kind: "scheduled" };
  };
  const list = [];
  if (f.status === "boarding" || f.status === "gate-closed" || departed) list.push({ key: "boarding", label: f.status === "gate-closed" ? "Gate closed" : "Boarding", time: null, done: true, kind: "actual" });
  list.push({ key: "dep", label: "Departure from " + (dep.airport.iata || dep.airport.name || "origin"), ...pick(dep, departed), done: departed });
  list.push({ key: "arr", label: "Arrival at " + (arr.airport.iata || arr.airport.name || "destination"), ...pick(arr, landed), done: landed });
  if (f.status === "cancelled") list.push({ key: "x", label: "Cancelled", time: null, done: true, kind: "actual" });
  if (f.status === "diverted") list.push({ key: "x", label: "Diverted", time: null, done: true, kind: "actual" });
  return list;
}

export { isDone };
