// GET /api/stats/OTP/2026-10-20 -> that day's totals for the airport, from the
// boards already fetched (no provider calls): flights, cancelled, on-time share,
// average delay, plus which days are stored (up to 90).
import { getStore } from "@netlify/blobs";
import { findAirport, isAirportCode } from "../lib/airports.mjs";
import { memoryStore } from "../lib/flights/budget.mjs";
import { readDay } from "../lib/flights/stats.mjs";

let fallback = null;
function flightStore() {
  try { return getStore({ name: "flights", consistency: "strong" }); }
  catch { return (fallback ??= memoryStore()); }
}

const json = (body, status, cdnSeconds) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60", "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${cdnSeconds}` },
});

export default async (req, context) => {
  const code = String(context?.params?.code || "").toUpperCase(), day = String(context?.params?.date || "");
  if (!isAirportCode(code) || !findAirport(code)) return json({ error: "Use a known 3-letter airport code, e.g. /api/stats/OTP/2026-10-20." }, 400, 86400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "Use a date like 2026-10-20." }, 400, 86400);
  try { return json({ airport: code, ...(await readDay(flightStore(), code, day)) }, 200, 300); }
  catch (err) { console.error("Stats failed", err); return json({ error: "Statistics are unavailable right now." }, 500, 60); }
};

export const config = { path: "/api/stats/:code/:date", method: "GET", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
