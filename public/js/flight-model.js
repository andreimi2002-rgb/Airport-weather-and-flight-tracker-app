// Normalized flight data, the same whatever provider supplies it.
// A field the provider does not supply is null; the page shows
// "Not available". Nothing is filled in by guessing.

/**
 * @typedef {{ utc: string, local: string }} Time  ISO 8601; local carries the airport's offset
 * @typedef {{ iata: string|null, icao: string|null, name: string|null, city: string|null, country: string|null }} AirportRef
 * @typedef {{ url: string, pageUrl: string|null, author: string|null, licence: string|null, attribution: string[],
 *             kind: "representative" }} AircraftPhoto  "representative": may show another aircraft of the same airline/model
 * @typedef {{ registration: string|null, model: string|null, modeS: string|null, photo: AircraftPhoto|null }} Aircraft
 * @typedef {{ airport: AirportRef, scheduled: Time|null, revised: Time|null, runway: Time|null,
 *             terminal: string|null, gate: string|null, checkInDesk: string|null, baggageBelt: string|null, live: boolean }} Movement
 * @typedef {{
 *   id: string, direction: "departure"|"arrival", number: string, callSign: string|null,
 *   airline: { name: string|null, iata: string|null, icao: string|null },
 *   status: Status, providerStatus: string|null,
 *   departure: Movement, arrival: Movement,  // "here" is departure for departures, arrival for arrivals
 *   delayMinutes: number|null,               // revised minus scheduled at this airport, when both known
 *   distanceKm: number|null,                 // great-circle distance
 *   scheduledDurationMinutes: number|null,   // scheduled arrival minus scheduled departure, when both known
 *   isCargo: boolean, aircraft: Aircraft, updatedAt: string|null
 * }} Flight
 * @typedef {"scheduled"|"expected"|"check-in"|"boarding"|"gate-closed"|"departed"|"en-route"|"approaching"|"arrived"|"delayed"|"cancelled"|"maybe-cancelled"|"diverted"} Status
 */

export const STATUS_LABEL = {
  scheduled: "Scheduled", expected: "Expected", "check-in": "Check-in", boarding: "Boarding", "gate-closed": "Gate closed",
  departed: "Departed", "en-route": "En route", approaching: "Approaching", arrived: "Arrived", delayed: "Delayed",
  cancelled: "Cancelled", "maybe-cancelled": "May be cancelled", diverted: "Diverted",
};

// A flight counts as delayed when the provider says so, or when its own
// revised time is at least this much later than scheduled.
export const DELAY_THRESHOLD_MIN = 15;

export function minutesBetween(a, b) {
  const t1 = Date.parse(a?.utc), t2 = Date.parse(b?.utc);
  return Number.isFinite(t1) && Number.isFinite(t2) ? Math.round((t2 - t1) / 60000) : null;
}

export const isDelayed = f => f.status === "delayed" || (f.delayMinutes !== null && f.delayMinutes >= DELAY_THRESHOLD_MIN && !["cancelled", "maybe-cancelled", "diverted"].includes(f.status));
export const isCancelled = f => f.status === "cancelled" || f.status === "maybe-cancelled";
// Finished at this airport: a departure has left, an arrival has landed.
export const isDone = f => (f.direction === "departure" ? ["departed", "en-route", "approaching", "arrived"] : ["arrived"]).includes(f.status);

// Overdue: its expected (or scheduled) time at this airport passed more than
// OVERDUE_MIN ago, yet the provider has not reported it departed/landed or
// cancelled. Many airports have no live feed, so the status never changes;
// we then say "No recent update" rather than keep showing "Expected".
export const OVERDUE_MIN = 15;
const FINAL = ["cancelled", "maybe-cancelled", "diverted"];
export function isOverdue(f, now = Date.now()) {
  if (isDone(f) || FINAL.includes(f.status)) return false;
  const m = f.direction === "departure" ? f.departure : f.arrival;
  const t = Date.parse((m.revised || m.scheduled)?.utc);
  return Number.isFinite(t) && now - t > OVERDUE_MIN * 60000;
}

export function boardStats(flights) {
  const dep = flights.filter(f => f.direction === "departure");
  const arr = flights.filter(f => f.direction === "arrival");
  const onTime = list => list.filter(f => !isDelayed(f) && !isCancelled(f) && f.status !== "diverted").length;
  return {
    departures: dep.length, departuresOnTime: onTime(dep),
    arrivals: arr.length, arrivalsOnTime: onTime(arr),
    delays: flights.filter(isDelayed).length,
    cancellations: flights.filter(isCancelled).length,
  };
}
