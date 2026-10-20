import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBoardLive } from "../public/js/flights.js";
import { getAirportLive, airlineRoutes } from "../netlify/lib/flights/live.mjs";
import { memoryStore } from "../netlify/lib/flights/budget.mjs";

const now = Date.parse("2026-10-20T12:00:00Z");
const iso = min => new Date(now + min * 60000).toISOString().slice(0, 16) + "Z";
const flight = (id, dir, otherCode, min, airline, reg = null) => ({
  id, direction: dir, status: "expected", airline, aircraft: { registration: reg },
  departure: { airport: { iata: dir === "departure" ? "OTP" : otherCode }, scheduled: { utc: iso(dir === "departure" ? min : min - 120) } },
  arrival: { airport: { iata: dir === "arrival" ? "OTP" : otherCode }, scheduled: { utc: iso(dir === "arrival" ? min : min + 120) } },
});
const ac = (callsign, from, to, extra = {}) => ({ callsign, from, to, airlineIcao: callsign.slice(0, 3), airlineIata: [], registration: "X-" + callsign, ...extra });
const WZZ = { iata: "W6", icao: "WZZ", name: "Wizz Air" };

test("board live: route + airline + time window, unique both ways", () => {
  const flights = [
    flight("dep-lhr", "departure", "LHR", -20, WZZ),
    flight("arr-cph", "arrival", "CPH", 25, { iata: "W4", icao: null, name: "Wizz Air Malta" }),
    flight("dep-vie-1", "departure", "VIE", -30, WZZ), flight("dep-vie-2", "departure", "VIE", -10, WZZ),
    flight("dep-old", "departure", "MAD", -400, WZZ),
    flight("dep-reg", "departure", "CLJ", -5, { iata: "RO", icao: "ROT" }, "YR-ATK"),
  ];
  const aircraft = [
    ac("WZZ1AB", "OTP", "LHR"),                                     // one candidate -> match
    ac("WMT508", "CPH", "OTP", { airlineIata: ["W4"] }),            // no ICAO on the board: IATA of WMT
    ac("WZZ7QQ", "OTP", "VIE"),                                     // two Wizz flights to VIE -> none
    ac("WZZ9MM", "OTP", "MAD"),                                     // flight time far outside the window -> none
    ac("ROT611", "OTP", "CLJ", { registration: "YR-ATB" }),         // board says YR-ATK -> not this aircraft
    ac("DLH1", "OTP", "LHR"),                                       // other airline, other number -> none
  ];
  const m = matchBoardLive(flights, aircraft, "OTP", now);
  assert.deepEqual([...m.keys()].sort(), ["arr-cph", "dep-lhr"]);
  assert.equal(m.get("dep-lhr").callsign, "WZZ1AB");
});

test("board live: two aircraft claiming one flight -> none; registration on the board decides", () => {
  const flights = [flight("dep-lhr", "departure", "LHR", -20, WZZ)];
  assert.equal(matchBoardLive(flights, [ac("WZZ1AB", "OTP", "LHR"), ac("WZZ2CD", "OTP", "LHR")], "OTP", now).size, 0);
  const withReg = [flight("dep-reg", "departure", "CLJ", -5, { iata: "RO", icao: "ROT" }, "YR-ATK")];
  assert.equal(matchBoardLive(withReg, [ac("ROT611", "OTP", "CLJ", { registration: "YR-ATK" })], "OTP", now).size, 1);
});

test("board live: aircraft swap (board's planned registration differs) only with callsign = airline + flight number", () => {
  const klm = { ...flight("kl1377", "arrival", "AMS", 25, { iata: "KL", icao: "KLM", name: "KLM" }, "PH-AXU"), number: "KL 1377" };
  assert.equal(matchBoardLive([klm], [ac("KLM1377", "AMS", "OTP", { registration: "PH-AXD" })], "OTP", now).get("kl1377").registration, "PH-AXD");
  assert.equal(matchBoardLive([klm], [ac("KLM62R", "AMS", "OTP", { registration: "PH-AXD" })], "OTP", now).size, 0);
  assert.equal(matchBoardLive([{ ...klm, number: "KL 0377" }], [ac("KLM377", "AMS", "OTP", { registration: "PH-AXD" })], "OTP", now).size, 1);
  // Flown by a subsidiary under its own prefix, same number
  const lh = { ...flight("lh1654", "arrival", "MUC", 30, { iata: "LH", icao: "DLH", name: "Lufthansa" }), number: "LH 1654" };
  assert.equal(matchBoardLive([lh], [ac("LHX1654", "MUC", "OTP")], "OTP", now).size, 1);
  assert.equal(matchBoardLive([lh], [ac("LHX1655", "MUC", "OTP")], "OTP", now).size, 0);
});

test("airport live: one area call, keeps aircraft on routes to or from the airport", async () => {
  const P = { LROP: { iata: "OTP", lat: 44.57, lon: 26.08 }, EGLL: { iata: "LHR", lat: 51.47, lon: -0.46 }, LEMD: { iata: "MAD", lat: 40.47, lon: -3.56 }, EDDF: { iata: "FRA", lat: 50.03, lon: 8.56 } };
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes("/v2/point/")) return new Response(JSON.stringify({ ac: [
      { flight: "WZZ1AB ", r: "HA-LXA", t: "A321", alt_baro: 9000, lat: 45.0, lon: 24.5, seen: 1 },   // OTP-LHR, on the line
      { flight: "WZZ5XY ", r: "HA-LXB", t: "A321", alt_baro: 35000, lat: 45.5, lon: 21.0, seen: 1 },  // MAD-FRA: not this airport
      { flight: "WZZ6ZZ ", r: "HA-LXD", t: "A321", alt_baro: 30000, lat: 40.0, lon: 30.0, seen: 1 },  // OTP-LHR but far off the line
      { flight: "N123AB ", r: "N123AB", alt_baro: 5000, lat: 44.6, lon: 26.0, seen: 1 },               // not an airline callsign
    ] }));
    if (String(url).includes("routes/schema-01/W/WZZ-all.csv")) return new Response("Callsign,Code,Number,AirlineCode,AirportCodes\nWZZ1AB,WZZ,1AB,WZZ,LROP-EGLL\nWZZ5XY,WZZ,5XY,WZZ,LEMD-EDDF\nWZZ6ZZ,WZZ,6ZZ,WZZ,LROP-EGLL\n");
    if (String(url).includes("airlines.csv")) return new Response("Code,Name,ICAO,IATA\nWZZ,Wizz Air,WZZ,W6\n");
    return new Response("", { status: 404 });
  };
  const { body } = await getAirportLive({ iata: "OTP", lat: 44.57, lon: 26.08 }, { store: memoryStore(), now, fetchImpl, airportByIcao: i => P[i] || null });
  assert.equal(body.status, "ok");
  assert.deepEqual(body.aircraft.map(a => a.callsign), ["WZZ1AB"]);
  assert.deepEqual(body.aircraft[0].airlineIata, ["W6"]);
  assert.equal(calls.filter(u => u.includes("adsb.lol")).length, 1);
});

test("route files: large airlines split into -0 … -9 are read and merged", async () => {
  const fetchImpl = async url => {
    const u = String(url);
    if (u.endsWith("/W/WZZ-all.csv")) return new Response("", { status: 404 });
    if (u.endsWith("/W/WZZ-1.csv")) return new Response("Callsign,Code,Number,AirlineCode,AirportCodes\nWZZ1AB,WZZ,1AB,WZZ,LROP-EGGW\n");
    if (u.endsWith("/W/WZZ-4.csv")) return new Response("Callsign,Code,Number,AirlineCode,AirportCodes\nWZZ4CD,WZZ,4CD,WZZ,LHBP-LIRF\n");
    return new Response("", { status: 404 });
  };
  const routes = await airlineRoutes("WZZ", memoryStore(), now, fetchImpl);
  assert.deepEqual(routes, { WZZ1AB: "LROP-EGGW", WZZ4CD: "LHBP-LIRF" });
});

test("approaching: airborne to this airport, nearest first, rough arrival estimate", async () => {
  const { approaching } = await import("../public/js/flights.js");
  const OTP = { iata: "OTP", lat: 44.5711, lon: 26.085 };
  const seenAt = new Date(now - 30000).toISOString();
  const list = approaching([
    { callsign: "FAR1", to: "OTP", onGround: false, lat: 46.0, lon: 26.0, groundSpeedKt: 450, seenAt },
    { callsign: "NEAR", to: "OTP", onGround: false, lat: 44.8, lon: 26.0, groundSpeedKt: 200, seenAt },
    { callsign: "GROUND", to: "OTP", onGround: true, lat: 44.57, lon: 26.08, seenAt },
    { callsign: "AWAY", to: "LHR", onGround: false, lat: 44.6, lon: 26.0, groundSpeedKt: 300, seenAt },
  ], OTP, now);
  assert.deepEqual(list.map(x => x.ac.callsign), ["NEAR", "FAR1"]);
  assert.ok(list[0].etaMin >= 3 && list[0].etaMin <= 6, String(list[0].etaMin));
});
