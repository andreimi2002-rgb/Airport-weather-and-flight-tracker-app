// Builds public/data/photos/*.json: one airport photo and one city photo
// per airport, from Wikidata + Wikimedia Commons, with author and licence.
//   npm run build:photos
// Run by hand to refresh, then commit. Every photo URL is checked.
import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { sparql, commonsInfo, checkLink, verify } from "./lib/wikimedia.mjs";
import { groupAirportItems, matchAirport, groupCities, matchCity, toPhoto, shardKey } from "./lib/photo-data.mjs";

const OUT = new URL("../public/data/photos/", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);

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
// Every photo statement (not only the "best" one wdt:P18 returns), with its
// rank so preferred photos are tried first; deprecated ones are skipped.
const itemRows = await sparql("SELECT ?a ?iata ?icao ?img ?rank WHERE { ?a wdt:P238 ?iata . OPTIONAL { ?a wdt:P239 ?icao } OPTIONAL { ?a p:P18 ?st . ?st ps:P18 ?img ; wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank) } }");
// "Place served" that has a population: a city/town, not a railway station.
const cityRows = await sparql('SELECT ?a ?city ?cityLabel ?cimg ?crank WHERE { ?a wdt:P238 [] ; wdt:P931 ?city . FILTER EXISTS { ?city wdt:P1082 [] } OPTIONAL { ?city p:P18 ?cst . ?cst ps:P18 ?cimg ; wikibase:rank ?crank . FILTER(?crank != wikibase:DeprecatedRank) } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }');
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
