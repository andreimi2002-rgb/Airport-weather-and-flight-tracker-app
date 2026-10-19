// Weather for one airport: METAR + TAF from aviationweather.gov (NOAA) and a
// short forecast from MET Norway. Pure decoding helpers plus getWeather(),
// which the Netlify Function calls. Nothing here invents values: a field the
// provider does not report stays null and the page shows "Not reported".

export const USER_AGENT = "AirportLive/0.1 (+https://github.com/andreimi2002-rgb/Airport-weather-and-flight-tracker-app)";
const AWC = "https://aviationweather.gov/api/data";
const MET = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const TIMEOUT_MS = 8000;
const METAR_HOURS = 3; // look back this far for the latest report

export const SOURCES = [
  { name: "NOAA Aviation Weather Center", url: "https://aviationweather.gov/data/api/", licence: "US government data, public domain", used: "METAR and TAF" },
  { name: "MET Norway", url: "https://api.met.no/", licence: "CC BY 4.0", used: "Forecast" },
];

// ---------- small helpers ----------
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
const feet = n => n.toLocaleString("en-US") + " ft";
const iso = epochSeconds => (Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1000).toISOString() : null);
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Main body of a METAR: drops "METAR"/"SPECI", remarks and trend groups.
function bodyTokens(raw) {
  return String(raw || "").split(/\s+(?:RMK|TEMPO|BECMG|NOSIG)\b/)[0].split(/\s+/).filter(t => t && t !== "METAR" && t !== "SPECI");
}

// ---------- present weather (e.g. -SHRA, TSRA, FZFG, VCSH) ----------
const DESCRIPTOR = { MI: "shallow", PR: "partial", BC: "patches of", DR: "low drifting", BL: "blowing", SH: "showers", TS: "thunderstorm", FZ: "freezing" };
const PHENOMENON = { DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains", IC: "ice crystals", PL: "ice pellets", GR: "hail", GS: "small hail", UP: "unknown precipitation", BR: "mist", FG: "fog", FU: "smoke", VA: "volcanic ash", DU: "dust", SA: "sand", HZ: "haze", PY: "spray", PO: "dust whirls", SQ: "squalls", FC: "funnel cloud", SS: "sandstorm", DS: "duststorm" };
const WX_RE = /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/;

export function decodeWx(token) {
  const m = WX_RE.exec(token);
  if (!m || (!m[2] && !m[3])) return token;
  const [, intensity, desc, phen] = m;
  const what = (phen.match(/../g) || []).map(p => PHENOMENON[p]).join(" and ");
  let s;
  if (desc === "TS") s = "thunderstorm" + (what ? " with " + what : "");
  else if (desc === "SH") s = what ? what + " showers" : "showers";
  else if (desc) s = DESCRIPTOR[desc] + (what ? " " + what : "");
  else s = what;
  if (intensity === "-") s = "light " + s;
  if (intensity === "+") s = "heavy " + s;
  if (intensity === "VC") s += " in the vicinity";
  return s[0].toUpperCase() + s.slice(1);
}
export const decodeWxString = wx => String(wx || "").split(/\s+/).filter(Boolean).map(decodeWx).join(", ");

// ---------- METAR fields ----------
const COVER = { CAVOK: "No significant cloud (CAVOK)", CLR: "Clear skies", SKC: "Clear skies", NSC: "No significant cloud", NCD: "No cloud detected", FEW: "Few clouds", SCT: "Scattered clouds", BKN: "Broken clouds", OVC: "Overcast", OVX: "Sky obscured" };
const COVER_WORD = { FEW: "few clouds", SCT: "scattered", BKN: "broken", OVC: "overcast", OVX: "sky obscured" };

export function decodeWind(m) {
  const spd = num(m.wspd), gust = num(m.wgst);
  if (spd === null) return { text: null, sentence: null };
  if (spd === 0 && !gust) return { text: "Calm", sentence: "Calm wind." };
  const g = gust ? ` G${gust}` : "", gs = gust ? `, gusting ${gust} kt` : "";
  if (m.wdir === "VRB" || num(m.wdir) === null) return { text: `Variable ${spd} kt${g}`, sentence: `Variable wind at ${spd} kt${gs}.` };
  const dir = num(m.wdir);
  return { text: `${compass(dir)} ${spd} kt${g}`, sentence: `Wind from ${String(dir).padStart(3, "0")}° (${compass(dir)}) at ${spd} kt${gs}.` };
}

// Visibility as the station reported it: metres outside the US, statute miles in the US.
export function decodeVisibility(m) {
  const tokens = bodyTokens(m.rawOb);
  if (tokens.includes("CAVOK")) return "10+ km";
  const metres = tokens.slice(2).find(t => /^\d{4}(NDV)?$/.test(t));
  if (metres) {
    const v = parseInt(metres, 10);
    if (v >= 9999) return "10+ km";
    return v >= 5000 ? Math.round(v / 1000) + " km" : (v / 1000).toFixed(1).replace(/\.0$/, "") + " km";
  }
  if (m.visib == null || m.visib === "") return null;
  const sm = tokens.some(t => /SM$/.test(t));
  const plus = String(m.visib).endsWith("+");
  const n = parseFloat(m.visib);
  if (!Number.isFinite(n)) return null;
  if (sm) return `${n}${plus ? "+" : ""} mi`;
  const km = n * 1.609344;
  return `${km >= 5 ? Math.round(km) : km.toFixed(1)}${plus ? "+" : ""} km`;
}

// Ceiling = lowest broken, overcast or obscured layer, or vertical visibility.
export function decodeCeiling(m) {
  const clouds = Array.isArray(m.clouds) ? m.clouds : [];
  const layer = clouds.filter(c => ["BKN", "OVC", "OVX"].includes(c.cover) && num(c.base) !== null).sort((a, b) => a.base - b.base)[0];
  if (layer) return feet(layer.base);
  if (num(m.vertVis) !== null) return "Obscured, vert. vis. " + feet(m.vertVis);
  if (m.cover === "CAVOK") return "None (CAVOK)";
  if (!clouds.length && !m.cover) return null;
  return "None";
}

function cloudSentence(m) {
  if (m.cover === "CAVOK") return "No significant cloud (CAVOK).";
  const layers = (Array.isArray(m.clouds) ? m.clouds : []).filter(c => COVER_WORD[c.cover] && num(c.base) !== null);
  if (layers.length) {
    const parts = layers.map((c, i) => `${i === 0 ? COVER_WORD[c.cover][0].toUpperCase() + COVER_WORD[c.cover].slice(1) : COVER_WORD[c.cover]} at ${feet(c.base)}`);
    return parts.join(", ") + ".";
  }
  if (COVER[m.cover]) return COVER[m.cover] + ".";
  return null;
}

// Icon key the page turns into a symbol.
export function conditionKey(wx, cover) {
  const w = String(wx || "");
  if (/TS/.test(w)) return "thunder";
  if (/SN|SG|PL|IC|GR|GS/.test(w)) return "snow";
  if (/RA|DZ|SH|UP/.test(w)) return "rain";
  if (/FG|BR|HZ|FU|DU|SA|VA/.test(w)) return "fog";
  if (cover === "OVC" || cover === "OVX") return "overcast";
  if (cover === "BKN") return "cloudy";
  if (cover === "SCT" || cover === "FEW") return "partly";
  if (cover) return "clear";
  return null;
}

function pressure(m) {
  const hpa = num(m.altim);
  if (hpa === null) return null;
  const inhg = bodyTokens(m.rawOb).find(t => /^A\d{4}$/.test(t));
  return inhg ? `${(parseInt(inhg.slice(1), 10) / 100).toFixed(2)} inHg (${Math.round(hpa)} hPa)` : `${Math.round(hpa)} hPa`;
}

// Normalizes one aviationweather.gov METAR JSON record.
export function normalizeMetar(m) {
  const wind = decodeWind(m);
  const visibility = decodeVisibility(m);
  const ceiling = decodeCeiling(m);
  const wx = decodeWxString(m.wxString);
  const tempC = num(m.temp), dewpointC = num(m.dewp);
  const press = pressure(m);
  const condition = wx || COVER[m.cover] || null;
  const sentences = [
    wind.sentence,
    visibility && `Visibility ${visibility.replace(/^(\S+)\+ (\S+)$/, "$1 $2 or more")}.`,
    wx && wx + ".",
    cloudSentence(m),
    ceiling && /ft$/.test(ceiling) && `Ceiling ${ceiling}.`,
    tempC !== null && `Temperature ${tempC} °C${dewpointC !== null ? `, dew point ${dewpointC} °C` : ""}.`,
    press && `Pressure ${press}.`,
    m.fltCat && `Flight category ${m.fltCat}.`,
  ].filter(Boolean);
  return {
    status: "ok",
    station: m.icaoId || null,
    stationName: m.name || null,
    observedAt: iso(num(m.obsTime)) || m.reportTime || null,
    raw: m.rawOb || null,
    tempC, dewpointC,
    wind: wind.text,
    visibility,
    ceiling,
    condition,
    icon: conditionKey(m.wxString, m.cover),
    flightCategory: m.fltCat || null,
    pressure: press,
    summary: sentences.join(" "),
  };
}

export function normalizeTaf(t) {
  return {
    status: "ok",
    station: t.icaoId || null,
    raw: t.rawTAF || null,
    issuedAt: t.issueTime || null,
    validFrom: iso(num(t.validTimeFrom)),
    validTo: iso(num(t.validTimeTo)),
  };
}

// ---------- MET Norway ----------
const SYMBOL_BASE = { clearsky: "Clear sky", fair: "Fair", partlycloudy: "Partly cloudy", cloudy: "Cloudy", fog: "Fog" };

// "lightrainshowersandthunder_day" -> { label: "Light rain showers and thunder", icon: "thunder", night: false }
export function describeSymbol(code) {
  if (!code) return { label: null, icon: null, night: false };
  const [base, time] = String(code).split("_");
  const night = time === "night" || time === "polartwilight";
  if (SYMBOL_BASE[base]) {
    const icon = { clearsky: "clear", fair: "partly", partlycloudy: "partly", cloudy: "overcast", fog: "fog" }[base];
    return { label: SYMBOL_BASE[base], icon, night };
  }
  const m = /^(light|heavy)?(rain|sleet|snow)(showers)?(andthunder)?$/.exec(base);
  if (!m) return { label: base, icon: null, night };
  const label = [m[1], m[2], m[3]].filter(Boolean).join(" ") + (m[4] ? " and thunder" : "");
  const icon = m[4] ? "thunder" : m[2] === "rain" ? "rain" : "snow";
  return { label: label[0].toUpperCase() + label.slice(1), icon, night };
}

export function normalizeForecast(json, now = Date.now(), count = 24) {
  const series = json?.properties?.timeseries;
  if (!Array.isArray(series)) throw new Error("Unexpected forecast format");
  const hours = series
    .filter(s => Date.parse(s.time) >= now - 30 * 60 * 1000)
    .slice(0, count)
    .map(s => {
      const d = s.data?.instant?.details || {};
      const next = s.data?.next_1_hours || s.data?.next_6_hours;
      const sym = describeSymbol(next?.summary?.symbol_code);
      return {
        time: s.time,
        tempC: num(d.air_temperature),
        windMs: num(d.wind_speed),
        windDir: num(d.wind_from_direction),
        cloudPct: num(d.cloud_area_fraction),
        precipMm: num(s.data?.next_1_hours?.details?.precipitation_amount),
        symbol: next?.summary?.symbol_code || null,
        label: sym.label,
        icon: sym.icon,
        night: sym.night,
      };
    });
  return { status: "ok", updatedAt: json.properties.meta?.updated_at || null, hours };
}

// ---------- fetching with a small in-memory cache ----------
// Warm function instances reuse recent answers; the CDN cache in front of the
// function does most of the work. Errors are kept briefly to avoid hammering.
const memory = new Map();
export const clearMemoryCache = () => memory.clear();

async function cached(key, ttlMs, load, fetchImpl, now) {
  const hit = memory.get(key);
  if (hit && hit.expires > now) return hit.value;
  let value, ttl = ttlMs;
  try {
    const r = await load(fetchImpl);
    value = r.value;
    if (r.ttlMs) ttl = r.ttlMs;
  } catch (err) {
    value = { status: "error", message: err.name === "TimeoutError" ? "The weather service did not answer in time." : String(err.message || err) };
    ttl = 30 * 1000;
  }
  memory.set(key, { value, expires: now + ttl });
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  return value;
}

async function get(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res;
}

const loadMetar = icao => async f => {
  const res = await get(f, `${AWC}/metar?ids=${icao}&format=json&hours=${METAR_HOURS}`);
  if (res.status === 204) return { value: { status: "none", reason: `No METAR report from ${icao} in the last ${METAR_HOURS} hours. The airport may have no weather station, or it is not reporting.` } };
  if (!res.ok) throw new Error(`aviationweather.gov answered HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return { value: { status: "none", reason: `No METAR report from ${icao} in the last ${METAR_HOURS} hours.` } };
  const latest = list.reduce((a, b) => ((b.obsTime || 0) > (a.obsTime || 0) ? b : a));
  return { value: normalizeMetar(latest) };
};

const loadTaf = icao => async f => {
  const res = await get(f, `${AWC}/taf?ids=${icao}&format=json`);
  if (res.status === 204) return { value: { status: "none", reason: `No TAF is issued for ${icao}.` } };
  if (!res.ok) throw new Error(`aviationweather.gov answered HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return { value: { status: "none", reason: `No TAF is issued for ${icao}.` } };
  return { value: normalizeTaf(list[0]) };
};

const loadForecast = (lat, lon, altitudeM, now) => async f => {
  // MET Norway asks for at most 4 decimals; 3 (about 100 m) improves their cache hits.
  const q = `lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}` + (altitudeM !== null ? `&altitude=${altitudeM}` : "");
  const res = await get(f, `${MET}?${q}`);
  if (res.status !== 200 && res.status !== 203) throw new Error(`MET Norway answered HTTP ${res.status}`);
  const expires = Date.parse(res.headers.get("expires") || "");
  const ttlMs = Number.isFinite(expires) ? Math.min(Math.max(expires - now, 10 * 60 * 1000), 60 * 60 * 1000) : 30 * 60 * 1000;
  return { value: normalizeForecast(await res.json(), now), ttlMs };
};

// airport: { iata, icao, name, lat, lon, elevationFt }
export async function getWeather(airport, { fetchImpl = fetch, now = Date.now() } = {}) {
  const icao = airport.icao && /^[A-Z0-9]{4}$/.test(airport.icao) ? airport.icao : null;
  const noStation = { status: "none", reason: "This airport has no ICAO code, so there is no METAR station to look up." };
  const hasCoords = Number.isFinite(airport.lat) && Number.isFinite(airport.lon);
  const altitudeM = Number.isFinite(airport.elevationFt) ? Math.round(airport.elevationFt * 0.3048) : null;
  const [metar, taf, forecast] = await Promise.all([
    icao ? cached("metar:" + icao, 5 * 60 * 1000, loadMetar(icao), fetchImpl, now) : noStation,
    icao ? cached("taf:" + icao, 15 * 60 * 1000, loadTaf(icao), fetchImpl, now) : { status: "none", reason: "No TAF without an ICAO code." },
    hasCoords ? cached(`fc:${airport.lat.toFixed(3)},${airport.lon.toFixed(3)}`, 30 * 60 * 1000, loadForecast(airport.lat, airport.lon, altitudeM, now), fetchImpl, now) : { status: "none", reason: "No coordinates listed for this airport." },
  ]);
  return {
    version: 1,
    airport: { iata: airport.iata, icao, name: airport.name },
    fetchedAt: new Date(now).toISOString(),
    metar, taf, forecast,
    sources: SOURCES,
  };
}
