// GET /api/weather/OTP -> METAR, TAF and forecast for one airport.
// The airport is looked up here (not sent by the browser), so only real
// airports can be queried and the CDN caches one answer per airport.
import { findAirport, isAirportCode } from "../lib/airports.mjs";
import { getWeather } from "../lib/weather.mjs";

export { findAirport };

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=60",
    "Netlify-CDN-Cache-Control": cache,
  },
});

export default async (req, context) => {
  const code = String(context?.params?.code || "").toUpperCase();
  if (!isAirportCode(code)) return json({ error: "Use a 3-letter airport code, e.g. /api/weather/OTP." }, 400, "public, durable, s-maxage=86400");
  const airport = findAirport(code);
  if (!airport) return json({ error: `No airport with the code ${code}.` }, 404, "public, durable, s-maxage=86400");

  const w = await getWeather(airport);
  const parts = [w.metar, w.taf, w.forecast];
  const allFailed = parts.every(p => p.status === "error");
  const anyFailed = parts.some(p => p.status === "error");
  // Complete answers: fresh for 5 minutes, then served stale for up to 10 more
  // while refreshing. A failed part is retried after a minute, not pinned.
  return json(w, allFailed ? 502 : 200, anyFailed ? "public, s-maxage=60" : "public, durable, s-maxage=300, stale-while-revalidate=600");
};

export const config = {
  path: "/api/weather/:code",
  method: "GET",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
