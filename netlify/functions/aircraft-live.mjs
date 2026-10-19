// The actual aircraft, from free sources (no AeroDataBox units):
//   GET /api/aircraft-photo/YR-ASA -> real photo of that aircraft (Planespotters.net, stored 7 days)
//   GET /api/live/WZZ3185          -> the aircraft flying this callsign now (adsb.lol, stored 5 min)
//   GET /api/aircraft-now/YR-ASA   -> where this aircraft is now and its route (adsb.lol + VRS, stored 2 min)
//   GET /api/airport-live/OTP      -> aircraft flying to or from this airport now (adsb.lol + VRS, stored 4 min)
//   GET /api/airline-routes/KLM    -> the airline's known callsign routes (VRS standing data, stored 1 day)
import { getStore } from "@netlify/blobs";
import { memoryStore } from "../lib/flights/budget.mjs";
import { isRegistration } from "../lib/flights/details.mjs";
import { getAircraftPhoto, getLiveAircraft, getAircraftNow, getAirportLive, identifyFlight, isCallsign, airlineRoutes, VRS, DEFAULT_ADSB_DAILY_CAP } from "../lib/flights/live.mjs";
import { findAirport, isAirportCode, iataForIcao } from "../lib/airports.mjs";

const env = name => (globalThis.Netlify?.env?.get(name) ?? process.env[name]) || null;

let fallback = null;
function liveStore() {
  try { return getStore({ name: "aircraft-live", consistency: "strong" }); }
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

export default async (req, context) => {
  const p = context?.params || {};
  let result;
  try {
    if (p.icao !== undefined) {
      // An airline's known callsign routes (VRS standing data, CC0), airports as our IATA codes when known.
      const icao = String(p.icao).toUpperCase();
      if (!/^[A-Z]{3}$/.test(icao)) return json({ error: "Use the airline's 3-letter ICAO code, e.g. /api/airline-routes/KLM." }, 400, 86400);
      let routes;
      try { routes = await airlineRoutes(icao, liveStore(), Date.now()); }
      catch (err) { return json({ status: "error", notice: err.message, routes: [] }, 200, 60); }
      const list = Object.entries(routes || {}).map(([cs, r]) => { const [a, b] = r.split("-"); return [cs, iataForIcao(a) || a, iataForIcao(b) || b]; });
      return json({ status: "ok", icao, routes: list, source: VRS }, 200, 3600);
    }
    if (p.code !== undefined) {
      const code = String(p.code).toUpperCase();
      const a = isAirportCode(code) ? findAirport(code) : null;
      if (!a) return json({ error: "Use a known 3-letter airport code, e.g. /api/airport-live/OTP." }, 400, 86400);
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return json({ error: `No position known for ${code}.` }, 404, 86400);
      const airportByIcao = icao => { const x = findAirport(iataForIcao(icao)); return x && { iata: x.iata, lat: x.lat, lon: x.lon }; };
      result = await getAirportLive({ iata: a.iata, lat: a.lat, lon: a.lon }, { store: liveStore(), airportByIcao, dailyCap: Number(env("ADSB_DAILY_CAP")) || DEFAULT_ADSB_DAILY_CAP });
    } else if (p.airline !== undefined) {
      const airline = String(p.airline).toUpperCase(), from = String(p.from).toUpperCase(), to = String(p.to).toUpperCase();
      const number = /^\d{1,4}[A-Z]?$/.test(String(p.number).toUpperCase()) ? String(p.number).toUpperCase() : null; // "-" when unknown
      const lat = Number(p.lat), lon = Number(p.lon);
      if (!/^([A-Z]{3}|[A-Z0-9]{2})$/.test(airline)) return json({ error: "Use the airline's ICAO (3 letters) or IATA (2 characters) code." }, 400, 86400);
      if (!isAirportCode(from) || !isAirportCode(to) || !findAirport(from) || !findAirport(to)) return json({ error: "Use two known 3-letter airport codes." }, 400, 86400);
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return json({ error: "Use a valid position." }, 400, 86400);
      const A = findAirport(from), B = findAirport(to);
      const fromPos = Number.isFinite(A.lat) ? { lat: A.lat, lon: A.lon } : null, toPos = Number.isFinite(B.lat) ? { lat: B.lat, lon: B.lon } : null;
      result = await identifyFlight({ airline, number, from, to, lat, lon, fromPos, toPos }, { store: liveStore(), iataForIcao, dailyCap: Number(env("ADSB_DAILY_CAP")) || DEFAULT_ADSB_DAILY_CAP });
    } else if (p.reg !== undefined) {
      const reg = String(p.reg).toUpperCase();
      if (!isRegistration(reg)) return json({ error: "Use an aircraft registration, e.g. /api/aircraft-photo/YR-ASA." }, 400, 86400);
      if (new URL(req.url).pathname.startsWith("/api/aircraft-now/")) {
        const airportByIcao = icao => { const a = findAirport(iataForIcao(icao)); return a && { iata: a.iata, lat: a.lat, lon: a.lon }; };
        result = await getAircraftNow(reg, { store: liveStore(), airportByIcao, dailyCap: Number(env("ADSB_DAILY_CAP")) || DEFAULT_ADSB_DAILY_CAP });
      } else result = await getAircraftPhoto(reg, { store: liveStore() });
    } else {
      const cs = String(p.callsign || "").toUpperCase();
      if (!isCallsign(cs)) return json({ error: "Use an ICAO callsign, e.g. /api/live/WZZ3185." }, 400, 86400);
      result = await getLiveAircraft(cs, { store: liveStore(), dailyCap: Number(env("ADSB_DAILY_CAP")) || DEFAULT_ADSB_DAILY_CAP });
    }
  } catch (err) {
    console.error("Aircraft live lookup failed", err);
    return json({ error: "Aircraft data is unavailable right now." }, 500, 60);
  }
  return json(result.body, 200, result.cacheSeconds);
};

export const config = {
  path: ["/api/aircraft-photo/:reg", "/api/aircraft-now/:reg", "/api/airport-live/:code", "/api/airline-routes/:icao", "/api/live/:callsign", "/api/identify/:airline/:number/:from/:to/:lat/:lon"],
  method: "GET",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
