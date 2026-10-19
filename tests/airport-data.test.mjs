import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, csvToObjects, countRunways, makeTimeZoneLookup, cleanKeywords, buildAirportData, FIELDS } from "../scripts/lib/airport-data.mjs";

test("parseCsv handles quotes, commas, doubled quotes and CRLF", () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""",\r\n1,2,3');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'say "hi"', ""], ["1", "2", "3"]]);
});

test("csvToObjects keys rows by header", () => {
  assert.deepEqual(csvToObjects("id,name\n1,Otopeni\n"), [{ id: "1", name: "Otopeni" }]);
});

test("countRunways skips closed runways and helipads", () => {
  const counts = countRunways([
    { airport_ident: "LROP", closed: "0", le_ident: "08R" },
    { airport_ident: "LROP", closed: "0", le_ident: "08L" },
    { airport_ident: "LROP", closed: "1", le_ident: "17" },
    { airport_ident: "LROP", closed: "0", le_ident: "H1" },
  ]);
  assert.equal(counts.get("LROP"), 2);
});

test("time zone lookup: ident first, IATA fallback, conflict = unknown, invalid ignored", () => {
  const lookup = makeTimeZoneLookup({
    LROP: { iata: "OTP", tz: "Europe/Bucharest" },
    KSEA: { iata: "SEA", tz: "America/Los_Angeles" },
    XXXX: { iata: "AAA", tz: "Europe/Paris" },
    YYYY: { iata: "BBB", tz: "Not/AZone" },
    ZZZ1: { iata: "DUP", tz: "Europe/Rome" },
    ZZZ2: { iata: "DUP", tz: "Europe/Oslo" },
  });
  assert.equal(lookup({ iata: "OTP", idents: ["LROP"] }), "Europe/Bucharest");
  assert.equal(lookup({ iata: "SEA", idents: ["", "", "NOPE"] }), "America/Los_Angeles");
  assert.equal(lookup({ iata: "AAA", idents: ["LROP"] }), null, "ident and IATA disagree -> unknown");
  assert.equal(lookup({ iata: "BBB", idents: ["YYYY"] }), null, "invalid time zone ignored");
  assert.equal(lookup({ iata: "DUP", idents: [] }), null, "ambiguous IATA not used");
});

test("cleanKeywords keeps Latin-script keywords only", () => {
  assert.equal(cleanKeywords("TYO, Tokyo, 成田空港, Tokyo"), "TYO, Tokyo");
  assert.equal(cleanKeywords("Москва"), null);
  assert.equal(cleanKeywords(""), null);
});

test("buildAirportData keeps only airports with IATA codes and fills names", () => {
  const airports = [
    { ident: "LROP", type: "large_airport", name: "Henri Coandă", latitude_deg: "44.57", longitude_deg: "26.10", elevation_ft: "314", iso_country: "RO", iso_region: "RO-IF", municipality: "Otopeni", scheduled_service: "yes", icao_code: "LROP", iata_code: "OTP", gps_code: "LROP", keywords: "BUH" },
    { ident: "NOIATA", type: "small_airport", name: "Field", latitude_deg: "1", longitude_deg: "1", elevation_ft: "", iso_country: "RO", iso_region: "RO-B", municipality: "", scheduled_service: "no", icao_code: "", iata_code: "", gps_code: "", keywords: "" },
    { ident: "CLOSED", type: "closed", name: "Old", latitude_deg: "1", longitude_deg: "1", elevation_ft: "", iso_country: "RO", iso_region: "RO-B", municipality: "", scheduled_service: "no", icao_code: "", iata_code: "OLD", gps_code: "", keywords: "" },
  ];
  const { data, stats } = buildAirportData({
    airports, runways: [{ airport_ident: "LROP", closed: "0", le_ident: "08R" }],
    countries: [{ code: "RO", name: "Romania" }], regions: [{ code: "RO-IF", name: "Ilfov County" }],
    mwgg: { LROP: { iata: "OTP", tz: "Europe/Bucharest" } }, generated: "2026-01-01", sources: [],
  });
  assert.equal(stats.kept, 1);
  assert.equal(data.airports.length, 1);
  const row = Object.fromEntries(FIELDS.map((k, i) => [k, data.airports[0][i]]));
  assert.deepEqual(row, { iata: "OTP", icao: "LROP", name: "Henri Coandă", city: "Otopeni", region: "RO-IF", country: "RO", lat: 44.57, lon: 26.1, elevationFt: 314, type: "L", scheduled: 1, tz: "Europe/Bucharest", runways: 1, keywords: "BUH" });
  assert.equal(data.countries.RO, "Romania");
  assert.equal(data.regions["RO-IF"], "Ilfov County");
});

test("generated public/data/airports.json is sane", () => {
  const data = JSON.parse(readFileSync(new URL("../public/data/airports.json", import.meta.url), "utf8"));
  assert.deepEqual(data.fields, FIELDS);
  assert.ok(data.airports.length > 8000, "has thousands of airports");
  const codes = data.airports.map(r => r[0]);
  assert.equal(new Set(codes).size, codes.length, "no duplicate IATA codes");
  const tz = Object.fromEntries(data.airports.map(r => [r[0], r[11]]));
  assert.equal(tz.SEA, "America/Los_Angeles");
  assert.equal(tz.LHR, "Europe/London");
  assert.equal(tz.OTP, "Europe/Bucharest");
  assert.equal(tz.JFK, "America/New_York");
  for (const r of data.airports) assert.ok(r[11] === null || typeof r[11] === "string");
  assert.ok(data.sources.some(s => s.name === "OurAirports") && data.sources.some(s => /MIT/.test(s.licence)), "sources and licences listed");
});
