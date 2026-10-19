// Flights on the page: fetches /api/flights/<IATA> (a Netlify Function that
// asks AeroDataBox) and turns normalized flights into what the board shows.
import { STATUS_LABEL, isDelayed, isDone, isOverdue } from "./flight-model.js";

// "just now", "18 min ago", "1 h 5 min ago"
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return min + " min ago";
  return Math.floor(min / 60) + " h" + (min % 60 ? " " + (min % 60) + " min" : "") + " ago";
}

export const REFRESH_MS = 15 * 60 * 1000;

// Last answer with a board per airport, so a failed refresh can keep showing it.
const lastGood = new Map();

export async function fetchFlights(iata) {
  try {
    const res = await fetch("/api/flights/" + encodeURIComponent(iata));
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) throw new Error(body?.error || "HTTP " + res.status);
    if (body.board) lastGood.set(iata, body);
    return body;
  } catch (err) {
    const prev = lastGood.get(iata);
    if (prev) return { ...prev, stale: true, notice: "Couldn't refresh flights (" + err.message + ")." };
    throw err;
  }
}

// "2026-10-19T16:30+03:00" -> "16:30" (airport local time as the provider gives it).
export const hhmm = t => (t?.local && /T\d\d:\d\d/.test(t.local) ? t.local.slice(11, 16) : "—");

export const here = f => (f.direction === "departure" ? f.departure : f.arrival);
export const other = f => (f.direction === "departure" ? f.arrival : f.departure);

// Label and colour class for the status pill.
export function statusView(f, now = Date.now()) {
  if (isOverdue(f, now)) return { label: "No recent update", cls: "landed" };
  // Late but no explicit status yet: say "Delayed". Boarding, gate closed etc. keep their own label.
  if (isDelayed(f) && ["scheduled", "expected", "check-in"].includes(f.status)) return { label: "Delayed", cls: "delayed" };
  const cls = {
    delayed: "delayed", "maybe-cancelled": "delayed",
    boarding: "boarding", "gate-closed": "boarding", "check-in": "boarding",
    cancelled: "cancelled", diverted: "cancelled",
    departed: "landed", "en-route": "landed", approaching: "landed", arrived: "landed",
  }[f.status] || "";
  return { label: STATUS_LABEL[f.status] || "Scheduled", cls };
}

// Second time column: revised (or runway) time, labelled actual or estimated.
export function updateTime(f) {
  const m = here(f);
  const t = m.revised || m.runway;
  if (!t) return { time: "—", note: "No update" };
  return { time: hhmm(t), note: isDone(f) ? "Actual" : "Estimated" };
}

export const placeName = a => a?.city || a?.name || a?.iata || "Not available";

export function fmtDuration(min) {
  if (min === null || min === undefined || min <= 0) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return (h ? h + "h " : "") + String(m).padStart(h ? 2 : 1, "0") + "m";
}

// Next flight still to happen at this airport: not finished, not cancelled,
// and its expected (or scheduled) time not already past. Schedule-only
// flights never report "departed", so the time check matters.
export function nextFlight(flights, direction, now = Date.now()) {
  return flights.find(f => {
    if (f.direction !== direction || isDone(f) || f.status === "cancelled" || f.status === "maybe-cancelled") return false;
    const t = Date.parse((here(f).revised || here(f).scheduled)?.utc);
    return !Number.isFinite(t) || t >= now - 5 * 60000;
  });
}

// ---------- on-demand details (only when a flight is opened) ----------
async function getJSON(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(body?.error || "HTTP " + res.status);
  return body;
}
export const fetchAircraft = reg => getJSON("/api/aircraft/" + encodeURIComponent(reg));

// date: the flight's local date at this airport ("2026-10-19").
export function fetchFlightStatus(f, iata) {
  const number = String(f.number).replace(/\s+/g, "").toUpperCase();
  const date = (here(f).scheduled?.local || "").slice(0, 10);
  return getJSON(`/api/flight-status/${encodeURIComponent(number)}/${date}/${iata}`);
}

// Display helpers for the aircraft section. null -> "Not available".
export function aircraftFields(a) {
  const NA = "Not available";
  if (!a) return { acReg: NA, acAge: NA, acSeats: NA, acEngines: NA, acDelivered: NA, acOperator: NA };
  const engines = a.engines !== null ? a.engines + (a.engineType ? " × " + a.engineType.toLowerCase() : "") : a.engineType || NA;
  return {
    acReg: a.registration || NA,
    acAge: a.ageYears !== null ? a.ageYears.toFixed(1) + " years" : NA,
    acSeats: a.seats !== null ? String(a.seats) : NA,
    acEngines: engines,
    acDelivered: a.deliveryDate || NA,
    acOperator: a.airline || NA,
  };
}

// ---------- the actual aircraft from free sources ----------
export const fetchAircraftPhoto = reg => getJSON("/api/aircraft-photo/" + encodeURIComponent(reg));
export const fetchLive = callsign => getJSON("/api/live/" + encodeURIComponent(callsign));

// ICAO callsign to look for in live ADS-B data. The provider's own callsign is
// trusted; otherwise "<airline ICAO><flight number>" is only a guess, so the
// caller must check the aircraft type before using what it finds.
export function callsignFor(f) {
  const own = String(f.callSign || "").toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z0-9]{3,8}$/.test(own)) return { callsign: own, fromProvider: true };
  const icao = String(f.airline?.icao || "").toUpperCase();
  const m = /^\S+\s+0*(\d{1,4}[A-Z]?)$/.exec(String(f.number || "").trim().toUpperCase());
  if (/^[A-Z]{3}$/.test(icao) && m) return { callsign: icao + m[1], fromProvider: false };
  return null;
}

// ICAO type designator -> the number people use for the type (A21N -> 321, B38M -> 737).
const TYPE_FAMILY = {
  A318: 318, A319: 319, A320: 320, A321: 321, A19N: 319, A20N: 320, A21N: 321,
  A332: 330, A333: 330, A338: 330, A339: 330, A342: 340, A343: 340, A345: 340, A346: 340, A359: 350, A35K: 350, A388: 380,
  BCS1: 220, BCS3: 220,
  B733: 737, B734: 737, B735: 737, B736: 737, B737: 737, B738: 737, B739: 737, B37M: 737, B38M: 737, B39M: 737, B3XM: 737,
  B744: 747, B748: 747, B752: 757, B753: 757, B762: 767, B763: 767, B764: 767,
  B772: 777, B773: 777, B77L: 777, B77W: 777, B778: 777, B779: 777, B788: 787, B789: 787, B78X: 787,
  E170: 170, E75L: 175, E75S: 175, E190: 190, E195: 195, E290: 190, E295: 195,
  AT43: 42, AT45: 42, AT46: 42, AT72: 72, AT75: 72, AT76: 72, DH8D: 8, CRJ2: 200, CRJ7: 700, CRJ9: 900, CRJX: 1000, SU95: 100,
};
// True only when both sides name the same type family (e.g. "A21N" and "Airbus A321 NEO").
export function typeMatches(typeCode, boardModel) {
  const fam = TYPE_FAMILY[String(typeCode || "").toUpperCase()];
  const n = /(\d+)/.exec(String(boardModel || ""));
  return !!fam && !!n && Number(n[1]) === fam;
}

// "FL400 · 467 kt" or "On the ground"
export function liveLine(ac) {
  if (!ac) return "";
  if (ac.onGround) return "On the ground";
  const alt = ac.altitudeFt === null ? null : ac.altitudeFt >= 18000 ? "FL" + String(Math.round(ac.altitudeFt / 100)).padStart(3, "0") : ac.altitudeFt.toLocaleString("en-US") + " ft";
  return [alt, ac.groundSpeedKt !== null ? ac.groundSpeedKt + " kt" : null].filter(Boolean).join(" · ") || "Airborne";
}
