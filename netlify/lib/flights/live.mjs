// Two free sources for the actual aircraft (no AeroDataBox units):
// - Planespotters.net: a real photo of an aircraft by registration
//   (credit the photographer next to the photo and link to the photo page).
// - adsb.lol: live ADS-B data; finds which aircraft is flying a callsign right
//   now, which gives the registration when the flight board has none.
// Answers are stored in Netlify Blobs; adsb.lol calls have a daily cap.

export const UA = "AirportLive/0.1 (+https://github.com/andreimi2002-rgb/Airport-weather-and-flight-tracker-app)";
export const PHOTO_FRESH_MS = 7 * 24 * 3600 * 1000;
export const LIVE_FRESH_MS = 5 * 60 * 1000;
export const DEFAULT_ADSB_DAILY_CAP = 400; // adsb.lol currently allows about 500 a day per IP
const TIMEOUT_MS = 8000;

export const PLANESPOTTERS = { name: "Planespotters.net", url: "https://www.planespotters.net/" };
export const ADSBLOL = { name: "adsb.lol", url: "https://adsb.lol/", licence: "ODbL" };

const str = v => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const isCallsign = s => /^[A-Z0-9]{3,8}$/.test(s);

async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw Object.assign(new Error(err.name === "TimeoutError" ? "did not answer in time" : "could not be reached"), { status: null });
  }
  if (res.status === 429) throw Object.assign(new Error("is busy (too many requests)"), { status: 429 });
  if (!res.ok) throw Object.assign(new Error("answered HTTP " + res.status), { status: res.status });
  try { return await res.json(); } catch { throw Object.assign(new Error("sent an unreadable answer"), { status: res.status }); }
}

// Planespotters answer -> our photo shape (kind "planespotters": the actual aircraft).
export function normalizePlanespotters(json) {
  const p = Array.isArray(json?.photos) ? json.photos[0] : null;
  const src = str(p?.thumbnail_large?.src) || str(p?.thumbnail?.src);
  if (!p || !src || !/^https:\/\//.test(src)) return null;
  return {
    url: src,
    width: num(p.thumbnail_large?.size?.width) ?? num(p.thumbnail?.size?.width),
    height: num(p.thumbnail_large?.size?.height) ?? num(p.thumbnail?.size?.height),
    pageUrl: str(p.link),
    author: str(p.photographer),
    licence: null,
    source: PLANESPOTTERS.name,
    kind: "planespotters",
  };
}

// adsb.lol aircraft record -> what we show. alt_baro is a number (feet) or "ground".
export function normalizeAdsb(ac, now) {
  if (!ac) return null;
  const onGround = ac.alt_baro === "ground";
  const seen = num(ac.seen);
  return {
    registration: str(ac.r),
    typeCode: str(ac.t),
    hex: str(ac.hex),
    callsign: str(ac.flight),
    onGround,
    altitudeFt: onGround ? null : num(ac.alt_baro),
    groundSpeedKt: num(ac.gs) !== null ? Math.round(ac.gs) : null,
    verticalRateFpm: onGround ? null : (num(ac.baro_rate) ?? num(ac.geom_rate)),
    lat: num(ac.lat),
    lon: num(ac.lon),
    seenAt: new Date(now - (seen ?? 0) * 1000).toISOString(),
  };
}

const base = (status, extra) => ({ version: 1, status, notice: null, ...extra });

// Shared flow: fresh stored answer, else (optional daily cap) call, store.
async function stored({ store, key, freshMs, now, call, dailyKey, dailyCap }) {
  const saved = await store.get(key, { type: "json" });
  if (saved && now - Date.parse(saved.fetchedAt) < freshMs) return { body: base("ok", saved), cacheSeconds: Math.max(60, Math.min(3600, Math.round((freshMs - (now - Date.parse(saved.fetchedAt))) / 1000))) };
  let day = null;
  if (dailyKey) {
    day = (await store.get(dailyKey, { type: "json" })) || { calls: 0 };
    if (day.calls >= dailyCap) return { body: base("quota", { ...(saved ? { ...saved, stale: true } : {}), notice: "Live aircraft lookups are used up for today." }), cacheSeconds: 600 };
  }
  try {
    const value = await call();
    if (day) { day.calls += 1; await store.setJSON(dailyKey, day); }
    const out = { fetchedAt: new Date(now).toISOString(), ...value };
    await store.setJSON(key, out);
    return { body: base("ok", out), cacheSeconds: Math.min(3600, Math.round(freshMs / 1000)) };
  } catch (err) {
    if (day && err.status !== null) { day.calls += 1; await store.setJSON(dailyKey, day); }
    return { body: base("error", { ...(saved ? { ...saved, stale: true } : {}), notice: err.message }), cacheSeconds: 60 };
  }
}

// Body: { status, photo|null, fetchedAt }. "No photo" is stored too.
export function getAircraftPhoto(reg, { store, now = Date.now(), fetchImpl = fetch } = {}) {
  return stored({
    store, now, key: "photo/" + reg, freshMs: PHOTO_FRESH_MS,
    call: async () => {
      try { return { photo: normalizePlanespotters(await getJson(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`, fetchImpl)), source: PLANESPOTTERS }; }
      catch (err) { throw Object.assign(new Error("Planespotters.net " + err.message), { status: err.status }); }
    },
  });
}

// Body: { status, aircraft|null, fetchedAt }: the aircraft broadcasting this callsign now.
export function getLiveAircraft(callsign, { store, now = Date.now(), fetchImpl = fetch, dailyCap = DEFAULT_ADSB_DAILY_CAP } = {}) {
  return stored({
    store, now, key: "live/" + callsign, freshMs: LIVE_FRESH_MS,
    dailyKey: "adsb/" + new Date(now).toISOString().slice(0, 10), dailyCap,
    call: async () => {
      let json;
      try { json = await getJson(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(callsign)}`, fetchImpl); }
      catch (err) { throw Object.assign(new Error("adsb.lol " + err.message), { status: err.status }); }
      const list = Array.isArray(json?.ac) ? json.ac : [];
      // Exactly one aircraft with exactly this callsign; anything else is not trusted.
      const same = list.filter(a => str(a.flight)?.toUpperCase() === callsign);
      return { aircraft: same.length === 1 ? normalizeAdsb(same[0], now) : null, source: ADSBLOL };
    },
  });
}

// ---------- identify a flight by airline + route (callsigns are often alphanumeric) ----------
// Airlines fly most flights under callsigns like "WMT5CS" or "ROT276H", not
// "<ICAO><flight number>". So: list the aircraft near where the flight should
// be (adsb.lol, one call), keep those of the flight's airline on this route's
// line, and look up each callsign's route in the open VRS standing data
// (vradarserver/standing-data on GitHub, CC0, one small file per airline).
// Only the one aircraft flying exactly this route is accepted.
export const NEAR_RADIUS_NM = 250;   // adsb.lol maximum
export const NEAR_FRESH_MS = 2 * 60 * 1000;
export const ROUTES_FRESH_MS = 24 * 3600 * 1000;
export const AIRLINES_FRESH_MS = 7 * 24 * 3600 * 1000;
export const STANDING_DATA = "https://raw.githubusercontent.com/vradarserver/standing-data/main";
export const VRS = { name: "VRS standing data", url: "https://github.com/vradarserver/standing-data", licence: "CC0" };
const ADSB_GAP_MS = 300; // adsb.lol allows about 4 requests a second
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Counts one adsb.lol call against the daily cap; throws when used up.
async function spendAdsb(store, now, cap) {
  const key = "adsb/" + new Date(now).toISOString().slice(0, 10);
  const day = (await store.get(key, { type: "json" })) || { calls: 0 };
  if (day.calls >= cap) throw Object.assign(new Error("Live aircraft lookups are used up for today."), { quota: true });
  day.calls += 1;
  await store.setJSON(key, day);
}

async function cachedAdsb(store, key, freshMs, now, cap, load) {
  const saved = await store.get(key, { type: "json" });
  if (saved && now - Date.parse(saved.fetchedAt) < freshMs) return saved.value;
  await spendAdsb(store, now, cap);
  let value;
  // One retry after a "too many requests".
  try { value = await load(); }
  catch (err) { if (err.status !== 429) throw err; await sleep(1200); value = await load(); }
  await sleep(ADSB_GAP_MS);
  await store.setJSON(key, { fetchedAt: new Date(now).toISOString(), value });
  return value;
}

// Plain text from GitHub; null when the file doesn't exist (an airline with no routes).
async function getText(url, fetchImpl) {
  let res;
  try { res = await fetchImpl(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (err) { throw Object.assign(new Error(err.name === "TimeoutError" ? "did not answer in time" : "could not be reached"), { status: null }); }
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error("answered HTTP " + res.status), { status: res.status });
  return res.text();
}

// Stored files from the standing data, refreshed after freshMs; an older copy is used if GitHub fails.
async function cachedFile(store, key, freshMs, now, load) {
  const saved = await store.get(key, { type: "json" });
  if (saved && now - Date.parse(saved.fetchedAt) < freshMs) return saved.value;
  try {
    const value = await load();
    await store.setJSON(key, { fetchedAt: new Date(now).toISOString(), value });
    return value;
  } catch (err) {
    if (saved) return saved.value;
    throw Object.assign(new Error("Route data (GitHub) " + err.message), { status: err.status });
  }
}

const csvRows = text => String(text || "").replace(/^﻿/, "").split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(","));

// routes/schema-01/W/WMT-all.csv: Callsign,Code,Number,AirlineCode,AirportCodes ("LROP-LEVC")
// -> { WMT1LH: "LROP-LEVC" }. Routes with stops ("A-B-C") are left out.
export function parseRoutesCsv(text) {
  const out = {};
  for (const c of csvRows(text)) if (c[0] && /^[A-Z0-9]{3,4}-[A-Z0-9]{3,4}$/.test((c[4] || "").trim())) out[c[0].trim().toUpperCase()] = c[4].trim();
  return out;
}

// airlines/schema-01/airlines.csv: Code,Name,ICAO,IATA,... -> { W4: ["WMT"], H4: ["HYS", "IIN"] }
export function parseAirlinesCsv(text) {
  const out = {};
  for (const c of csvRows(text)) {
    const icao = (c[2] || "").trim().toUpperCase(), iata = (c[3] || "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(icao) && /^[A-Z0-9]{2}$/.test(iata)) {
      out[iata] ??= [];
      if (!out[iata].includes(icao)) out[iata].push(icao);
    }
  }
  return out;
}

// Large airlines (AFR, EZY, EJU, RYR, THY, VLG, WZZ) have no "-all" file:
// their routes are split into "-0.csv" … "-9.csv", read and merged here.
export const airlineRoutes = (icao, store, now, fetchImpl) =>
  cachedFile(store, "routes/" + icao, ROUTES_FRESH_MS, now, async () => {
    const dir = `${STANDING_DATA}/routes/schema-01/${icao[0]}/${icao}`;
    const all = await getText(`${dir}-all.csv`, fetchImpl);
    if (all !== null) return parseRoutesCsv(all);
    const parts = await Promise.all("0123456789".split("").map(d => getText(`${dir}-${d}.csv`, fetchImpl)));
    return Object.assign({}, ...parts.filter(t => t !== null).map(parseRoutesCsv));
  });

// The airline's ICAO codes: given (3 letters), or all ICAO codes that use this IATA code.
export async function airlineIcaos(code, store, now, fetchImpl) {
  if (/^[A-Z]{3}$/.test(code)) return [code];
  const map = await cachedFile(store, "airlines", AIRLINES_FRESH_MS, now, async () => parseAirlinesCsv(await getText(`${STANDING_DATA}/airlines/schema-01/airlines.csv`, fetchImpl)));
  return (map[code] || []).slice(0, 4);
}

// ---------- geometry: is an aircraft on the route between two airports? ----------
const R_NM = 3440.065;
const rad = x => (x * Math.PI) / 180;
export function distNm(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return Math.atan2(y, x);
}
// Sideways distance from the great circle A->B, and how far along it (nm; negative = behind A).
export function routeOffset(p, A, B) {
  const d13 = distNm(A, p) / R_NM, t = bearing(A, p) - bearing(A, B);
  const xt = Math.asin(Math.sin(d13) * Math.sin(t));
  const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xt)))) * Math.sign(Math.cos(t) || 1);
  return { crossNm: Math.abs(xt) * R_NM, alongNm: at * R_NM };
}
// On the route: within 60 nm of the line between the airports, or on/near one of them.
export function onRoute(p, A, B) {
  if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) return { ok: false, score: Infinity };
  if (distNm(p, A) <= 10 || distNm(p, B) <= 10) return { ok: true, score: 0 };
  const { crossNm, alongNm } = routeOffset(p, A, B);
  return { ok: crossNm <= 60 && alongNm >= -30 && alongNm <= distNm(A, B) + 30, score: crossNm };
}

// q: { airline: "WMT" (ICAO) or "W4" (IATA), number: "3185" | null, from: "MXP", to: "OTP", lat, lon, fromPos?, toPos? }
// (lat/lon: where the flight should be now; fromPos/toPos: the airports' coordinates)
// iataForIcao: "LROP" -> "OTP", to compare the standing data's ICAO airport codes with ours.
export async function identifyFlight(q, { store, now = Date.now(), fetchImpl = fetch, dailyCap = DEFAULT_ADSB_DAILY_CAP, iataForIcao = () => null } = {}) {
  const lat = Math.round(q.lat * 2) / 2, lon = Math.round(q.lon * 2) / 2; // 0.5° grid: nearby lookups share one answer
  try {
    const icaos = await airlineIcaos(q.airline, store, now, fetchImpl);
    if (!icaos.length) return { body: base("ok", { fetchedAt: new Date(now).toISOString(), aircraft: null, airlineUnknown: true, source: ADSBLOL }), cacheSeconds: 600 };
    const near = await cachedAdsb(store, `near/${lat},${lon}`, NEAR_FRESH_MS, now, dailyCap, async () => {
      const j = await getJson(`https://api.adsb.lol/v2/point/${lat}/${lon}/${NEAR_RADIUS_NM}`, fetchImpl);
      return (Array.isArray(j?.ac) ? j.ac : []).filter(a => str(a.flight) && str(a.r)).map(a => ({ ...normalizeAdsb(a, now), lat: num(a.lat), lon: num(a.lon) }));
    });
    const icaoOf = a => icaos.find(i => a.callsign.toUpperCase().startsWith(i));
    const airlineAll = near.filter(icaoOf);
    // An aircraft whose callsign is exactly the airline's ICAO code + our flight number (LO 646 -> LOT646).
    const exact = new Set(q.number ? icaos.map(i => i + q.number) : []);
    const d2 = a => ((a.lat ?? lat) - q.lat) ** 2 + ((a.lon ?? lon) - q.lon) ** 2;
    const hasLine = q.fromPos && q.toPos;
    const placed = airlineAll.map(a => ({ a, r: hasLine ? onRoute(a, q.fromPos, q.toPos) : { ok: true, score: d2(a) } }));
    const mine = placed.filter(x => x.r.ok || exact.has(x.a.callsign)).sort((x, y) => x.r.score - y.r.score).map(x => x.a);
    const routesBy = {};
    for (const i of new Set(mine.map(icaoOf))) routesBy[i] = await airlineRoutes(i, store, now, fetchImpl);
    const seen = [], matches = [];
    for (const a of mine) {
      const pair = routesBy[icaoOf(a)]?.[a.callsign.toUpperCase()] || null;
      const [f4, t4] = pair ? pair.split("-") : [];
      const route = pair ? { from: iataForIcao(f4) || f4, to: iataForIcao(t4) || t4 } : null;
      seen.push({ callsign: a.callsign, route: route ? route.from + "-" + route.to : null });
      if (route && route.from === q.from && route.to === q.to) matches.push({ ...a, route });
      // Callsign = our flight number and no known route saying otherwise: the same flight.
      else if (!route && exact.has(a.callsign)) matches.push({ ...a, route: { from: q.from, to: q.to, byNumber: true } });
    }
    // Exactly one aircraft on exactly this route; anything else is not trusted.
    return { body: base("ok", { fetchedAt: new Date(now).toISOString(), aircraft: matches.length === 1 ? matches[0] : null, airlines: icaos, nearby: near.length, airlineNearby: airlineAll.length, onRouteLine: placed.filter(x => x.r.ok).length, candidates: mine.length, checked: seen.slice(0, 6), matches: matches.length, source: ADSBLOL, routes: VRS }), cacheSeconds: 120 };
  } catch (err) {
    const msg = String(err.message || err);
    return { body: base(err.quota ? "quota" : "error", { aircraft: null, notice: err.quota || msg.startsWith("Route data") ? msg : "adsb.lol " + msg }), cacheSeconds: 60 };
  }
}

// ---------- one aircraft by registration (the aircraft page) ----------
export const REG_FRESH_MS = 2 * 60 * 1000;
export const ROUTE_NEAR_AIRPORT_NM = 10;

// Body: { status, aircraft|null, route|null, routeNote, fetchedAt }: where this
// aircraft is now (adsb.lol, by registration) and, when its callsign has a
// known route in the VRS standing data and the aircraft is on that route's
// line (or at one of its airports), that route. Otherwise no route: a
// callsign's usual route is not proof of today's flight.
// airportByIcao: ICAO -> { iata, lat, lon } | null (from our airport list).
export function getAircraftNow(reg, { store, now = Date.now(), fetchImpl = fetch, dailyCap = DEFAULT_ADSB_DAILY_CAP, airportByIcao = () => null } = {}) {
  return stored({
    store, now, key: "reg/" + reg, freshMs: REG_FRESH_MS,
    dailyKey: "adsb/" + new Date(now).toISOString().slice(0, 10), dailyCap,
    call: async () => {
      let json;
      try { json = await getJson(`https://api.adsb.lol/v2/reg/${encodeURIComponent(reg)}`, fetchImpl); }
      catch (err) { throw Object.assign(new Error("adsb.lol " + err.message), { status: err.status }); }
      const same = (Array.isArray(json?.ac) ? json.ac : []).filter(a => str(a.r)?.toUpperCase() === reg);
      const aircraft = same.length === 1 ? normalizeAdsb(same[0], now) : null;
      const { route, routeNote } = await routeOf(aircraft, { store, now, fetchImpl, airportByIcao });
      return { aircraft, route, routeNote, source: ADSBLOL };
    },
  });
}

async function routeOf(ac, { store, now, fetchImpl, airportByIcao }) {
  const cs = ac?.callsign?.toUpperCase();
  if (!cs) return { route: null, routeNote: ac ? "No callsign in the live data." : null };
  if (!/^[A-Z]{3}[A-Z0-9]{1,5}$/.test(cs)) return { route: null, routeNote: `${cs} is not an airline callsign.` };
  let routes;
  try { routes = await airlineRoutes(cs.slice(0, 3), store, now, fetchImpl); }
  catch (err) { return { route: null, routeNote: err.message }; }
  const r = routes?.[cs];
  if (!r) return { route: null, routeNote: `No known route for ${cs}.` };
  const [fromIcao, toIcao] = r.split("-");
  const A = airportByIcao(fromIcao), B = airportByIcao(toIcao);
  const route = { callsign: cs, fromIcao, toIcao, from: A?.iata || null, to: B?.iata || null, source: VRS };
  const p = { lat: ac.lat, lon: ac.lon };
  const posA = A && Number.isFinite(A.lat) ? A : null, posB = B && Number.isFinite(B.lat) ? B : null;
  if (!posA || !posB || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return { route: null, routeNote: `${cs} usually flies ${fromIcao}–${toIcao}, but it can't be checked against the aircraft's position.` };
  const atAirport = distNm(p, posA) <= ROUTE_NEAR_AIRPORT_NM || distNm(p, posB) <= ROUTE_NEAR_AIRPORT_NM;
  if (!atAirport && !onRoute(p, posA, posB).ok) return { route: null, routeNote: `${cs} usually flies ${route.from || fromIcao}–${route.to || toIcao}, but the aircraft is not on that line, so the route is not shown.` };
  return { route, routeNote: null };
}

// ---------- every flight near one airport (the board's live statuses) ----------
// One adsb.lol call for the area around the airport (stored a few minutes,
// shared by all visitors). An aircraft is kept when its callsign's VRS route
// starts or ends at this airport and it is on that route's line (or at one of
// its airports). The page then matches these aircraft to the board's flights.
export const AIRPORT_LIVE_FRESH_MS = 4 * 60 * 1000;
const ROUTE_FILES_AT_ONCE = 6;

const airlinesMap = (store, now, fetchImpl) =>
  cachedFile(store, "airlines", AIRLINES_FRESH_MS, now, async () => parseAirlinesCsv(await getText(`${STANDING_DATA}/airlines/schema-01/airlines.csv`, fetchImpl)));

// airport: { iata, lat, lon }. airportByIcao: ICAO -> { iata, lat, lon } | null.
// Body: { status, aircraft: [ { ...live, from, to, airlineIcao, airlineIata: [] } ], nearby, fetchedAt }
export function getAirportLive(airport, { store, now = Date.now(), fetchImpl = fetch, dailyCap = DEFAULT_ADSB_DAILY_CAP, airportByIcao = () => null } = {}) {
  return stored({
    store, now, key: "airport/" + airport.iata, freshMs: AIRPORT_LIVE_FRESH_MS,
    dailyKey: "adsb/" + new Date(now).toISOString().slice(0, 10), dailyCap,
    call: async () => {
      let json;
      try { json = await getJson(`https://api.adsb.lol/v2/point/${airport.lat.toFixed(3)}/${airport.lon.toFixed(3)}/${NEAR_RADIUS_NM}`, fetchImpl); }
      catch (err) { throw Object.assign(new Error("adsb.lol " + err.message), { status: err.status }); }
      const nearby = (Array.isArray(json?.ac) ? json.ac : []).map(a => normalizeAdsb(a, now)).filter(a => a.callsign && /^[A-Z]{3}[A-Z0-9]{1,5}$/.test(a.callsign.toUpperCase()));
      // Route files of the airlines seen (stored 1 day), a few at a time.
      const prefixes = [...new Set(nearby.map(a => a.callsign.toUpperCase().slice(0, 3)))];
      const routes = {};
      for (let i = 0; i < prefixes.length; i += ROUTE_FILES_AT_ONCE) {
        await Promise.all(prefixes.slice(i, i + ROUTE_FILES_AT_ONCE).map(async p => { routes[p] = await airlineRoutes(p, store, now, fetchImpl).catch(() => null); }));
      }
      const iataOf = {};
      try { for (const [iata, icaos] of Object.entries(await airlinesMap(store, now, fetchImpl))) for (const i of icaos) (iataOf[i] ??= []).push(iata); }
      catch { /* the airline's IATA code is only a help for matching */ }
      const out = [];
      for (const ac of nearby) {
        const cs = ac.callsign.toUpperCase(), prefix = cs.slice(0, 3);
        const r = routes[prefix]?.[cs];
        if (!r) continue;
        const [fromIcao, toIcao] = r.split("-");
        const A = airportByIcao(fromIcao), B = airportByIcao(toIcao);
        if (!A || !B || (A.iata !== airport.iata && B.iata !== airport.iata)) continue;
        const p = { lat: ac.lat, lon: ac.lon };
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !Number.isFinite(A.lat) || !Number.isFinite(B.lat)) continue;
        const atAirport = distNm(p, A) <= ROUTE_NEAR_AIRPORT_NM || distNm(p, B) <= ROUTE_NEAR_AIRPORT_NM;
        if (!atAirport && !onRoute(p, A, B).ok) continue;
        out.push({ ...ac, callsign: cs, from: A.iata, to: B.iata, airlineIcao: prefix, airlineIata: iataOf[prefix] || [] });
      }
      return { aircraft: out, nearby: nearby.length, source: [ADSBLOL, VRS] };
    },
  });
}
