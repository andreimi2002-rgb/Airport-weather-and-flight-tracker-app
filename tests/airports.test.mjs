import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize, indexAirports, findAirport, searchAirports, parseRoute, airportPath, airportLocation } from "../public/js/airports.js";

const real = indexAirports(JSON.parse(readFileSync(new URL("../public/data/airports.json", import.meta.url), "utf8")));
const top = (q, n = 3) => searchAirports(real, q, n).map(a => a.iata);

test("normalize removes accents, case and punctuation", () => {
  assert.equal(normalize("Henri Coandă"), "henri coanda");
  assert.equal(normalize("Zürich-Kloten"), "zurich kloten");
  assert.equal(normalize("Łódź"), "lodz");
  assert.equal(normalize(null), "");
});

test("findAirport by IATA or ICAO, any case", () => {
  assert.equal(findAirport(real, "otp").iata, "OTP");
  assert.equal(findAirport(real, "LROP").iata, "OTP");
  assert.equal(findAirport(real, "ZZZZ"), null);
  assert.equal(findAirport(real, ""), null);
  assert.equal(findAirport(real, "TOOLONG"), null);
});

test("search: exact codes first", () => {
  assert.equal(top("OTP")[0], "OTP");
  assert.equal(top("lrop")[0], "OTP");
  assert.equal(top("sea")[0], "SEA");
  assert.equal(top("jfk")[0], "JFK");
});

test("search: names, cities, accents and keywords", () => {
  assert.equal(top("heathrow")[0], "LHR");
  assert.equal(top("coanda")[0], "OTP");
  assert.equal(top("zurich")[0], "ZRH");
  assert.deepEqual(top("bucharest", 2).sort(), ["BBU", "OTP"]);
  assert.ok(top("tokyo", 2).includes("NRT"), "Narita found via keyword 'Tokyo'");
  assert.deepEqual(top("new york", 2).sort(), ["JFK", "LGA"], "big airports before heliports/seaplane bases");
  assert.ok(top("london", 4).includes("LHR"));
  assert.ok(top("cluj heathrow").length === 0, "every word must match");
});

test("search: empty and nonsense queries", () => {
  assert.deepEqual(searchAirports(real, "   "), []);
  assert.deepEqual(searchAirports(real, "xqzxqz"), []);
  assert.equal(searchAirports(real, "a", 5).length, 5, "respects limit");
});

test("parseRoute", () => {
  assert.deepEqual(parseRoute("/"), { code: null });
  assert.deepEqual(parseRoute("/index.html"), { code: null });
  assert.deepEqual(parseRoute("/airport/otp"), { code: "OTP" });
  assert.deepEqual(parseRoute("/airport/LROP/"), { code: "LROP" });
  assert.equal(parseRoute("/airport/<script>").invalid, true);
  assert.equal(parseRoute("/something/else").invalid, true);
});

test("airportPath and airportLocation", () => {
  const otp = findAirport(real, "OTP");
  assert.equal(airportPath(otp), "/airport/OTP");
  assert.equal(airportLocation(otp), "Otopeni, Ilfov County, Romania");
  assert.equal(airportLocation(findAirport(real, "SEA")), "Seattle, Washington, United States");
  assert.equal(airportLocation(findAirport(real, "BBU")), "Bucharest, Romania", "region '(municipality)' repeating the city is dropped");
  assert.equal(airportLocation({ city: null, region: null, country: null }), "Location not available");
});
