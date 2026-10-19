// AeroDataBox adapter (via RapidAPI). One call returns departures and
// arrivals for a time window ("FIDS", Tier 2 = 2 units on the Basic plan).
// Docs: https://doc.aerodatabox.com/ (openapi-rapidapi-v1.json)
// Builds flights in the shape described in public/js/flight-model.js.

function minutesBetween(a, b) {
  const t1 = Date.parse(a?.utc), t2 = Date.parse(b?.utc);
  return Number.isFinite(t1) && Number.isFinite(t2) ? Math.round((t2 - t1) / 60000) : null;
}

export const PROVIDER = { name: "AeroDataBox", url: "https://aerodatabox.com/", attribution: "Flight data: AeroDataBox" };
const HOST = "aerodatabox.p.rapidapi.com";
const TIMEOUT_MS = 10000;
// Basic plan allows at most 12 hours per call: 2 hours back, 10 ahead.
export const WINDOW = { offsetMinutes: -120, durationMinutes: 720 };

const STATUS = {
  Unknown: "scheduled", Expected: "expected", CheckIn: "check-in", Boarding: "boarding", GateClosed: "gate-closed",
  Departed: "departed", EnRoute: "en-route", Approaching: "approaching", Arrived: "arrived", Delayed: "delayed",
  Canceled: "cancelled", CanceledUncertain: "maybe-cancelled", Diverted: "diverted",
};

const str = v => (typeof v === "string" && v.trim() ? v.trim() : null);

// "2026-10-19 15:30+03:00" -> "2026-10-19T15:30+03:00"; keeps null for missing times.
function time(t) {
  if (!t || !t.utc) return null;
  const fix = s => String(s).trim().replace(" ", "T");
  return { utc: fix(t.utc), local: fix(t.local || t.utc) };
}

function airportRef(a) {
  return { iata: str(a?.iata), icao: str(a?.icao), name: str(a?.shortName) || str(a?.name), city: str(a?.municipalityName), country: str(a?.countryCode) };
}

function movement(m) {
  return {
    airport: airportRef(m?.airport),
    scheduled: time(m?.scheduledTime),
    revised: time(m?.revisedTime),
    runway: time(m?.runwayTime),
    terminal: str(m?.terminal),
    gate: str(m?.gate),
    checkInDesk: str(m?.checkInDesk),
    baggageBelt: str(m?.baggageBelt),
    live: Array.isArray(m?.quality) && m.quality.includes("Live"),
  };
}

// AeroDataBox licence names -> the short names people know.
const LICENCE_NAMES = {
  AttributionCC: "CC BY", AttributionShareAlikeCC: "CC BY-SA", AttributionNoDerivativesCC: "CC BY-ND",
  AttributionNoncommercialCC: "CC BY-NC", AttributionNoncommercialShareAlikeCC: "CC BY-NC-SA", AttributionNoncommercialNoDerivativesCC: "CC BY-NC-ND",
  PublicDomainDedicationCC0: "CC0", PublicDomainMark: "Public domain", NoKnownCopyrightRestrictions: "No known copyright restrictions",
  UnitedStatesGovernmentWork: "US government work", AllRightsReserved: "All rights reserved",
};
export const licenceName = l => (str(l) ? LICENCE_NAMES[l] || str(l) : null);

function photoOf(img) {
  if (!img || !str(img.url)) return null;
  return {
    url: img.url,
    pageUrl: str(img.webUrl),
    author: str(img.author),
    licence: licenceName(img.license),
    attribution: Array.isArray(img.htmlAttributions) ? img.htmlAttributions.filter(s => typeof s === "string") : [],
    kind: "representative",
  };
}

// The provider may leave out the airport we asked about (it is the same for
// every flight); fill it from our own airport list. hereAirport: AirportRef.
export function normalizeFlight(raw, direction, hereAirport = null) {
  const departure = movement(raw.departure), arrival = movement(raw.arrival);
  const own = direction === "departure" ? departure : arrival;
  if (hereAirport && !own.airport.iata && !own.airport.icao && !own.airport.name) own.airport = { ...hereAirport };
  const here = direction === "departure" ? departure : arrival;
  const number = str(raw.number) || "—";
  return {
    id: [direction, number, here.scheduled?.utc || ""].join("|"),
    direction,
    number,
    callSign: str(raw.callSign),
    airline: { name: str(raw.airline?.name), iata: str(raw.airline?.iata), icao: str(raw.airline?.icao) },
    status: STATUS[raw.status] || "scheduled",
    providerStatus: str(raw.status),
    departure, arrival,
    delayMinutes: here.scheduled && here.revised ? minutesBetween(here.scheduled, here.revised) : null,
    distanceKm: typeof raw.greatCircleDistance?.km === "number" ? Math.round(raw.greatCircleDistance.km) : null,
    scheduledDurationMinutes: departure.scheduled && arrival.scheduled ? minutesBetween(departure.scheduled, arrival.scheduled) : null,
    isCargo: raw.isCargo === true,
    aircraft: { registration: str(raw.aircraft?.reg), model: str(raw.aircraft?.model), manufacturer: manufacturerOf(raw.aircraft?.model), modeS: str(raw.aircraft?.modeS), photo: photoOf(raw.aircraft?.image) },
    updatedAt: str(raw.lastUpdatedUtc),
  };
}

const byScheduled = dir => (a, b) => String(a[dir].scheduled?.utc || "").localeCompare(String(b[dir].scheduled?.utc || ""));

export function normalizeBoard(json, hereAirport = null) {
  const departures = (Array.isArray(json?.departures) ? json.departures : []).map(f => normalizeFlight(f, "departure", hereAirport)).sort(byScheduled("departure"));
  const arrivals = (Array.isArray(json?.arrivals) ? json.arrivals : []).map(f => normalizeFlight(f, "arrival", hereAirport)).sort(byScheduled("arrival"));
  const all = [...departures.map(f => f.departure), ...arrivals.map(f => f.arrival)];
  return { departures, arrivals, live: all.some(m => m.live) };
}

export class ProviderError extends Error {
  constructor(message, { status = null, quota = false } = {}) { super(message); this.status = status; this.quota = quota; }
}

// One provider request. Returns { status: 200|204, json, usage } or throws ProviderError.
async function request(path, key, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`https://${HOST}${path}`, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": HOST, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(err.name === "TimeoutError" ? "The flight data service did not answer in time." : "Couldn't reach the flight data service.");
  }
  const usage = rateHeaders(res.headers);
  if (res.status === 204) return { status: 204, json: null, usage };
  if (res.status === 429) {
    // RapidAPI answers 429 both for the monthly quota and for the per-second
    // limit ("Too many requests"). Only the first stops calls for the month.
    const text = await res.text().catch(() => "");
    if (/quota|monthly/i.test(text)) throw new ProviderError("The flight data service's monthly quota is used up.", { status: 429, quota: true });
    throw new ProviderError("The flight data service is busy (too many requests). Try again in a minute.", { status: 429 });
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError("The flight data service refused the key (check the subscription).", { status: res.status });
  if (!res.ok) throw new ProviderError(`The flight data service answered HTTP ${res.status}.`, { status: res.status });
  let json;
  try { json = await res.json(); } catch { throw new ProviderError("The flight data service sent an unreadable answer."); }
  return { status: 200, json, usage };
}

// airport: { iata, icao, name, city, country? } from our list.
// Returns { board, usage } or throws ProviderError.
export async function fetchBoard(airport, key, { fetchImpl = fetch } = {}) {
  const iata = airport.iata;
  const hereAirport = { iata, icao: airport.icao || null, name: airport.name || null, city: airport.city || null, country: airport.country || null };
  const q = new URLSearchParams({
    offsetMinutes: WINDOW.offsetMinutes, durationMinutes: WINDOW.durationMinutes, direction: "Both",
    withLeg: "true", withCancelled: "true", withCodeshared: "false", withCargo: "false", withPrivate: "false", withLocation: "false",
  });
  const { json, usage } = await request(`/flights/airports/iata/${iata}?${q}`, key, fetchImpl);
  if (!json) return { board: { departures: [], arrivals: [], live: false }, usage };
  return { board: normalizeBoard(json, hereAirport), usage };
}

// ---------- aircraft (Tier 1, 1 unit) ----------
// AeroDataBox has no manufacturer field. It is taken from the start of the
// provider's type name only when that is a known manufacturer; otherwise null.
const MANUFACTURERS = ["Airbus", "Boeing", "Embraer", "ATR", "Bombardier", "De Havilland Canada", "De Havilland", "McDonnell Douglas", "Fokker", "Saab", "Sukhoi", "COMAC", "Mitsubishi", "Antonov", "Tupolev", "Ilyushin", "Cessna", "Beechcraft", "Pilatus", "Gulfstream", "Dassault", "Learjet", "Lockheed", "Douglas", "BAe", "British Aerospace", "Dornier", "Let", "Tecnam", "Piper"];
export function manufacturerOf(...names) {
  for (const n of names) {
    const s = str(n);
    if (!s) continue;
    const m = MANUFACTURERS.find(x => s === x || s.startsWith(x + " ") || s.startsWith(x + "-"));
    if (m) return m;
  }
  return null;
}

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const day = v => (str(v) ? str(v).slice(0, 10) : null);

export function normalizeAircraft(a) {
  const photo = a.image && str(a.image.url) ? { ...photoOf(a.image), kind: "this-aircraft" } : null;
  return {
    registration: str(a.reg),
    active: a.active === true,
    model: str(a.typeName) || str(a.model),
    modelCode: str(a.icaoCode) || str(a.modelCode),
    manufacturer: manufacturerOf(a.typeName, a.productionLine, a.model),
    productionLine: str(a.productionLine),
    airline: str(a.airlineName),
    seats: num(a.numSeats),
    engines: num(a.numEngines),
    engineType: str(a.engineType),
    ageYears: num(a.ageYears),
    deliveryDate: day(a.deliveryDate),
    firstFlightDate: day(a.firstFlightDate),
    serial: str(a.serial),
    isFreighter: a.isFreighter === true,
    photo,
  };
}

// Returns { aircraft|null, usage }. reg: tail number, e.g. "YR-ASA".
export async function fetchAircraft(reg, key, { fetchImpl = fetch } = {}) {
  const { json, usage } = await request(`/aircrafts/reg/${encodeURIComponent(reg)}?withImage=true&withRegistrations=false`, key, fetchImpl);
  return { aircraft: json ? normalizeAircraft(json) : null, usage };
}

// ---------- flight status (Tier 2, 2 units) ----------
// Returns { flights: [raw FlightContract], usage } for a flight number on a local date.
export async function fetchFlightStatus(number, dateLocal, key, { fetchImpl = fetch } = {}) {
  const n = String(number).replace(/s+/g, "");
  const { json, usage } = await request(`/flights/number/${encodeURIComponent(n)}/${dateLocal}?withAircraftImage=false&withLocation=false`, key, fetchImpl);
  return { flights: Array.isArray(json) ? json : [], usage };
}

// Flights of one aircraft (by registration) departing or arriving on a local date (Tier 2, 2 units).
export async function fetchAircraftFlights(reg, dateLocal, key, { fetchImpl = fetch } = {}) {
  const { json, usage } = await request(`/flights/reg/${encodeURIComponent(reg)}/${dateLocal}?dateLocalRole=Both&withAircraftImage=false&withLocation=false`, key, fetchImpl);
  return { flights: Array.isArray(json) ? json : [], usage };
}

// RapidAPI reports the remaining quota in x-ratelimit-* headers (names vary by plan).
function rateHeaders(headers) {
  const out = {};
  for (const [k, v] of headers) if (/^x-ratelimit-/i.test(k)) out[k.toLowerCase()] = v;
  return out;
}
