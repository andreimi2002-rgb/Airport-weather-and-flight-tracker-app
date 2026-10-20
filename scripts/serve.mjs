// Local preview server: npm run serve, then open http://localhost:8080
// Serves public/ and, like netlify.toml, answers /airport/* with index.html.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../public", import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // The /api/ routes run the same code as the Netlify Functions (no CDN
  // cache here; flight data keeps its budget in memory).
  const routes = [
    [/^\/api\/(weather|flights)\/([^/]+)$/, m => [m[1], { code: m[2] }]],
    [/^\/api\/aircraft\/([^/]+)$/, m => ["flight-details", { reg: m[1] }]],
    [/^\/api\/aircraft-photo\/([^/]+)$/, m => ["aircraft-live", { reg: m[1] }]],
    [/^\/api\/aircraft-now\/([^/]+)$/, m => ["aircraft-live", { reg: m[1] }]],
    [/^\/api\/airport-live\/([^/]+)$/, m => ["aircraft-live", { code: m[1] }]],
    [/^\/api\/airline-routes\/([^/]+)$/, m => ["aircraft-live", { icao: m[1] }]],
    [/^\/api\/stats\/([^/]+)\/([^/]+)$/, m => ["stats", { code: m[1], date: m[2] }]],
    [/^\/api\/airline-logo\/([^/]+)$/, m => ["airline-logo", { iata: m[1] }]],
    [/^\/api\/flight-status\/([^/]+)\/([^/]+)$/, m => ["flight-details", { number: m[1], date: m[2] }]],
    [/^\/api\/aircraft-flights\/([^/]+)\/([^/]+)$/, m => ["flight-details", { reg: m[1], date: m[2] }]],
    [/^\/api\/live\/([^/]+)$/, m => ["aircraft-live", { callsign: m[1] }]],
    [/^\/api\/identify\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/, m => ["aircraft-live", { airline: m[1], number: m[2], from: m[3], to: m[4], lat: m[5], lon: m[6] }]],
    [/^\/api\/flight-status\/([^/]+)\/([^/]+)\/([^/]+)$/, m => ["flight-details", { number: m[1], date: m[2], code: m[3] }]],
  ];
  const hit = routes.map(([re, to]) => { const m = re.exec(path); return m && to(m); }).find(Boolean);
  if (hit) {
    const { default: fn } = await import(`../netlify/functions/${hit[0]}.mjs`);
    const r = await fn(new Request("http://localhost" + req.url), { params: hit[1] });
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (path === "/" || path.startsWith("/airport/")) path = "/index.html";
  if (path.startsWith("/aircraft/")) path = "/aircraft.html";
  if (path.startsWith("/board/")) path = "/board.html";
  for (const p of ["route", "airline", "flight"]) if (path.startsWith(`/${p}/`)) path = `/${p}.html`;
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(PORT, () => console.log(`Airport Live: http://localhost:${PORT}`));
