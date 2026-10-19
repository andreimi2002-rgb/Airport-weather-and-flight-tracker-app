// Local preview server: npm run serve, then open http://localhost:8080
// Serves public/ and, like netlify.toml, answers /airport/* with index.html.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../public", import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // /api/weather/OTP runs the same code as the Netlify Function (no CDN cache here).
  const api = /^\/api\/weather\/([^/]+)$/.exec(path);
  if (api) {
    const { default: weather } = await import("../netlify/functions/weather.mjs");
    const r = await weather(new Request("http://localhost" + req.url), { params: { code: api[1] } });
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (path === "/" || path.startsWith("/airport/")) path = "/index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(PORT, () => console.log(`Airport Live: http://localhost:${PORT}`));
