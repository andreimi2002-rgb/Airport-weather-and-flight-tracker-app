// On-demand flight details (AeroDataBox via RapidAPI), called only when a
// flight is opened or "Check this flight" is pressed:
//   GET /api/aircraft/YR-ASA                -> that aircraft (stored 7 days)
//   GET /api/flight-status/RO391/2026-10-19/OTP -> current status of one flight (stored 5 min)
//   GET /api/aircraft-flights/YR-ASA/2026-10-19 -> that aircraft's flights on a day (2 units, on request)
import { getStore } from "@netlify/blobs";
import { findAirport, isAirportCode } from "../lib/airports.mjs";
import { memoryStore, DEFAULT_MONTHLY_UNIT_CAP } from "../lib/flights/budget.mjs";
import { getAircraft, getFlightStatus, getAircraftFlights, isRegistration, isFlightNumber, isLocalDate } from "../lib/flights/details.mjs";

const env = name => (globalThis.Netlify?.env?.get(name) ?? process.env[name]) || null;

let fallback = null;
function flightStore() {
  try { return getStore({ name: "flights", consistency: "strong" }); }
  catch { return (fallback ??= memoryStore()); }
}

const json = (body, status, cdnSeconds) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=60",
    "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${cdnSeconds}`,
  },
});
const bad = msg => json({ error: msg }, 400, 86400);

export default async (req, context) => {
  const p = context?.params || {};
  const opts = { key: env("AERODATABOX_RAPIDAPI_KEY"), store: flightStore(), cap: Number(env("FLIGHTS_MONTHLY_UNIT_CAP")) || DEFAULT_MONTHLY_UNIT_CAP };
  let result;
  try {
    if (p.reg !== undefined) {
      const reg = String(p.reg).toUpperCase();
      if (!isRegistration(reg)) return bad("Use an aircraft registration, e.g. /api/aircraft/YR-ASA.");
      if (p.date !== undefined) {
        const date = String(p.date);
        const today = Date.parse(new Date().toISOString().slice(0, 10));
        // Today and the 7 days before it (local dates can be a day ahead of UTC).
        if (!isLocalDate(date) || Date.parse(date) > today + 86400000 || Date.parse(date) < today - 7 * 86400000) return bad("Use a date from the last 7 days, e.g. 2026-10-19.");
        result = await getAircraftFlights(reg, date, opts);
      } else result = await getAircraft(reg, opts);
    } else {
      const number = String(p.number || "").toUpperCase().replace(/\s+/g, "");
      const date = String(p.date || "");
      const code = String(p.code || "").toUpperCase();
      if (!isFlightNumber(number)) return bad("Use a flight number, e.g. RO391.");
      if (!isLocalDate(date)) return bad("Use a date like 2026-10-19.");
      // Without an airport (the flight page): every leg of the flight.
      if (!code) result = await getFlightStatus(number, date, null, opts);
      else {
        if (!isAirportCode(code)) return bad("Use a 3-letter airport code.");
        const airport = findAirport(code);
        if (!airport) return json({ error: `No airport with the code ${code}.` }, 404, 86400);
        result = await getFlightStatus(number, date, airport, opts);
      }
    }
  } catch (err) {
    console.error("Flight details failed", err);
    return json({ error: "Flight data is unavailable right now." }, 500, 60);
  }
  return json(result.body, 200, result.cacheSeconds);
};

export const config = {
  path: ["/api/aircraft/:reg", "/api/aircraft-flights/:reg/:date", "/api/flight-status/:number/:date/:code", "/api/flight-status/:number/:date"],
  method: "GET",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
