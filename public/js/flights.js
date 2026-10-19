// Flights on the page: fetches /api/flights/<IATA> (a Netlify Function that
// asks AeroDataBox) and turns normalized flights into what the board shows.
import { STATUS_LABEL, isDelayed, isDone, isOverdue, isCancelled } from "./flight-model.js";
import { haversineKm } from "./insights.js";

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

// ---------- board order ----------
// Scheduled time at this airport, as a number (the provider's strings are not
// compared as text).
export function schedMs(f) {
  const s = here(f).scheduled;
  const t = Date.parse(s?.utc);
  return Number.isFinite(t) ? t : Date.parse(s?.local) || 0;
}

// Already happened: landed/departed, or cancelled / not reported with its time passed.
export function isPastFlight(f, now = Date.now()) {
  if (isDone(f)) return true;
  if (f.demo) return false;
  if (isCancelled(f) || isOverdue(f, now)) { const t = Date.parse((here(f).revised || here(f).scheduled)?.utc); return Number.isFinite(t) && t < now; }
  return false;
}

// The board split at "now": flights that already happened, then the ones
// still to come, each in scheduled order (as airport boards do).
export function splitBoard(list, now = Date.now()) {
  const sorted = [...list].sort((a, b) => schedMs(a) - schedMs(b));
  return { earlier: sorted.filter(f => isPastFlight(f, now)), upcoming: sorted.filter(f => !isPastFlight(f, now)) };
}

// Label and colour class for the status pill.
// live: liveStatus() for this flight, if any. While fresh it wins over the
// provider's status (which can lag), except for a cancellation.
export function statusView(f, now = Date.now(), live = null) {
  if (live && f.status !== "cancelled" && now - Date.parse(live.at) < LIVE_FRESH_MS) return { label: live.label, cls: live.cls, live: true };
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
// Where this aircraft is now (adsb.lol) and its confirmed route, if any. Free.
export const fetchAircraftNow = reg => getJSON("/api/aircraft-now/" + encodeURIComponent(reg));
// Its flights on one local date (AeroDataBox, 2 units): only when asked for.
export const fetchAircraftFlights = (reg, date) => getJSON(`/api/aircraft-flights/${encodeURIComponent(reg)}/${date}`);

// "yr-asa " -> "YR-ASA"; null when it can't be a registration. Search also
// needs a hyphen or a US "N" number, so airport codes and words don't match.
export function asRegistration(s) {
  const r = String(s ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,9}$/.test(r)) return null;
  return /^[A-Z0-9]{1,2}-[A-Z0-9]{2,6}$/.test(r) || /^N[1-9][0-9]{0,4}[A-Z]{0,2}$/.test(r) ? r : null;
}
export const aircraftPath = reg => "/aircraft/" + encodeURIComponent(reg);

// How far along A->B the aircraft is (0-100), from its live position; null without one.
export function liveProgressPct(ac, A, B) {
  const p = { lat: ac?.lat, lon: ac?.lon };
  const done = haversineKm(A, p), left = haversineKm(p, B);
  if (done === null || left === null || done + left === 0) return null;
  return Math.round((100 * done) / (done + left));
}
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

// The aircraft of this airline flying exactly this route near pos (adsb.lol).
// number: the digits of the flight number ("W4 0346" -> "346"), or "-" when unknown.
export const flightDigits = f => /^\S+\s+0*(\d{1,4}[A-Z]?)$/.exec(String(f.number || "").trim().toUpperCase())?.[1] || "-";
export const fetchIdentify = (airlineIcao, number, from, to, pos) =>
  getJSON(`/api/identify/${encodeURIComponent(airlineIcao)}/${encodeURIComponent(number)}/${from}/${to}/${pos.lat.toFixed(2)}/${pos.lon.toFixed(2)}`);

// True when both sides name a type family and they differ (e.g. "A320" vs "Boeing 737-800").
// The board often lists the planned type; airlines swap within a family
// (an A321 instead of an A320), so only a different family is a conflict.
const FAMILY_GROUP = { 318: "A320", 319: "A320", 320: "A320", 321: "A320", 170: "EJET", 175: "EJET", 190: "EJET", 195: "EJET", 42: "ATR", 72: "ATR", 200: "CRJ", 700: "CRJ", 900: "CRJ", 1000: "CRJ" };
const group = n => FAMILY_GROUP[n] || String(n);
export function typeConflicts(typeCode, boardModel) {
  const fam = TYPE_FAMILY[String(typeCode || "").toUpperCase()];
  const n = /(\d+)/.exec(String(boardModel || ""));
  return !!fam && !!n && group(fam) !== group(Number(n[1]));
}
// True when the live aircraft is another type of the same family (e.g. A321 for a planned A320).
export function typeDiffers(typeCode, boardModel) {
  const fam = TYPE_FAMILY[String(typeCode || "").toUpperCase()];
  const n = /(\d+)/.exec(String(boardModel || ""));
  return !!fam && !!n && fam !== Number(n[1]) && !typeConflicts(typeCode, boardModel);
}

// Labelled live values for the drawer: altitude, ground speed, vertical, as people read them.
export function liveFields(ac) {
  if (!ac) return [];
  const NA = "Not available";
  const alt = ac.onGround ? "On the ground"
    : ac.altitudeFt === null || ac.altitudeFt === undefined ? NA
    : `${ac.altitudeFt.toLocaleString("en-US")} ft · ${Math.round(ac.altitudeFt * 0.3048).toLocaleString("en-US")} m` + (ac.altitudeFt >= 18000 ? ` (FL${String(Math.round(ac.altitudeFt / 100)).padStart(3, "0")})` : "");
  const spd = ac.groundSpeedKt === null || ac.groundSpeedKt === undefined ? NA : `${ac.groundSpeedKt} kt · ${Math.round(ac.groundSpeedKt * 1.852)} km/h`;
  const vr = ac.verticalRateFpm;
  const vert = ac.onGround ? "—" : vr === null || vr === undefined ? NA : Math.abs(vr) < 300 ? "Level" : `${vr > 0 ? "Climbing" : "Descending"} ${Math.abs(Math.round(vr / 50) * 50).toLocaleString("en-US")} ft/min`;
  return [["ALTITUDE", alt], ["GROUND SPEED", spd], ["VERTICAL", vert]];
}

// Live data older than this no longer says where the aircraft is now.
export const LIVE_FRESH_MS = 15 * 60 * 1000;
const NEAR_AIRPORT_KM = 15, APPROACH_KM = 120;

// What live ADS-B data says about this flight, or null when it can't say:
// the identified aircraft on the ground at the destination (after departure
// time) -> landed; on the ground at the origin -> not left yet; in the air ->
// in the air, or approaching when close to the destination and coming down.
// from/to: airports with lat/lon. Times are what the provider scheduled.
export function liveStatus(f, ac, from, to, now = Date.now()) {
  const seen = Date.parse(ac?.seenAt);
  if (!ac || !Number.isFinite(ac.lat) || !Number.isFinite(ac.lon) || !(now - seen < LIVE_FRESH_MS)) return null;
  const pos = { lat: ac.lat, lon: ac.lon };
  const toKm = haversineKm(pos, to), fromKm = haversineKm(pos, from);
  const t = m => Date.parse((m.runway || m.revised || m.scheduled)?.utc);
  const depAt = t(f.departure), arrAt = t(f.arrival);
  const base = { at: ac.seenAt, live: true };
  if (ac.onGround) {
    if (toKm !== null && toKm <= NEAR_AIRPORT_KM && now > depAt) return { ...base, label: "Landed (live data)", cls: "landed", key: "landed" };
    if (fromKm !== null && fromKm <= NEAR_AIRPORT_KM && !(now > arrAt)) return { ...base, label: `On the ground at ${from.iata} (live data)`, cls: "boarding", key: "ground" };
    return null; // on the ground somewhere else: don't guess
  }
  const descending = Number.isFinite(ac.verticalRateFpm) && ac.verticalRateFpm <= -300;
  if (toKm !== null && toKm <= APPROACH_KM && (descending || (Number.isFinite(ac.altitudeFt) && ac.altitudeFt < 10000))) {
    return { ...base, label: `Approaching ${to.iata} (live data)`, cls: "landed", key: "approaching" };
  }
  return { ...base, label: "In the air (live data)", cls: "landed", key: "air" };
}

// Turboprops such as older ATR 72s often don't broadcast an ADS-B position,
// so they are missing from open live data however good the matching is.
const OFTEN_INVISIBLE = /\bATR\b|\bDash ?8\b|\bDHC-8\b|\bQ400\b|\bSaab 340\b|\bJetstream\b|\bDornier 328\b/i;

// The drawer's message when the aircraft wasn't found. why: which step found nothing.
// A failed service or used-up lookups keep their exact wording.
export function notFoundMessage(model, why = "") {
  const serviceProblem = /used up|unavailable|failed|adsb\.lol|GitHub|not in the open airline list|no airline code|not in our airport list/i.test(why);
  if (OFTEN_INVISIBLE.test(String(model || "")) && !serviceProblem) {
    return "Aircraft not visible in live ADS-B data (some aircraft, e.g. older ATR 72s, don't broadcast their position)";
  }
  return "Aircraft not found in live ADS-B data" + (why ? ": " + why : "");
}
