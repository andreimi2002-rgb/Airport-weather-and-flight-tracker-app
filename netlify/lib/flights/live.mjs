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
