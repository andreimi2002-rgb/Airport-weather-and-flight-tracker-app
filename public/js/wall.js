// Wall board, /board/OTP: a clean one-screen departures + arrivals view to
// leave open on a monitor, tablet or phone. Reloads flights once an hour, not
// at night, and only while the page is visible (see wall-model.js).
import { indexAirports, findAirport, airportPath, airportLocation } from "./airports.js";
import { demoFlights } from "./demo-data.js";
import { fetchFlights, hhmm, here, other, statusView, updateTime, placeName, ago } from "./flights.js";
import { fetchWeather, iconFor, fmtTemp } from "./weather.js";
import { wallRows, shouldReload, isNight, pageOf, PAGE_MS } from "./wall-model.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hue = s => { let h = 0; for (const c of String(s || "?")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const alBadge = f => { const c = f.airline?.iata || f.airline?.icao || (f.number || "").split(" ")[0] || "✈"; return `<span class="al" style="--h:${hue(c)}" aria-hidden="true">${esc(c.slice(0, 3))}</span>`; };
const fmtClock = (tz, d = new Date(), opts = {}) => new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false, ...opts }).format(d);
const WEATHER_MS = 15 * 60 * 1000; // weather is free (our cached function)

let airport = null, state = { kind: "loading", flights: [] }, lastLoad = NaN, weather = null, page = 0, wake = null;

async function start() {
  const m = location.pathname.match(/^\/board\/([A-Za-z0-9]{3,4})\/?$/);
  let index;
  try { index = indexAirports(await (await fetch("/data/airports.json")).json()); }
  catch (err) { return fatal("Couldn't load the airport list (" + err.message + ")."); }
  airport = m ? findAirport(index, m[1]) : null;
  if (!airport) return fatal(`No airport with the code "${m ? m[1].toUpperCase() : ""}". Use an address like /board/OTP.`);
  document.title = `${airport.iata} board — Airport Live`;
  $("wCode").textContent = airport.iata;
  $("wName").textContent = airport.name;
  $("wSub").textContent = airportLocation(airport);
  $("wExit").href = airportPath(airport);
  tick();
  setInterval(tick, 1000);
  await Promise.all([loadFlights(), loadWeather()]);
  // Every minute: statuses that became overdue, the "updated" age, and the hourly reload check.
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (shouldReload(lastLoad, airport.tz)) loadFlights();
    render();
  }, 60 * 1000);
  setInterval(() => { if (document.visibilityState === "visible" && !isNight(airport.tz)) loadWeather(); }, WEATHER_MS);
  setInterval(() => { page++; render(); }, PAGE_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (shouldReload(lastLoad, airport.tz)) loadFlights();
    if (wake === "wanted" && !lock) keepAwake(true);
  });
}

function fatal(msg) {
  $("wName").textContent = "Board unavailable";
  $("wSub").textContent = msg;
  $("wDep").innerHTML = $("wArr").innerHTML = "";
}

function tick() {
  if (!airport) return;
  const d = new Date();
  $("wTime").textContent = fmtClock(airport.tz, d);
  $("wSec").textContent = ":" + String(d.getSeconds()).padStart(2, "0");
  $("wDate").textContent = new Intl.DateTimeFormat("en-GB", { timeZone: airport.tz || "UTC", weekday: "short", day: "numeric", month: "short" }).format(d) + (airport.tz ? " · local time" : " · UTC (time zone unknown)");
}

async function loadFlights() {
  lastLoad = Date.now(); // also on failure, so an error doesn't retry every minute
  let body;
  try { body = await fetchFlights(airport.iata); }
  catch (err) { state = { kind: "none", flights: [], message: "Couldn't load flights (" + err.message + ")." }; render(); return; }
  if (body.status === "unconfigured") {
    const demo = demoFlights[airport.iata];
    state = demo ? { kind: "demo", flights: demo } : { kind: "none", flights: [], message: "Flight data is not connected yet." };
  } else if (body.board) state = { kind: "live", flights: [...body.board.departures, ...body.board.arrivals], body };
  else state = { kind: "none", flights: [], message: body.notice || "Flight data is unavailable right now." };
  render();
}

async function loadWeather() {
  try { weather = (await fetchWeather(airport.iata)).data; } catch { /* keep the last one */ }
  renderWeather();
}

function renderWeather() {
  if (!weather) { $("wWx").innerHTML = ""; return; }
  const m = weather.metar, fc0 = weather.forecast?.status === "ok" ? weather.forecast.hours?.[0] : null;
  const ok = m?.status === "ok";
  const t = ok ? m.tempC : fc0?.tempC, ic = ok ? iconFor(m.icon, fc0?.night) : fc0 ? iconFor(fc0.icon, fc0.night) : "";
  const line = ok ? [m.condition, m.wind && "Wind " + m.wind].filter(Boolean).join(" · ") : fc0 ? (fc0.label || "Forecast") + " · forecast" : "No weather report";
  $("wWx").innerHTML = `<span class="wall-wx-ic" aria-hidden="true">${ic}</span><span class="wall-wx-t">${esc(fmtTemp(t))}</span><span class="wall-wx-l">${esc(line)}</span>`;
}

// How many rows fit in a column (wide screens page through the rest).
function perPage(box) {
  if (!matchMedia("(min-width: 900px)").matches) return Infinity;
  const row = box.querySelector(".wall-row")?.offsetHeight || 58;
  return Math.max(3, Math.floor(box.clientHeight / row));
}

function rowHtml(f, now) {
  const h = here(f), o = other(f), st = statusView(f, now), up = updateTime(f);
  const sched = hhmm(h.scheduled), changed = up.time !== "—" && up.time !== sched;
  const gate = f.direction === "arrival" ? (h.baggageBelt || "—") : (h.gate || "—");
  return `<div class="wall-row s-${st.cls || "ok"}" role="listitem">
    <div class="w-time">${changed ? `<s>${esc(sched)}</s><b>${esc(up.time)}</b>` : `<b>${esc(sched)}</b>`}</div>
    <div class="w-flight">${alBadge(f)}<div><b>${esc(f.number)}</b><span>${esc(f.airline?.name || "")}</span></div></div>
    <div class="w-place"><b>${esc(placeName(o.airport))}</b><span>${esc(o.airport.iata || "")}</span></div>
    <div class="w-gate">${esc(gate)}${h.terminal ? `<span>T${esc(h.terminal)}</span>` : ""}</div>
    <div class="w-st"><span class="status ${st.cls}">${esc(st.label)}</span></div>
  </div>`;
}

function renderSide(boxId, pageId, direction, now) {
  const box = $(boxId);
  if (state.kind === "loading") { box.innerHTML = `<div class="wall-empty">Loading flights…</div>`; $(pageId).textContent = ""; return; }
  if (state.kind === "none") { box.innerHTML = `<div class="wall-empty">${esc(state.message)}</div>`; $(pageId).textContent = ""; return; }
  const rows = wallRows(state.flights, direction, now);
  if (!rows.length) { box.innerHTML = `<div class="wall-empty">No ${direction === "departure" ? "departures" : "arrivals"} in the next hours.</div>`; $(pageId).textContent = ""; return; }
  // Render once to measure the row height, then show the page that fits.
  if (!box.querySelector(".wall-row")) box.innerHTML = rowHtml(rows[0], now);
  const n = perPage(box);
  const p = Number.isFinite(n) ? pageOf(rows, n, page) : { rows, page: 0, pages: 1 };
  box.innerHTML = p.rows.map(f => rowHtml(f, now)).join("");
  $(pageId).textContent = p.pages > 1 ? `Page ${p.page + 1} of ${p.pages} · ${rows.length} flights` : `${rows.length} flights`;
}

function render() {
  const now = Date.now();
  renderSide("wDep", "wDepPage", "departure", now);
  renderSide("wArr", "wArrPage", "arrival", now);
  const b = state.body;
  $("wUpdated").textContent = state.kind === "live" && b?.board?.fetchedAt
    ? `Updated ${fmtClock(airport.tz, new Date(b.board.fetchedAt))} · ${ago(b.board.fetchedAt)}${b.stale ? " · old data" : ""} · reloads hourly${isNight(airport.tz) ? " (paused at night)" : ""}`
    : state.kind === "demo" ? "DEMO DATA · sample flights, not live" : "";
  const notice = state.kind === "live" && b?.notice ? b.notice : "";
  $("wNotice").hidden = !notice;
  $("wNotice").textContent = notice;
  $("wFoot").innerHTML = state.kind === "demo"
    ? "Demo flights: sample values, not real data."
    : `Flights: <a href="https://aerodatabox.com/" target="_blank" rel="noopener">AeroDataBox</a> · Weather: aviationweather.gov, MET Norway (CC BY 4.0) · Times are local at ${esc(airport.iata)}`;
}

// ---------- full screen and keep-awake ----------
$("wFull").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};
if (!document.documentElement.requestFullscreen) $("wFull").hidden = true;
document.addEventListener("fullscreenchange", () => { $("wFull").textContent = document.fullscreenElement ? "⤡ Exit full screen" : "⤢ Full screen"; });

// The screen-on lock is off unless asked for. The browser drops it when the
// tab is hidden; it is taken again when the board is visible.
let lock = null;
async function keepAwake(on) {
  if (on) {
    try { lock = await navigator.wakeLock.request("screen"); wake = "wanted"; lock.addEventListener("release", () => { lock = null; }); }
    catch { wake = null; }
  } else { wake = null; await lock?.release().catch(() => {}); lock = null; }
  $("wWake").setAttribute("aria-pressed", String(wake === "wanted"));
  $("wWake").textContent = wake === "wanted" ? "☀ Screen stays on" : "☀ Keep screen on";
}
if ("wakeLock" in navigator) {
  $("wWake").hidden = false;
  $("wWake").onclick = () => keepAwake(wake !== "wanted");
}

let resizeT;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(render, 200); });

start();
