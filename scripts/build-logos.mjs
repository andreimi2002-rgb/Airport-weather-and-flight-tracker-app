// Builds public/data/airline-logos.json and public/data/logos/*.png: airline
// logos from Wikidata (P154) + Wikimedia Commons, free licences only (same
// rule as the photos), stored on our site, plus public/logo-credits.html.
//   npm run build:logos
// Run by hand to refresh, then commit.
import { readdir, writeFile, mkdir, unlink } from "node:fs/promises";
import { csvToObjects } from "./lib/airport-data.mjs";
import { groupAirlines, toLogo, thumbWidth, logoFileName } from "./lib/logo-data.mjs";

const UA = "AirportLive/0.1 (https://github.com/andreimi2002-rgb/Airport-weather-and-flight-tracker-app; logo build)";
const SPARQL = "https://query.wikidata.org/sparql";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const DIR = new URL("../public/data/logos/", import.meta.url);
const MANIFEST = new URL("../public/data/airline-logos.json", import.meta.url);
const CREDITS = new URL("../public/logo-credits.html", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function fetchRetry(url, { init = {}, tries = 4, timeoutMs = 60000, read = res => res } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, ...(init.headers || {}) } });
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(3000 * i); continue; }
      return await read(res);
    } catch (err) {
      if (i >= tries) throw err;
      await sleep(3000 * i);
    }
  }
}

console.log("Querying Wikidata…");
// Every logo statement with its rank; ended: the statement has an end time (an old logo).
const csv = await fetchRetry(SPARQL + "?query=" + encodeURIComponent(
  'SELECT ?a ?aLabel ?iata ?icao ?logo ?rank ?ended ?closed WHERE { ?a wdt:P229 ?iata . OPTIONAL { ?a wdt:P230 ?icao } OPTIONAL { ?a p:P154 ?st . ?st ps:P154 ?logo ; wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank) BIND(EXISTS { ?st pq:P582 [] } AS ?ended) } BIND(EXISTS { ?a wdt:P576 [] } AS ?closed) SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }'),
  { init: { headers: { Accept: "text/csv" } }, timeoutMs: 180000, read: res => { if (!res.ok) throw new Error("Wikidata HTTP " + res.status); return res.text(); } });
const airlines = groupAirlines(csvToObjects(csv));
const files = [...new Set(airlines.flatMap(a => a.logos))];
console.log(`${airlines.length} open airlines with a logo; ${files.length} logo files.`);

// Commons metadata, 50 files per request (size first, to choose the thumbnail width).
const info = new Map();
for (let i = 0; i < files.length; i += 50) {
  const batch = files.slice(i, i + 50);
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", maxlag: "5",
    prop: "imageinfo", iiprop: "url|mime|size|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl", titles: batch.map(f => "File:" + f).join("|"),
  });
  const j = await fetchRetry(COMMONS + "?" + params, { read: async res => { const b = await res.json(); if (b.error) throw new Error("Commons: " + b.error.code); return b; } });
  const back = new Map((j.query?.normalized ?? []).map(n => [n.to, n.from]));
  for (const p of j.query?.pages ?? []) info.set((back.get(p.title) ?? p.title).replace(/^File:/, ""), p.imageinfo?.[0] ? { ...p.imageinfo[0], title: p.title } : null);
}

// Thumbnail URL at a standard width (one more request per 50 files and width).
async function thumbUrls(list, width) {
  const out = new Map();
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", maxlag: "5", prop: "imageinfo", iiprop: "url", iiurlwidth: String(width), titles: batch.map(f => "File:" + f).join("|") });
    const j = await fetchRetry(COMMONS + "?" + params, { read: res => res.json() });
    const back = new Map((j.query?.normalized ?? []).map(n => [n.to, n.from]));
    for (const p of j.query?.pages ?? []) {
      const u = p.imageinfo?.[0]?.thumburl;
      if (u) out.set((back.get(p.title) ?? p.title).replace(/^File:/, ""), u.replace(/\?.*$/, ""));
    }
  }
  return out;
}

const ok = new Map(), rejected = {};
for (const f of files) {
  const r = toLogo(info.get(f));
  if (r.logo) ok.set(f, r.logo); else { const k = r.reject.split(" ").slice(0, 2).join(" "); rejected[k] = (rejected[k] || 0) + 1; }
}
console.log(`${ok.size} logos pass the licence/type rules. Rejected:`, rejected);

// First usable logo per airline.
const chosen = airlines.map(a => ({ ...a, file: a.logos.find(f => ok.has(f)) })).filter(a => a.file);
const byWidth = {};
for (const a of chosen) { const l = ok.get(a.file); (byWidth[thumbWidth(l.width, l.height)] ??= new Set()).add(a.file); }
const thumbs = new Map();
for (const [w, set] of Object.entries(byWidth)) for (const [f, u] of await thumbUrls([...set], Number(w))) thumbs.set(f, u);

// Download each thumbnail once (two at a time) and keep only real images.
await mkdir(DIR, { recursive: true });
const saved = new Map(); // file -> { name, bytes }
const queue = [...new Set(chosen.map(a => a.file))];
let done = 0, failed = 0;
async function worker() {
  while (queue.length) {
    const f = queue.pop();
    const url = thumbs.get(f);
    if (!url) { failed++; continue; }
    try {
      const res = await fetchRetry(url, { timeoutMs: 30000 });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !/^image\/(png|jpeg|webp)/.test(type)) { failed++; continue; }
      saved.set(f, { buf: Buffer.from(await res.arrayBuffer()), ext: type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg" });
    } catch { failed++; }
    if (++done % 100 === 0) console.log(`  downloaded ${done}/${chosen.length}`);
    await sleep(150);
  }
}
await Promise.all([worker(), worker()]);
console.log(`Downloaded ${saved.size} logo images (${failed} failed).`);

const logos = {}, keep = new Set(), credits = [], written = new Map();
for (const a of chosen) {
  const img = saved.get(a.file);
  if (!img) continue;
  // One stored image per logo file, even when several airlines use it.
  let name = written.get(a.file);
  if (!name) {
    name = logoFileName(a.iata, a.qid, img.ext);
    await writeFile(new URL(name, DIR), img.buf);
    written.set(a.file, name);
  }
  keep.add(name);
  const l = ok.get(a.file);
  const rec = { name: a.name, icao: a.icao, wikidata: a.qid, src: "/data/logos/" + name, page: l.page, author: l.author, licence: l.licence };
  (logos[a.iata] ??= []).push(rec);
  credits.push({ ...rec, iata: a.iata, file: a.file });
}
for (const n of await readdir(DIR)) if (!keep.has(n)) await unlink(new URL(n, DIR));
const count = credits.length;
if (count < 300) throw new Error(`Only ${count} logos; expected more. Not writing the manifest.`);

await writeFile(MANIFEST, JSON.stringify({ version: 1, built: TODAY, source: "Wikidata P154 + Wikimedia Commons", logos }));
credits.sort((x, y) => x.iata.localeCompare(y.iata) || String(x.name).localeCompare(String(y.name)));
await writeFile(CREDITS, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1017">
<title>Logo credits — Airport Live</title><link rel="stylesheet" href="/styles.css"></head>
<body><div class="app credits">
<p><a class="ghost" href="/">← Airport Live</a></p>
<h1>Airline logo credits</h1>
<p class="note">Airline logos come from <a href="https://commons.wikimedia.org">Wikimedia Commons</a> (linked from Wikidata), only under free licences: public domain, CC0, CC BY or CC BY-SA. Logos are trademarks of their airlines and are shown only to identify the airline. Built ${TODAY} by <code>npm run build:logos</code>; ${count} logos.</p>
<table class="credits-table"><thead><tr><th>Code</th><th>Airline</th><th>Logo</th><th>Author</th><th>Licence</th></tr></thead><tbody>
${credits.map(c => `<tr><td><code>${esc(c.iata)}</code></td><td>${esc(c.name || "")}</td><td><a href="${esc(c.page)}">${esc(c.file)}</a></td><td>${esc(c.author || "—")}</td><td>${esc(c.licence)}</td></tr>`).join("\n")}
</tbody></table></div></body></html>
`);
const pd = credits.filter(c => /^(public domain|pd|cc0)/i.test(c.licence)).length;
console.log(`Wrote ${count} logos for ${Object.keys(logos).length} IATA codes (${pd} public domain/CC0, ${count - pd} with credit).`);
