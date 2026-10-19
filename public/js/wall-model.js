// Wall board (/board/OTP): which flights it shows, when it reloads, and how
// rows are split into pages that fit the screen. Pure functions, tested.
import { isDone } from "./flight-model.js";

// Flight data costs units (2 per board on the free plan), so a board left
// open reloads once an hour and not at night (airport time).
export const WALL_REFRESH_MS = 60 * 60 * 1000;
export const NIGHT_FROM_HOUR = 0, NIGHT_TO_HOUR = 5;
export const KEEP_DONE_MIN = 20;     // finished flights stay this long
export const KEEP_PAST_MIN = 60;     // unfinished flights with a passed time stay this long
export const PAGE_MS = 12 * 1000;

const T = m => Date.parse((m?.runway || m?.revised || m?.scheduled)?.utc);
const S = m => Date.parse(m?.scheduled?.utc);
const at = f => (f.direction === "departure" ? f.departure : f.arrival);

// Flights for one side of the board, in scheduled order: upcoming ones, plus
// recently finished ones for a short while.
export function wallRows(flights, direction, now = Date.now()) {
  return flights
    .filter(f => f.direction === direction)
    .filter(f => {
      const t = T(at(f));
      if (!Number.isFinite(t)) return true;
      if (isDone(f) || f.status === "cancelled") return t >= now - KEEP_DONE_MIN * 60000;
      return t >= now - KEEP_PAST_MIN * 60000;
    })
    .sort((a, b) => (S(at(a)) || 0) - (S(at(b)) || 0));
}

// Hour (0-23) at the airport.
export function localHourAt(tz, now = Date.now()) {
  try { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", hour12: false }).format(new Date(now))) % 24; }
  catch { return new Date(now).getUTCHours(); }
}
export const isNight = (tz, now = Date.now()) => { const h = localHourAt(tz, now); return h >= NIGHT_FROM_HOUR && h < NIGHT_TO_HOUR; };

// Reload when the last load is an hour old, except at night.
export function shouldReload(lastLoadAt, tz, now = Date.now()) {
  if (!Number.isFinite(lastLoadAt)) return true;
  return now - lastLoadAt >= WALL_REFRESH_MS && !isNight(tz, now);
}

// Rows split into pages of perPage; page wraps around.
export function pageOf(rows, perPage, page) {
  const n = Math.max(1, perPage | 0);
  const pages = Math.max(1, Math.ceil(rows.length / n));
  const p = ((page % pages) + pages) % pages;
  return { rows: rows.slice(p * n, p * n + n), page: p, pages };
}
