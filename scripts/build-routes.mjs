// Builds public/data/routes/<letter>.json (known routes by airport pair) and
// public/data/airlines.json (airline search list) from the VRS standing data
// (github.com/vradarserver/standing-data, CC0).
//   npm run build:routes
// Run by hand to refresh, then commit. These are callsign routes, not a
// timetable: the pages say so.
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { csvToObjects } from "./lib/airport-data.mjs";
import { routeRows, addToIndex, shardIndex, airlineList } from "./lib/route-data.mjs";

const UA = "AirportLive/0.1 (https://github.com/andreimi2002-rgb/Airport-weather-and-flight-tracker-app; route index build)";
const RAW = "https://raw.githubusercontent.com/vradarserver/standing-data/main/";
const TREE = "https://api.github.com/repos/vradarserver/standing-data/git/trees/main?recursive=1";
const OUT = new URL("../public/data/routes/", import.meta.url);
const AIRLINES = new URL("../public/data/airlines.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, as = "text") {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      return as === "json" ? res.json() : res.text();
    } catch (err) {
      if (i >= 4) throw err;
      await sleep(2000 * i);
    }
  }
}

// Our airports: ICAO and IATA codes -> IATA.
const data = JSON.parse(await readFile(new URL("../public/data/airports.json", import.meta.url), "utf8"));
const f = Object.fromEntries(data.fields.map((k, i) => [k, i]));
const toIataMap = new Map();
for (const r of data.airports) { if (r[f.icao]) toIataMap.set(r[f.icao], r[f.iata]); }
for (const r of data.airports) { if (!toIataMap.has(r[f.iata])) toIataMap.set(r[f.iata], r[f.iata]); }
const toIata = code => toIataMap.get(code) || null;

// Airlines that no longer fly (Wikidata: dissolved, P576), by ICAO code. A code
// is dropped only when every item using it is dissolved (codes get reused).
console.log("Asking Wikidata which airlines are dissolved…");
const wd = await get("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent("SELECT ?icao ?closed WHERE { ?a wdt:P230 ?icao . BIND(EXISTS { ?a wdt:P576 [] } AS ?closed) }"), "json");
const icaoOpen = new Map();
for (const b of wd.results.bindings) {
  const code = b.icao.value.toUpperCase();
  icaoOpen.set(code, (icaoOpen.get(code) || false) || b.closed.value !== "true");
}
const dissolved = new Set([...icaoOpen].filter(([, open]) => !open).map(([code]) => code));
console.log(`${dissolved.size} ICAO codes belong only to dissolved airlines.`);

console.log("Listing route files…");
const tree = await get(TREE, "json");
if (tree.truncated) throw new Error("GitHub file list is truncated; not building.");
// Most airlines have one "-all" file; large ones are split into "-0" … "-9".
const files = tree.tree.filter(x => x.type === "blob" && /^routes\/schema-01\/[A-Z0-9]\/[A-Z0-9]{3}-(all|\d)\.csv$/.test(x.path)).map(x => x.path)
  .filter(p => !dissolved.has(p.split("/").pop().slice(0, 3)));
console.log(`${files.length} route files of airlines not known to be dissolved.`);

const index = {}, routeCounts = {};
let done = 0, kept = 0;
const queue = [...files];
async function worker() {
  while (queue.length) {
    const path = queue.pop();
    const icao = path.split("/").pop().slice(0, 3);
    const text = await get(RAW + path);
    if (text) {
      const n = addToIndex(index, routeRows(csvToObjects(text.replace(/^﻿/, ""))), toIata);
      routeCounts[icao] = (routeCounts[icao] || 0) + n;
      kept += n;
    }
    if (++done % 200 === 0) console.log(`  ${done}/${files.length}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

const shards = shardIndex(index);
const pairs = Object.values(index).reduce((a, d) => a + Object.keys(d).length, 0);
if (pairs < 20000) throw new Error(`Only ${pairs} airport pairs; expected more. Not writing.`);
await mkdir(OUT, { recursive: true });
for (const n of await readdir(OUT)) if (n.endsWith(".json")) await unlink(new URL(n, OUT));
let bytes = 0;
for (const [letter, part] of Object.entries(shards)) {
  const text = JSON.stringify(part);
  bytes += text.length;
  await writeFile(new URL(letter + ".json", OUT), text);
}
await writeFile(new URL("index.json", OUT), JSON.stringify({ version: 1, built: TODAY, source: "VRS standing data (CC0)", pairs, letters: Object.keys(shards).sort() }));

const airlineText = await get(RAW + "airlines/schema-01/airlines.csv");
const airlines = airlineList(csvToObjects(airlineText.replace(/^﻿/, "")).filter(r => !dissolved.has(String(r.ICAO || "").trim().toUpperCase())), routeCounts);
await writeFile(AIRLINES, JSON.stringify({ version: 1, built: TODAY, source: "VRS standing data (CC0)", fields: ["name", "icao", "iata", "routes"], airlines: airlines.map(a => [a.name, a.icao, a.iata, a.routes]) }));
console.log(`Wrote ${pairs} airport pairs (${kept} callsign legs) in ${Object.keys(shards).length} files, ${(bytes / 1e6).toFixed(1)} MB; ${airlines.length} airlines.`);
