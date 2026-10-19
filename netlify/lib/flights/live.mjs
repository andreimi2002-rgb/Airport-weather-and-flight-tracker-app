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
// be, keep those of the flight's airline, look up each one's route, and accept
// an aircraft only if it is the one aircraft flying exactly this route.
export const NEAR_RADIUS_NM = 250;   // adsb.lol maximum
export const NEAR_FRESH_MS = 2 * 60 * 1000;
export const ROUTE_FRESH_MS = 6 * 3600 * 1000;
const MAX_ROUTE_LOOKUPS = 6;

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
  const value = await load();
  await store.setJSON(key, { fetchedAt: new Date(now).toISOString(), value });
  return value;
}

// Route of a callsign from adsb.lol (standing data): { from, to, airline, plausible } or null.
export function normalizeRoute(json) {
  const pair = str(json?._airport_codes_iata);
  const m = pair && /^([A-Z0-9]{3})-([A-Z0-9]{3})$/.exec(pair); // multi-leg routes ("A-B-C") are not used
  return m ? { from: m[1], to: m[2], airline: str(json.airline_code), plausible: json.plausible !== false } : null;
}

// q: { airline: "WMT", from: "MXP", to: "OTP", lat, lon } (position where the flight should be now)
export async function identifyFlight(q, { store, now = Date.now(), fetchImpl = fetch, dailyCap = DEFAULT_ADSB_DAILY_CAP } = {}) {
  const lat = Math.round(q.lat * 2) / 2, lon = Math.round(q.lon * 2) / 2; // 0.5° grid: nearby lookups share one answer
  try {
    const near = await cachedAdsb(store, `near/${lat},${lon}`, NEAR_FRESH_MS, now, dailyCap, async () => {
      const j = await getJson(`https://api.adsb.lol/v2/point/${lat}/${lon}/${NEAR_RADIUS_NM}`, fetchImpl);
      return (Array.isArray(j?.ac) ? j.ac : []).filter(a => str(a.flight) && str(a.r)).map(a => ({ ...normalizeAdsb(a, now), lat: num(a.lat), lon: num(a.lon) }));
    });
    const mine = near.filter(a => a.callsign.toUpperCase().startsWith(q.airline)).slice(0, MAX_ROUTE_LOOKUPS);
    const matches = [];
    for (const a of mine) {
      // adsb.lol answers HTTP 500/404 when it doesn't know a callsign's route: that is "no route", not a failure.
      const route = await cachedAdsb(store, "route/" + a.callsign, ROUTE_FRESH_MS, now, dailyCap, async () => {
        try { return normalizeRoute(await getJson(`https://api.adsb.lol/api/0/route/${encodeURIComponent(a.callsign)}/${a.lat ?? lat}/${a.lon ?? lon}`, fetchImpl)); }
        catch (err) { if (err.status === 500 || err.status === 404) return null; throw err; }
      });
      if (route && route.plausible && route.from === q.from && route.to === q.to) matches.push({ ...a, route });
    }
    // Exactly one aircraft of this airline on exactly this route; anything else is not trusted.
    return { body: base("ok", { fetchedAt: new Date(now).toISOString(), aircraft: matches.length === 1 ? matches[0] : null, candidates: mine.length, matches: matches.length, source: ADSBLOL }), cacheSeconds: 120 };
  } catch (err) {
    return { body: base(err.quota ? "quota" : "error", { aircraft: null, notice: err.quota ? err.message : "adsb.lol " + err.message }), cacheSeconds: 60 };
  }
}
