import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { indexAirports } from "../public/js/airports.js";
import { indexAirlines, searchAll, parseRoute, parseFlight, searchAirlines, airlineForCode } from "../public/js/search.js";
import { legsOf, routeRows, addToIndex, shardIndex, airlineList } from "../scripts/lib/route-data.mjs";

const index = indexAirports(JSON.parse(readFileSync(new URL("../public/data/airports.json", import.meta.url), "utf8")));
const airlines = indexAirlines(JSON.parse(readFileSync(new URL("../public/data/airlines.json", import.meta.url), "utf8")));
const kinds = q => searchAll(q, { index, airlines }).map(r => r.kind + ":" + (r.href || ""));

test("routes: codes, separators and place names", () => {
  const r = q => parseRoute(q, index).map(x => x.from.iata + "-" + x.to.iata);
  assert.deepEqual(r("CDG-LAX"), ["CDG-LAX"]);
  assert.deepEqual(r("cdg lax"), ["CDG-LAX"]);
  assert.deepEqual(r("LFPG-KLAX"), ["CDG-LAX"]);
  assert.deepEqual(r("OTP → LHR"), ["OTP-LHR"]);
  assert.ok(r("Paris to Los Angeles").includes("CDG-LAX"), r("Paris to Los Angeles").join());
  assert.ok(r("Bucharest London").some(x => x.startsWith("OTP-")), r("Bucharest London").join());
  // One place, not a route
  assert.deepEqual(r("New York"), []);
  assert.deepEqual(r("Los Angeles"), []);
  assert.deepEqual(r("OTP"), []);
});

test("flights: IATA or ICAO airline code + number, only for known airlines", () => {
  assert.equal(parseFlight("KL 1377", airlines).airline.icao, "KLM");
  assert.equal(parseFlight("klm1377", airlines).code, "KLM");
  assert.equal(parseFlight("RO391", airlines).number, "391");
  assert.equal(parseFlight("ZZ9999", airlines), null);
  assert.equal(parseFlight("OTP", airlines), null);
});

test("airlines: exact codes and names", () => {
  assert.equal(airlineForCode(airlines, "RO").icao, "ROT");
  assert.equal(airlineForCode(airlines, "KLM").iata, "KL");
  assert.ok(searchAirlines(airlines, "wizz").some(a => a.icao === "WMT"));
  assert.ok(searchAirlines(airlines, "tarom").some(a => a.icao === "ROT"));
});

test("searchAll: the most specific meaning first", () => {
  assert.equal(kinds("CDG-LAX")[0], "route:/route/CDG-LAX");
  assert.equal(kinds("KL1377")[0], "flight:/flight/KL1377");
  assert.equal(kinds("YR-ASA")[0], "aircraft:/aircraft/YR-ASA");
  assert.equal(kinds("KLM")[0], "airline:/airline/KLM");
  assert.equal(kinds("OTP")[0], "airport:/airport/OTP");
  assert.ok(kinds("Heathrow").includes("airport:/airport/LHR"));
  assert.ok(kinds("wizz").some(k => k.startsWith("airline:")));
});

test("route index build: legs, our IATA codes, shards, airline list", () => {
  assert.deepEqual(legsOf("LROP-EGLL-KJFK"), [["LROP", "EGLL"], ["EGLL", "KJFK"]]);
  const idx = {};
  const rows = routeRows([{ Callsign: "ROT391", AirportCodes: "LROP-EGLL" }, { Callsign: "XYZ1", AirportCodes: "LROP-ZZZZ" }]);
  const map = { LROP: "OTP", EGLL: "LHR" };
  assert.equal(addToIndex(idx, rows, c => map[c] || null), 1);
  assert.deepEqual(shardIndex(idx), { O: { OTP: { LHR: ["ROT391"] } } });
  const list = airlineList([{ Name: "Tarom", ICAO: "ROT", IATA: "RO" }, { Name: "Abacus", ICAO: "", IATA: "1B" }, { Name: "Gone", ICAO: "GNE", IATA: "" }], { ROT: 5 });
  assert.deepEqual(list, [{ name: "Tarom", icao: "ROT", iata: "RO", routes: 5 }]);
});

test("generated route index has the big routes", () => {
  const C = JSON.parse(readFileSync(new URL("../public/data/routes/C.json", import.meta.url), "utf8"));
  assert.ok(C.CDG.LAX.some(c => c.startsWith("AFR")), "Air France on CDG-LAX");
  const O = JSON.parse(readFileSync(new URL("../public/data/routes/O.json", import.meta.url), "utf8"));
  assert.ok(O.OTP.LHR.some(c => c.startsWith("ROT")));
});
