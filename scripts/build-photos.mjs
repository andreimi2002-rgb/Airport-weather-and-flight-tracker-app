// Builds public/data/photos/*.json: one airport photo and one city photo
// per airport, from Wikidata + Wikimedia Commons, with author and licence.
//   npm run build:photos
// Run by hand to refresh, then commit. Every photo URL is checked.
import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { csvToObjects } from "./lib/airport-data.mjs";
import { groupAirportItems, matchAirport, groupCities, matchCity, toPhoto, shardKey } from "./lib/photo-data.mjs";

const UA = "AirportLive/0.1 (https://github.com/andreimi2002-rgb/Airport-weather-and-flight-tracker-app; photo metadata build)";
const SPARQL = "https://query.wikidata.org/sparql";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const OUT = new URL("../public/data/photos/", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every request has a time limit that also covers reading the answer
// (`read`), so a slow or silent server leads to a retry, not a hang.
async function fetchRetry(url, { init = {}, tries = 4, timeoutMs = 60000, read = res => res } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, ...(init.headers || {}) } });
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(3000 * i); continue; }
      return await read(res);
    } catch (err) {
      if (i >= tries) throw err;
      console.log(`  retry ${i}/${tries - 1} after: ${err.name === "TimeoutError" ? "timeout" : err.message}`);
      await sleep(3000 * i);
    }
  }
}

async function sparql(query) {
  const text = await fetchRetry(SPARQL + "?query=" + encodeURIComponent(query), {
    init: { headers: { Accept: "text/csv" } },
    timeoutMs: 180000,
    read: res => { if (!res.ok) throw new Error(`Wikidata query failed: HTTP ${res.status}`); return res.text(); },
  });
  return csvToObjects(text);
}

// Commons file info, 50 files per request.
async function commonsInfo(files) {
  const info = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", maxlag: "5",
      prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "1280",
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
      titles: batch.map(f => "File:" + f).join("|"),
    });
    const j = await fetchRetry(COMMONS + "?" + params, {
      read: async res => {
        if (!res.ok) throw new Error(`Commons API failed: HTTP ${res.status}`);
        const body = await res.json();
        if (body.error) throw new Error(`Commons API: ${body.error.code}`); // e.g. maxlag: servers busy, retry
        return body;
      },
    });
    const back = new Map();
    for (const n of j.query?.normalized ?? []) back.set(n.to, n.from);
    for (const p of j.query?.pages ?? []) {
      const asked = (back.get(p.title) ?? p.title).replace(/^File:/, "");
      info.set(asked, p.imageinfo?.[0] ?? null);
    }
    if ((i / 50) % 20 === 0 || i + 50 >= files.length) console.log(`  Commons metadata ${Math.min(i + 50, files.length)}/${files.length}`);
  }
  return info;
}

// Checks that a URL really returns an image. Returns "ok" or a reason.
async function checkLink(url) {
  try {
    const res = await fetchRetry(url, { init: { method: "HEAD" }, tries: 2, timeoutMs: 20000 });
    if (res.status === 429) return "rate-limited";
    if (!res.ok) return "HTTP " + res.status;
    return /^image\//.test(res.headers.get("content-type") || "") ? "ok" : "not an image";
  } catch (err) {
    return err.name === "TimeoutError" ? "timeout" : "network error";
  }
}

// Round 1: 2 at a time. Round 2: failures again, one at a time with a
// pause, so a temporary "too many requests" doesn't remove good photos.
async function verify(urls) {
  const ok = new Set();
  let failed = [];
  const list = [...urls];
  let done = 0;
  async function worker() {
    while (list.length) {
      const url = list.pop();
      if ((await checkLink(url)) === "ok") ok.add(url); else failed.push(url);
      if (++done % 500 === 0 || done === urls.size) console.log(`  Checked ${done}/${urls.size} photo links`);
    }
  }
  await Promise.all(Array.from({ length: 2 }, worker));
  const reasons = {};
  if (failed.length) {
    console.log(`  ${failed.length} failed; checking them again slowly…`);
    for (const url of failed) {
      await sleep(1000);
      const r = await checkLink(url);
      if (r === "ok") ok.add(url); else reasons[r] = (reasons[r] || 0) + 1;
    }
  }
  return { ok, reasons };
}

// Photo links checked in an earlier run (last 30 days) are not checked again.
async function previouslyVerified() {
  const known = new Map();
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  try {
    for (const name of await readdir(OUT)) {
      if (name === "index.json" || !name.endsWith(".json")) continue;
      const entries = JSON.parse(await readFile(new URL(name, OUT), "utf8"));
      for (const e of Object.values(entries)) {
        for (const p of [e.airport, e.city?.photo]) if (p?.verified >= cutoff) known.set(p.src, p.verified);
      }
    }
  } catch { /* no earlier run */ }
  return known;
}

// ---------- main ----------
const data = JSON.parse(await readFile(new URL("../public/data/airports.json", import.meta.url), "utf8"));
const f = Object.fromEntries(data.fields.map((k, i) => [k, i]));
const airports = data.airports.map(r => ({ iata: r[f.iata], icao: r[f.icao], city: r[f.city] }));

console.log("Querying Wikidata…");
const itemRows = await sparql("SELECT ?a ?iata ?icao ?img WHERE { ?a wdt:P238 ?iata . OPTIONAL { ?a wdt:P239 ?icao } OPTIONAL { ?a wdt:P18 ?img } }");
// "Place served" that has a population: a city/town, not a railway station.
const cityRows = await sparql('SELECT ?a ?city ?cityLabel ?cimg WHERE { ?a wdt:P238 [] ; wdt:P931 ?city . FILTER EXISTS { ?city wdt:P1082 [] } OPTIONAL { ?city wdt:P18 ?cimg } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }');
const byIata = groupAirportItems(itemRows);
const citiesByAirport = groupCities(cityRows);

const matches = new Map();
const files = new Set();
let unmatched = 0;
for (const a of airports) {
  const m = matchAirport(a, byIata);
  if (!m) { unmatched++; continue; }
  const city = matchCity(a, m.qid, citiesByAirport);
  matches.set(a.iata, { ...m, city });
  for (const img of m.images) files.add(img);
  for (const img of city?.images ?? []) files.add(img);
}
console.log(`Matched ${matches.size} airports to Wikidata (${unmatched} not matched or ambiguous). ${files.size} photos to look at.`);

const info = await commonsInfo([...files]);
const photos = new Map(), rejected = {};
for (const file of files) {
  const r = toPhoto(info.get(file), TODAY);
  if (r.photo) photos.set(file, r.photo);
  else { const k = r.reject.split(" ")[0]; rejected[k] = (rejected[k] || 0) + 1; }
}
console.log(`${photos.size} photos pass licence/type/size rules. Rejected:`, rejected);

// Only the photo that will actually be shown (first usable one) is checked.
const pick = list => (list ?? []).map(file => photos.get(file)).filter(Boolean);
const known = await previouslyVerified();
const toCheck = new Set();
for (const m of matches.values()) for (const p of [pick(m.images)[0], pick(m.city?.images)[0]]) if (p && !known.has(p.src)) toCheck.add(p.src);
console.log(`${known.size} links verified in the last 30 days; checking ${toCheck.size} new links.`);
const { ok: working, reasons } = await verify(toCheck);
for (const [src, date] of known) working.add(src);
for (const p of photos.values()) if (known.has(p.src)) p.verified = known.get(p.src);

// First photo that passed the rules AND loads; next one if it doesn't.
const firstWorking = list => pick(list).find(p => working.has(p.src)) ?? null;
let fallbacks = 0;
const shards = {};
const counts = { airports: 0, airportPhotos: 0, cityPhotos: 0, cityNames: 0 };
for (const [iata, m] of matches) {
  let airportPhoto = firstWorking(m.images);
  let cityPhoto = firstWorking(m.city?.images);
  // A photo whose link failed: try the next candidate (checked now).
  for (const [list, set] of [[m.images, p => (airportPhoto = p)], [m.city?.images, p => (cityPhoto = p)]]) {
    const cands = pick(list);
    if (cands.length && !cands.some(p => working.has(p.src))) {
      for (const p of cands.slice(1)) if ((await checkLink(p.src)) === "ok") { working.add(p.src); set(p); fallbacks++; break; }
    }
  }
  if (!airportPhoto && !m.city) continue;
  const entry = { wikidata: m.qid, airport: airportPhoto };
  if (m.city) entry.city = { name: m.city.name, wikidata: m.city.qid, photo: cityPhoto };
  (shards[shardKey(iata)] ??= {})[iata] = entry;
  counts.airports++;
  if (airportPhoto) counts.airportPhotos++;
  if (cityPhoto) counts.cityPhotos++;
  if (m.city) counts.cityNames++;
}
console.log(`Link problems after second check:`, reasons, `· used next photo for ${fallbacks}`);
if (counts.airportPhotos < 2000) throw new Error(`Only ${counts.airportPhotos} airport photos; expected more. Not writing.`);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const [key, entries] of Object.entries(shards)) await writeFile(new URL(key + ".json", OUT), JSON.stringify(entries));
await writeFile(new URL("index.json", OUT), JSON.stringify({
  version: 1, generated: TODAY, counts, rejected, linkProblems: reasons,
  sources: [
    { name: "Wikidata", url: "https://www.wikidata.org", licence: "CC0", used: "Which photo and city belong to each airport" },
    { name: "Wikimedia Commons", url: "https://commons.wikimedia.org", licence: "Per photo (public domain, CC0, CC BY, CC BY-SA)", used: "Airport and city photos" },
  ],
}, null, 1));
console.log("Wrote", Object.keys(shards).length, "files:", counts);
