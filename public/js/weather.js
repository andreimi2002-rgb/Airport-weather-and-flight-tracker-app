// Weather on the page: fetches /api/weather/<IATA> (a Netlify Function that
// asks aviationweather.gov and MET Norway) and formats it for display.

export const STALE_METAR_MIN = 90; // a METAR older than this is flagged as old
export const REFRESH_MS = 10 * 60 * 1000;

const ICONS = { thunder: "⛈", snow: "🌨", rain: "🌧", fog: "🌫", overcast: "☁", cloudy: "☁", partly: "⛅", clear: "☀" };
const NIGHT = { clear: "☾", partly: "☁" };
export const iconFor = (key, night = false) => (night && NIGHT[key]) || ICONS[key] || "";

// Last good answer per airport, so a failed refresh can keep showing it.
const lastGood = new Map();

export async function fetchWeather(iata) {
  try {
    const res = await fetch("/api/weather/" + encodeURIComponent(iata));
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) throw new Error(body?.error || "HTTP " + res.status);
    const value = { data: body, receivedAt: Date.now() };
    lastGood.set(iata, value);
    return { ...value, stale: false };
  } catch (err) {
    const prev = lastGood.get(iata);
    if (prev) return { ...prev, stale: true, error: err.message };
    throw err;
  }
}

export function ageMinutes(isoTime, now = Date.now()) {
  const t = Date.parse(isoTime);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60000)) : null;
}

export function ageText(min) {
  if (min === null) return "";
  if (min < 1) return "just now";
  if (min < 60) return min + " min ago";
  const h = Math.floor(min / 60), m = min % 60;
  return h + " h" + (m ? " " + m + " min" : "") + " ago";
}

// "12:00 UTC" and, when the airport time zone is known, "15:00 local".
export function timeLabel(isoTime, tz) {
  const d = new Date(isoTime);
  if (isNaN(d)) return "";
  const fmt = zone => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return fmt("UTC") + " UTC" + (tz ? " · " + fmt(tz) + " local" : "");
}

// "19 Oct 12:00 UTC" for TAF times, which can span two days.
export function dayTimeUtc(isoTime) {
  const d = new Date(isoTime);
  if (isNaN(d)) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(",", "") + " UTC";
}

// The panel already labels the report, so "METAR KSEA ..." is shown as "KSEA ...".
export const stripType = raw => String(raw || "").replace(/^(METAR|SPECI|TAF)(\s+(AMD|COR))?\s+/, (m, type, x, mod) => (mod ? mod + " " : ""));

export function localHour(isoTime, tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(isoTime));
}

// One forecast slot every 3 hours, starting with the current hour.
export const forecastSlots = (hours, count = 6) => (hours || []).filter((_, i) => i % 3 === 0).slice(0, count);

export const fmtTemp = c => (c === null || c === undefined ? "—" : Math.round(c) + "°");

// Splits a TAF into its change groups: the base forecast, FM, BECMG, TEMPO, PROB.
export function tafGroups(raw) {
  const body = stripType(raw).replace(/\s+/g, " ").trim();
  const parts = body.split(/\s(?=FM\d{6}|BECMG\s|TEMPO\s|PROB\d{2}\s)/);
  const day = (d, h, m = "00") => `${h}:${m} on the ${Number(d)}${["th","st","nd","rd"][(Number(d) % 100 - 20) % 10] || ["th","st","nd","rd"][Number(d) % 100] || "th"}`;
  const hm = (h, m = "00") => `${h}:${m}`;
  return parts.map((p, i) => {
    let m;
    if (i === 0) return { kind: "base", label: "Base forecast", text: p };
    if ((m = /^FM(\d\d)(\d\d)(\d\d)\s(.*)$/.exec(p))) return { kind: "fm", label: `From ${day(m[1], m[2], m[3])} UTC`, text: m[4] };
    if ((m = /^(PROB\d\d)?\s?(TEMPO|BECMG)?\s?(\d\d)(\d\d)\/(\d\d)(\d\d)\s(.*)$/.exec(p))) {
      const what = m[2] === "BECMG" ? "Becoming" : m[2] === "TEMPO" ? "Temporarily" : "";
      const prob = m[1] ? m[1].slice(4) + "% chance" : "";
      return { kind: m[1] ? "prob" : m[2] === "TEMPO" ? "tempo" : "becmg", label: `${[prob, what].filter(Boolean).join(", ")} ${m[3] === m[5] ? `${hm(m[4])}–${day(m[5], m[6])}` : `${day(m[3], m[4])} – ${day(m[5], m[6])}`} UTC`.trim(), text: m[7] };
    }
    return { kind: "other", label: "", text: p };
  });
}

