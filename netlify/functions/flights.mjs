// GET /api/flights/OTP -> departures and arrivals for one airport
// (AeroDataBox via RapidAPI). The key lives only in the Netlify environment
// variable AERODATABOX_RAPIDAPI_KEY. See netlify/lib/flights/board.mjs for
// how the free monthly quota is protected.
import { getStore } from "@netlify/blobs";
import { findAirport, isAirportCode } from "../lib/airports.mjs";
import { getBoard } from "../lib/flights/board.mjs";
import { memoryStore, DEFAULT_MONTHLY_UNIT_CAP } from "../lib/flights/budget.mjs";

const env = name => (globalThis.Netlify?.env?.get(name) ?? process.env[name]) || null;

// Netlify Blobs on Netlify and under `netlify dev`; a per-process store elsewhere (npm run serve, tests).
let fallback = null;
function boardStore() {
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

export default async (req, context) => {
  const code = String(context?.params?.code || "").toUpperCase();
  if (!isAirportCode(code)) return json({ error: "Use a 3-letter airport code, e.g. /api/flights/OTP." }, 400, 86400);
  const airport = findAirport(code);
  if (!airport) return json({ error: `No airport with the code ${code}.` }, 404, 86400);

  const cap = Number(env("FLIGHTS_MONTHLY_UNIT_CAP")) || DEFAULT_MONTHLY_UNIT_CAP;
  let result;
  try {
    result = await getBoard(airport, { key: env("AERODATABOX_RAPIDAPI_KEY"), store: boardStore(), cap });
  } catch (err) {
    console.error("Flight board failed", err);
    return json({ error: "Flight data is unavailable right now." }, 500, 60);
  }
  return json(result.body, 200, result.cacheSeconds);
};

export const config = {
  path: "/api/flights/:code",
  method: "GET",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
