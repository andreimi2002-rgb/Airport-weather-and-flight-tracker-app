// Helpers shared by the route, airline and flight pages: the airport list,
// the search window in the header, small HTML pieces in the dashboard style.
import { indexAirports } from "./airports.js";
import { mountSearch, loadAirlines } from "./search-ui.js";
import { loadLogos } from "./logos.js";
import { fetchWeather, iconFor, fmtTemp } from "./weather.js";

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const fmtNum = n => Number(n).toLocaleString("en-US");
export const NA = "Not available";
export const field = (label, value, mono) => `<div class="field"><small>${label}</small><strong class="${value == null || value === NA ? "na" : mono ? "mono" : ""}">${value == null ? NA : value}</strong></div>`;

let indexP = null, indexValue = null;
export const loadIndex = () => (indexP ??= fetch("/data/airports.json").then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(j => (indexValue = indexAirports(j))));

// Header search (same window as on the airport pages) + the lists it needs.
export function startPage() {
  mountSearch({ button: $("chooseBtn"), getIndex: () => indexValue });
  return Promise.all([loadIndex(), loadAirlines(), loadLogos()]).then(([index, airlines]) => ({ index, airlines }));
}

export function fail(title, text) {
  $("statusTitle").textContent = title;
  $("statusText").textContent = text;
  $("statusView").hidden = false;
  $("pageView").hidden = true;
}

// "+3h" between two time zones right now; null when either is unknown.
export function offsetMinutes(tz, d = new Date()) {
  if (!tz) return null;
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(d).find(p => p.type === "timeZoneName")?.value || "";
    const m = part.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return m[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  } catch { return null; }
}
export function timeDifference(fromTz, toTz, d = new Date()) {
  const a = offsetMinutes(fromTz, d), b = offsetMinutes(toTz, d);
  if (a === null || b === null) return null;
  const diff = b - a;
  if (!diff) return "Same time";
  const h = Math.floor(Math.abs(diff) / 60), m = Math.abs(diff) % 60;
  return `${diff > 0 ? "+" : "−"}${h}h${m ? " " + m + "m" : ""}`;
}
// "14:05" in the time zone (UTC when unknown), now or at `when`.
export const clock = (tz, when = new Date()) => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(when)); } catch { return "—"; } };

// Current weather at an airport, as one small card (free weather function).
export async function miniWeather(a) {
  try {
    const { data } = await fetchWeather(a.iata);
    const m = data.metar, fc0 = data.forecast?.status === "ok" ? data.forecast.hours?.[0] : null;
    const ok = m?.status === "ok";
    const t = ok ? m.tempC : fc0?.tempC, ic = ok ? iconFor(m.icon, fc0?.night) : fc0 ? iconFor(fc0.icon, fc0.night) : "";
    const line = ok ? [m.condition, m.wind && "Wind " + m.wind, m.visibility && "Vis " + m.visibility].filter(Boolean).join(" · ") : fc0 ? "Forecast: " + (fc0.label || "—") + " (no METAR)" : "No weather report";
    return `<div class="mini-wx"><div class="mi" aria-hidden="true">${ic}</div><div class="mt">${esc(fmtTemp(t))}</div><div class="md"><b>${esc(a.iata)} · ${esc(a.city || a.name)}</b><br>${esc(line)}${a.tz ? `<br>Local time ${esc(clock(a.tz))}` : ""}</div></div>`;
  } catch {
    return `<div class="note">Weather for ${esc(a.iata)} is unavailable right now.</div>`;
  }
}
