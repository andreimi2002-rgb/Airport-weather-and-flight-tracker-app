// GET /api/airline-logo/MU -> that airline's logo from the Aviasales logo CDN
// (pics.avs.io), passed through our site so visitors' browsers never contact
// the CDN. Used only where Wikimedia Commons has no free logo (logos.js).
// Owner's choice for the prototype (2026-10-20): these logos have no published
// licence for other sites; review before a public launch.
const UA = "AirportLive/0.1 (+https://github.com/andreimi2002-rgb/Airport-weather-and-flight-tracker-app)";
const DAY = 86400;

export default async (req, context) => {
  const code = String(context?.params?.iata || "").toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(code)) return new Response("Use a 2-character IATA airline code.", { status: 400, headers: { "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${DAY}` } });
  let res;
  try { res = await fetch(`https://pics.avs.io/240/80/${code}.png`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }); }
  catch { return new Response("Logo service unreachable", { status: 502, headers: { "Netlify-CDN-Cache-Control": "public, s-maxage=300" } }); }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) return new Response("No logo", { status: 404, headers: { "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${DAY}` } });
  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: { "Content-Type": type, "Cache-Control": `public, max-age=${7 * DAY}`, "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${30 * DAY}` },
  });
};

export const config = { path: "/api/airline-logo/:iata", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
