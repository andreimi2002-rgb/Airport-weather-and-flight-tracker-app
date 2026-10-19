// Builds public/data/airports.json from public sources.
//   npm run build:airports
// Run it by hand when the airport list should be refreshed, then commit
// the result. The app itself never downloads these source files.
import { writeFile, mkdir } from "node:fs/promises";
import { csvToObjects, buildAirportData } from "./lib/airport-data.mjs";

const OURAIRPORTS = "https://davidmegginson.github.io/ourairports-data";
const MWGG = "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json";
const OUT = new URL("../public/data/airports.json", import.meta.url);

const SOURCES = [
  { name: "OurAirports", url: "https://ourairports.com/data/", licence: "Public domain", used: "Airports, codes, names, locations, runways, countries, regions" },
  { name: "mwgg/Airports", url: "https://github.com/mwgg/Airports", licence: "MIT, Copyright (c) 2014 mwgg", used: "Airport time zones" },
];

async function get(url, as = "text") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

console.log("Downloading OurAirports and mwgg data…");
const [airports, runways, countries, regions, mwgg] = await Promise.all([
  get(`${OURAIRPORTS}/airports.csv`).then(csvToObjects),
  get(`${OURAIRPORTS}/runways.csv`).then(csvToObjects),
  get(`${OURAIRPORTS}/countries.csv`).then(csvToObjects),
  get(`${OURAIRPORTS}/regions.csv`).then(csvToObjects),
  get(MWGG, "json"),
]);

const { data, stats } = buildAirportData({
  airports, runways, countries, regions, mwgg,
  generated: new Date().toISOString().slice(0, 10),
  sources: SOURCES,
});

// Sanity checks: refuse to write a file that is obviously broken.
if (stats.kept < 5000) throw new Error(`Only ${stats.kept} airports found; expected more than 5000.`);
for (const code of ["SEA", "LHR", "OTP", "JFK"]) {
  if (!data.airports.some(r => r[0] === code)) throw new Error(`${code} missing from output.`);
}

await mkdir(new URL(".", OUT), { recursive: true });
const json = JSON.stringify(data);
await writeFile(OUT, json);
console.log(`Wrote ${stats.kept} airports (${stats.withTimeZone} with time zone), ${(json.length / 1024).toFixed(0)} KB.`);
if (stats.skippedDuplicateIata) console.log(`Skipped ${stats.skippedDuplicateIata} duplicate IATA codes.`);
