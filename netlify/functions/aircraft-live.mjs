// The actual aircraft, from free sources (no AeroDataBox units):
//   GET /api/aircraft-photo/YR-ASA -> real photo of that aircraft (Planespotters.net, stored 7 days)
//   GET /api/live/WZZ3185          -> the aircraft flying this callsign now (adsb.lol, stored 5 min)
import { getStore } from "@netlify/blobs";
import { memoryStore } from "../lib/flights/budget.mjs";
import { isRegistration } from "../lib/flights/details.mjs";
import { getAircraftPhoto, getLiveAircraft, identifyFlight, isCallsign, DEFAULT_ADSB_DAILY_CAP } from "../lib/flights/live.mjs";
import { findAirport, isAirportCode } from "../lib/airports.mjs";

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
    if (p.airline !== undefined) {
      const airline = String(p.airline).toUpperCase(), from = String(p.from).toUpperCase(), to = String(p.to).toUpperCase();
      const number = /^\d{1,4}[A-Z]?$/.test(String(p.number).toUpperCase()) ? String(p.number).toUpperCase() : null; // "-" when unknown
      const lat = Number(p.lat), lon = Number(p.lon);
      if (!/^[A-Z]{3}$/.test(airline)) return json({ error: "Use the airline's 3-letter ICAO code." }, 400, 86400);
      if (!isAirportCode(from) || !isAirportCode(to) || !findAirport(from) || !findAirport(to)) return json({ error: "Use two known 3-letter airport codes." }, 400, 86400);
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return json({ error: "Use a valid position." }, 400, 86400);
      result = await identifyFlight({ airline, number, from, to, lat, lon }, { store: liveStore(), dailyCap: Number(env("ADSB_DAILY_CAP")) || DEFAULT_ADSB_DAILY_CAP });
    } else if (p.reg !== undefined) {
      const reg = String(p.reg).toUpperCase();
      if (!isRegistration(reg)) return json({ error: "Use an aircraft registration, e.g. /api/aircraft-photo/YR-ASA." }, 400, 86400);
      result = await getAircraftPhoto(reg, { store: liveStore() });
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
  path: ["/api/aircraft-photo/:reg", "/api/live/:callsign", "/api/identify/:airline/:number/:from/:to/:lat/:lon"],
  method: "GET",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
