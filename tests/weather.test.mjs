import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMetar, normalizeTaf, normalizeForecast, decodeWx, decodeWxString, describeSymbol, getWeather, clearMemoryCache, USER_AGENT } from "../netlify/lib/weather.mjs";
import handler, { findAirport, config } from "../netlify/functions/weather.mjs";
import { forecastSlots, ageText, ageMinutes, iconFor } from "../public/js/weather.js";

// Real aviationweather.gov records captured on 2026-10-19 (trimmed).
const LROP = { icaoId: "LROP", obsTime: 1792411200, temp: 19, dewp: 14, wdir: 250, wspd: 6, visib: "6+", altim: 1018, rawOb: "METAR LROP 191200Z 25006KT CAVOK 19/14 Q1018 NOSIG", name: "Bucharest/Coandă Intl, B, RO", cover: "CAVOK", clouds: [], fltCat: "VFR" };
const KSEA = { icaoId: "KSEA", obsTime: 1792410780, temp: 8.3, dewp: 6.1, wdir: 0, wspd: 0, visib: "10+", altim: 1014.3, rawOb: "METAR KSEA 191153Z 00000KT 10SM FEW065 BKN110 OVC150 08/06 A2995 RMK AO2 SLP147 T00830061 10106 20083 53004 $", name: "Seattle-Tacoma Intl, WA, US", cover: "OVC", clouds: [{ cover: "FEW", base: 6500 }, { cover: "BKN", base: 11000 }, { cover: "OVC", base: 15000 }], fltCat: "VFR" };
const EGLL_RAIN = { icaoId: "EGLL", obsTime: 1792411200, temp: 12, dewp: 9, wdir: 260, wspd: 9, wgst: 21, visib: 4.97, altim: 1015, rawOb: "METAR EGLL 191150Z 26009G21KT 8000 -SHRA BKN018 12/09 Q1015", wxString: "-SHRA", cover: "BKN", clouds: [{ cover: "BKN", base: 1800 }], fltCat: "MVFR" };
const TAF = { icaoId: "LROP", issueTime: "2026-10-19T11:00:00.000Z", validTimeFrom: 1792411200, validTimeTo: 1792497600, rawTAF: "TAF LROP 191100Z 1912/2012 25006KT CAVOK" };
const FORECAST = { properties: { meta: { updated_at: "2026-10-19T11:26:38Z" }, timeseries: Array.from({ length: 30 }, (_, i) => ({ time: new Date(Date.UTC(2026, 9, 19, 11 + i)).toISOString(), data: { instant: { details: { air_temperature: 17.8 - i * 0.1, wind_speed: 2.4, wind_from_direction: 247, cloud_area_fraction: 100 } }, next_1_hours: { summary: { symbol_code: i % 2 ? "cloudy" : "lightrain" }, details: { precipitation_amount: 0.2 } } } })) } };
const NOW = Date.UTC(2026, 9, 19, 12, 15);

test("METAR outside the US: CAVOK, metres, hPa", () => {
  const m = normalizeMetar(LROP);
  assert.equal(m.station, "LROP");
  assert.equal(m.observedAt, "2026-10-19T12:00:00.000Z");
  assert.equal(m.tempC, 19);
  assert.equal(m.wind, "WSW 6 kt");
  assert.equal(m.visibility, "10+ km");
  assert.equal(m.ceiling, "None (CAVOK)");
  assert.equal(m.condition, "No significant cloud (CAVOK)");
  assert.equal(m.pressure, "1018 hPa");
  assert.equal(m.icon, "clear");
  assert.match(m.summary, /Wind from 250° \(WSW\) at 6 kt\. Visibility 10 km or more\./);
});

test("METAR in the US: calm, statute miles, inHg, ceiling is lowest BKN/OVC", () => {
  const m = normalizeMetar(KSEA);
  assert.equal(m.wind, "Calm");
  assert.equal(m.visibility, "10+ mi");
  assert.equal(m.ceiling, "11,000 ft");
  assert.equal(m.pressure, "29.95 inHg (1014 hPa)");
  assert.match(m.summary, /Few clouds at 6,500 ft, broken at 11,000 ft, overcast at 15,000 ft\. Ceiling 11,000 ft\./);
});

test("METAR with weather, gusts and metre visibility", () => {
  const m = normalizeMetar(EGLL_RAIN);
  assert.equal(m.wind, "W 9 kt G21");
  assert.equal(m.visibility, "8 km");
  assert.equal(m.ceiling, "1,800 ft");
  assert.equal(m.condition, "Light rain showers");
  assert.equal(m.icon, "rain");
  assert.match(m.summary, /gusting 21 kt/);
});

test("missing METAR fields stay null, never invented", () => {
  const m = normalizeMetar({ icaoId: "XXXX", rawOb: "METAR XXXX 191200Z AUTO" });
  assert.equal(m.tempC, null);
  assert.equal(m.wind, null);
  assert.equal(m.visibility, null);
  assert.equal(m.ceiling, null);
  assert.equal(m.condition, null);
});

test("present weather decoding", () => {
  assert.equal(decodeWx("-SHRA"), "Light rain showers");
  assert.equal(decodeWx("+TSRA"), "Heavy thunderstorm with rain");
  assert.equal(decodeWx("FZFG"), "Freezing fog");
  assert.equal(decodeWx("VCSH"), "Showers in the vicinity");
  assert.equal(decodeWx("BCFG"), "Patches of fog");
  assert.equal(decodeWx("RASN"), "Rain and snow");
  assert.equal(decodeWx("XYZ"), "XYZ");
  assert.equal(decodeWxString("-RA BR"), "Light rain, Mist");
});

test("TAF and forecast normalization", () => {
  const t = normalizeTaf(TAF);
  assert.equal(t.validFrom, "2026-10-19T12:00:00.000Z");
  assert.equal(t.validTo, "2026-10-20T12:00:00.000Z");
  const f = normalizeForecast(FORECAST, NOW);
  assert.equal(f.hours.length, 24);
  assert.equal(f.hours[0].time, "2026-10-19T12:00:00.000Z"); // 11:00 dropped, 12:00 is current
  assert.equal(f.hours[0].label, "Cloudy");
  assert.deepEqual(describeSymbol("lightrainshowersandthunder_night"), { label: "Light rain showers and thunder", icon: "thunder", night: true });
  assert.deepEqual(describeSymbol("clearsky_day"), { label: "Clear sky", icon: "clear", night: false });
  assert.throws(() => normalizeForecast({}, NOW));
});

// Fake fetch: answers by URL, records calls.
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    for (const [part, answer] of Object.entries(routes)) {
      if (url.includes(part)) {
        if (answer instanceof Error) throw answer;
        return typeof answer === "function" ? answer() : answer;
      }
    }
    throw new Error("unexpected " + url);
  };
  f.calls = calls;
  return f;
}
const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const OTP = { iata: "OTP", icao: "LROP", name: "Henri Coandă International Airport", lat: 44.5711, lon: 26.085, elevationFt: 314 };

test("getWeather combines the three sources and identifies itself", async () => {
  clearMemoryCache();
  const f = fakeFetch({ "/metar": ok([LROP]), "/taf": ok([TAF]), "api.met.no": ok(FORECAST) });
  const w = await getWeather(OTP, { fetchImpl: f, now: NOW });
  assert.equal(w.metar.status, "ok");
  assert.equal(w.taf.status, "ok");
  assert.equal(w.forecast.status, "ok");
  assert.equal(f.calls.length, 3);
  for (const c of f.calls) assert.equal(c.opts.headers["User-Agent"], USER_AGENT);
  const met = f.calls.find(c => c.url.includes("api.met.no")).url;
  assert.match(met, /lat=44\.571&lon=26\.085&altitude=96$/);
  // Second call within the cache time does not hit the providers again.
  await getWeather(OTP, { fetchImpl: f, now: NOW + 60000 });
  assert.equal(f.calls.length, 3);
});

test("no station (HTTP 204) is reported as none, not as an error", async () => {
  clearMemoryCache();
  const f = fakeFetch({ "/metar": () => new Response(null, { status: 204 }), "/taf": () => new Response(null, { status: 204 }), "api.met.no": ok(FORECAST) });
  const w = await getWeather(OTP, { fetchImpl: f, now: NOW });
  assert.equal(w.metar.status, "none");
  assert.match(w.metar.reason, /No METAR report from LROP/);
  assert.equal(w.taf.status, "none");
  assert.equal(w.forecast.status, "ok");
});

test("airport without an ICAO code: no METAR lookup, forecast still works", async () => {
  clearMemoryCache();
  const f = fakeFetch({ "api.met.no": ok(FORECAST) });
  const w = await getWeather({ ...OTP, icao: null }, { fetchImpl: f, now: NOW });
  assert.equal(w.metar.status, "none");
  assert.equal(f.calls.length, 1);
});

test("provider errors and timeouts become error parts", async () => {
  clearMemoryCache();
  const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
  const f = fakeFetch({ "/metar": () => new Response("x", { status: 500 }), "/taf": timeout, "api.met.no": () => new Response("x", { status: 429 }) });
  const w = await getWeather(OTP, { fetchImpl: f, now: NOW });
  assert.deepEqual([w.metar.status, w.taf.status, w.forecast.status], ["error", "error", "error"]);
  assert.match(w.metar.message, /HTTP 500/);
  assert.match(w.taf.message, /did not answer in time/);
  assert.match(w.forecast.message, /HTTP 429/);
});

test("function: input checks, lookup and cache headers", async () => {
  assert.equal(config.path, "/api/weather/:code");
  assert.ok(config.rateLimit.windowLimit > 0);
  assert.equal(findAirport("OTP").icao, "LROP");
  let res = await handler(new Request("http://x/api/weather/x"), { params: { code: "x" } });
  assert.equal(res.status, 400);
  res = await handler(new Request("http://x/api/weather/QQQ"), { params: { code: "QQQ" } });
  assert.equal(res.status, 404);
  // All providers down -> 502, short CDN cache.
  clearMemoryCache();
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("down", { status: 503 });
  try {
    res = await handler(new Request("http://x/api/weather/OTP"), { params: { code: "OTP" } });
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("netlify-cdn-cache-control"), "public, s-maxage=60");
  } finally {
    globalThis.fetch = real;
    clearMemoryCache();
  }
});

test("page helpers", () => {
  assert.equal(forecastSlots(Array.from({ length: 24 }, (_, i) => i)).join(","), "0,3,6,9,12,15");
  assert.equal(ageText(0), "just now");
  assert.equal(ageText(14), "14 min ago");
  assert.equal(ageText(125), "2 h 5 min ago");
  assert.equal(ageMinutes("2026-10-19T12:00:00Z", NOW), 15);
  assert.equal(iconFor("clear", true), "☾");
  assert.equal(iconFor("rain"), "🌧");
});

test("raw reports drop the type word, TAF times carry the date", async () => {
  const { stripType, dayTimeUtc } = await import("../public/js/weather.js");
  assert.equal(stripType("METAR KSEA 191153Z 00000KT"), "KSEA 191153Z 00000KT");
  assert.equal(stripType("SPECI EGLL 191220Z"), "EGLL 191220Z");
  assert.equal(stripType("TAF AMD EGLL 191054Z"), "AMD EGLL 191054Z");
  assert.equal(stripType("KJFK 191151Z"), "KJFK 191151Z");
  assert.equal(dayTimeUtc("2026-10-20T18:00:00.000Z"), "20 Oct 18:00 UTC");
});

test("function: a partly failed answer is cached only briefly", async () => {
  clearMemoryCache();
  const real = globalThis.fetch;
  globalThis.fetch = async url => (String(url).includes("/metar") ? new Response("x", { status: 500 }) : String(url).includes("/taf") ? new Response(JSON.stringify([TAF]), { status: 200 }) : new Response(JSON.stringify(FORECAST), { status: 200 }));
  try {
    const res = await handler(new Request("http://x/api/weather/OTP"), { params: { code: "OTP" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("netlify-cdn-cache-control"), "public, s-maxage=60");
  } finally {
    globalThis.fetch = real;
    clearMemoryCache();
  }
});
