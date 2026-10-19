import { indexAirports, findAirport, searchAirports, parseRoute, airportPath, airportLocation, TYPE_LABELS } from "./airports.js";
import { demoAircraftPhoto, demoFlights, demoAirportCodes } from "./demo-data.js";
import { DELAY_THRESHOLD_MIN, isDelayed, isCancelled, isDone, isOverdue } from "./flight-model.js";
import { fetchAircraftPhoto, fetchLive, fetchIdentify, flightDigits, callsignFor, typeConflicts, typeDiffers, liveFields, liveStatus, notFoundMessage, asRegistration, aircraftPath } from "./flights.js";
import { estimatedPosition } from "./insights.js";
import { fetchFlights, fetchAircraft, fetchFlightStatus, aircraftFields, hhmm, here, other, statusView, updateTime, placeName, fmtDuration, nextFlight, ago, REFRESH_MS as FLIGHTS_REFRESH_MS } from "./flights.js";
import { getPhotos, creditHtml } from "./photos.js";
import { fetchWeather, iconFor, ageMinutes, ageText, timeLabel, dayTimeUtc, stripType, localHour, forecastSlots, fmtTemp, tafGroups, STALE_METAR_MIN, REFRESH_MS } from "./weather.js";
import { punctuality, hourlyTraffic, topBy, airlineKey, routeKey, aircraftKey, lateMinutes, flightProgress, relative, haversineKm, milestones } from "./insights.js";
import { trafficSvg, forecastSvg } from "./charts.js";
import { loadLogos, airlineBadge } from "./logos.js";

const DEFAULT_AIRPORT = "SEA";
const NA = "Not available";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Saved airports and last viewed airport live in this browser only.
const store = {
  get(key, fallback) { try { const v = localStorage.getItem("airportLive." + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("airportLive." + key, JSON.stringify(value)); } catch { /* private mode: not saved */ } },
};

let index = null;      // airport list, once loaded
let current = null;    // selected airport object
let mode = "departures";
let flightState = { kind: "loading", flights: [] };
let weatherState = null; // last weather answer for the current airport
let pickerResults = [];
let pickerActive = -1;
let lastFocus = null;

// ---------- small helpers ----------
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}
function setText(values) { for (const [id, v] of Object.entries(values)) $(id).textContent = v ?? "—"; }
const favorites = () => store.get("favorites", []);
const isFavorite = a => favorites().includes(a.iata);
const fmtClock = (tz, d = new Date(), opts = {}) => new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false, ...opts }).format(d);
// Airline logo, or the coloured code badge (logos.js).
const alBadge = airlineBadge;
const fmtNum = n => n.toLocaleString("en-US");
// "+23m", "+1h 45m" for delay chips.
const fmtDelay = min => { const a = Math.abs(min); return (min > 0 ? "+" : "−") + (a < 120 ? a + "m" : Math.floor(a / 60) + "h " + (a % 60) + "m"); };
const lookup = code => (code && index ? index.byIata.get(code) : null);

// ---------- loading and status ----------
function showStatus(title, text, action) {
  $("airportView").hidden = true;
  $("statusView").hidden = false;
  $("statusTitle").textContent = title;
  $("statusText").textContent = text;
  const btn = $("statusAction");
  btn.hidden = !action;
  if (action) { btn.textContent = action.label; btn.onclick = action.run; }
}

async function loadAirports() {
  showStatus("Loading airports…", "Preparing the airport list.");
  try {
    const res = await fetch("/data/airports.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    index = indexAirports(await res.json());
  } catch (err) {
    console.error("Airport list failed to load", err);
    showStatus("Couldn't load the airport list", "Check your connection and try again. (" + err.message + ")", { label: "Try again", run: loadAirports });
    return;
  }
  route();
}

// ---------- routing: /airport/OTP (?flight=TS391-d opens a flight) ----------
function route() {
  if (!index) return;
  const r = parseRoute(location.pathname);
  if (r.invalid) return notFound(r.code);
  // The start page opens the home airport, else the last one viewed.
  const code = r.code || store.get("home", null) || store.get("last", DEFAULT_AIRPORT);
  const a = findAirport(index, code) || (!r.code && findAirport(index, DEFAULT_AIRPORT));
  if (!a) return notFound(code);
  if (location.pathname !== airportPath(a)) history.replaceState(null, "", airportPath(a) + location.search);
  if (current === a) { openFlightFromUrl(); return; }
  showAirport(a);
}

function notFound(code) {
  current = null;
  document.title = "Airport not found — Airport Live";
  showStatus("Airport not found", code ? `No airport with the code "${code}" is in the list. Use a 3-letter (IATA) or 4-letter (ICAO) code, or search by name.` : "This address doesn't match an airport.", { label: "⌕  Search airports", run: openPicker });
}

function goTo(a) {
  if (location.pathname !== airportPath(a) || location.search) history.pushState(null, "", airportPath(a));
  showAirport(a);
}

// ---------- airport view ----------
function showAirport(a) {
  current = a;
  store.set("last", a.iata);
  $("statusView").hidden = true;
  $("airportView").hidden = false;
  document.title = `${a.iata} · ${a.name} — Airport Live`;
  $("flightSearch").value = "";
  $("statusFilter").value = "all";
  closeDrawer("flightModal"); closeDrawer("weatherModal");

  const kind = [TYPE_LABELS[a.type], a.scheduled ? "Scheduled flights" : "No scheduled flights listed"].join(" · ");
  setText({ airportKind: kind, airportCode: a.iata, airportName: a.name, airportLocation: airportLocation(a), cityPhotoTitle: a.city || "City not listed" });
  const offset = a.tz ? new Intl.DateTimeFormat("en-GB", { timeZone: a.tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value : null;
  const chips = [
    ["ICAO", a.icao], ["Time zone", a.tz ? `${a.tz.split("/").pop().replace(/_/g, " ")} ${offset || ""}` : null],
    ["Elevation", Number.isFinite(a.elevationFt) ? fmtNum(a.elevationFt) + " ft" : null], ["Runways", a.runways ?? null],
    ["Position", Number.isFinite(a.lat) ? `${Math.abs(a.lat).toFixed(2)}°${a.lat >= 0 ? "N" : "S"} ${Math.abs(a.lon).toFixed(2)}°${a.lon >= 0 ? "E" : "W"}` : null],
  ];
  $("airportChips").innerHTML = chips.map(([k, v]) => `<div class="chip"><small>${k}</small><strong class="${v == null ? "unknown" : ""}">${esc(v ?? "Not listed")}</strong></div>`).join("");
  updateFavorite();
  renderQuick();
  $("wallLink").href = "/board/" + a.iata;
  renderPhotos(a);
  renderWeather(a);
  updateClock();
  loadFlights(a);
}

// ---------- quick switch (saved airports) ----------
function renderQuick() {
  if (!index) return;
  const saved = favorites().map(c => index.byIata.get(c)).filter(Boolean);
  const list = saved.length ? saved : demoAirportCodes.map(c => index.byIata.get(c)).filter(Boolean);
  const homeAp = index.byIata.get(store.get("home", null));
  if (homeAp && !list.includes(homeAp)) list.unshift(homeAp);
  if (current && !list.includes(current)) list.unshift(current);
  $("quickNav").innerHTML = list.map(a => `<a class="qchip${a === current ? " active" : ""}" href="${airportPath(a)}" data-code="${a.iata}" title="${esc(a.name)}${a === homeAp ? " (home)" : ""}">${a === homeAp ? '<span aria-label="home">⌂</span>' : ""}${isFavorite(a) ? '<span style="color:var(--amber)">★</span>' : ""}<b>${a.iata}</b><span class="qt">${a.tz ? fmtClock(a.tz) : ""}</span></a>`).join("");
}
$("quickNav").addEventListener("click", e => {
  const a = e.target.closest("[data-code]");
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const ap = index.byIata.get(a.dataset.code);
  if (ap && ap !== current) goTo(ap);
});

// ---------- photos ----------
function setHeroPhoto(photo, a) {
  const card = $("airportPhotoCard"), img = $("airportPhoto"), cap = $("airportPhotoCaption");
  card.dataset.code = a.iata;
  card.classList.remove("has-photo");
  img.onload = () => card.classList.add("has-photo");
  img.onerror = () => { card.classList.remove("has-photo"); cap.textContent = ""; };
  if (photo) { img.src = photo.src; img.alt = "Photo of " + a.name; cap.innerHTML = creditHtml(photo, esc); }
  else { img.removeAttribute("src"); img.alt = ""; cap.textContent = ""; }
}
function setCityPhoto(photo, alt, code, note) {
  const card = $("cityPhotoCard"), img = $("cityPhoto"), caption = $("cityPhotoCaption");
  card.dataset.code = code;
  card.classList.toggle("no-photo", !photo);
  img.onload = () => card.classList.remove("no-photo");
  img.onerror = () => { card.classList.add("no-photo"); caption.textContent = "Photo couldn't be loaded"; };
  if (photo) { img.src = photo.src; img.alt = alt; caption.innerHTML = creditHtml(photo, esc); }
  else { img.removeAttribute("src"); img.alt = ""; caption.textContent = note; }
}
async function renderPhotos(a) {
  setHeroPhoto(null, a);
  setCityPhoto(null, "", a.iata, "Loading photo…");
  let p;
  try { p = await getPhotos(a.iata); }
  catch (err) {
    console.error("Photo list failed to load", err);
    if (current === a) setCityPhoto(null, "", a.iata, "Photo list couldn't be loaded");
    return;
  }
  if (current !== a) return;
  const cityName = p.city?.name || a.city;
  $("cityPhotoTitle").textContent = cityName || "City not listed";
  // Wikidata sometimes lists a county, province or metro area as the place served: say "area", not "city".
  $("cityKind").textContent = /\b(county|district|province|prefecture|governorate|department|oblast|region|regency|metropolitan|metroplex|area)\b/i.test(cityName || "") ? "THE AREA" : "THE CITY";
  setHeroPhoto(p.airport, a);
  // No airport photo: the city photo is still shown in its own card.
  setCityPhoto(p.city?.photo, "Photo of " + cityName, a.iata, cityName ? "No freely licensed photo found" : "");
}

// ---------- weather ----------
async function renderWeather(a, quiet = false) {
  if (!quiet) {
    weatherState = null;
    setText({ temperature: "—", condition: "Loading weather…", weatherIcon: "", wind: "—", visibility: "—", ceiling: "—", pressure: "—", metar: "Loading…", taf: "Loading…", tafMeta: "", weatherSub: "Conditions at the airport", weatherSource: "" });
    $("condition").classList.remove("warn");
    $("flightCat").hidden = true;
    $("forecastRow").innerHTML = "";
  }
  let res;
  try { res = await fetchWeather(a.iata); }
  catch (err) {
    console.error("Weather failed to load", err);
    if (current !== a) return;
    setText({ temperature: "—", condition: "Weather unavailable right now", weatherIcon: "", wind: "—", visibility: "—", ceiling: "—", pressure: "—", metar: "Couldn't load the weather.", taf: "—", tafMeta: "" });
    $("condition").classList.add("warn");
    $("weatherSource").textContent = "Try the refresh button in a minute.";
    $("forecastRow").innerHTML = `<div class="forecast-empty">Forecast unavailable</div>`;
    return;
  }
  if (current !== a) return;
  weatherState = res;
  const { metar: m, taf: t, forecast: fc } = res.data;
  const hours = fc.status === "ok" ? fc.hours : [];
  const nowFc = hours[0];

  let condition, warn = false;
  if (m.status === "ok") {
    const age = ageMinutes(m.observedAt);
    condition = m.condition || "Observed";
    if (age !== null && age > STALE_METAR_MIN) { condition += ` · report is ${ageText(age).replace(" ago", "")} old`; warn = true; }
    setText({ temperature: fmtTemp(m.tempC), weatherIcon: iconFor(m.icon, nowFc?.night), wind: m.wind || "Not reported", visibility: m.visibility || "Not reported", ceiling: m.ceiling || "Not reported", pressure: m.pressure ? m.pressure.replace(/ \(.*\)/, "") : "Not reported" });
    const cat = $("flightCat");
    cat.hidden = !m.flightCategory;
    cat.textContent = m.flightCategory || "";
    cat.className = "wc-cat cat-" + (m.flightCategory || "");
    cat.title = "Flight category from the METAR";
  } else {
    const why = m.status === "none" ? "no METAR station reporting" : "METAR unavailable right now";
    condition = nowFc ? `Forecast: ${nowFc.label || "—"} · ${why}` : why[0].toUpperCase() + why.slice(1);
    warn = m.status === "error";
    setText({ temperature: nowFc ? fmtTemp(nowFc.tempC) : "—", weatherIcon: nowFc ? iconFor(nowFc.icon, nowFc.night) : "", wind: "No report", visibility: "No report", ceiling: "No report", pressure: "No report" });
    $("flightCat").hidden = true;
  }
  $("condition").textContent = condition;
  $("condition").classList.toggle("warn", warn);

  if (m.status === "ok") setText({ metar: stripType(m.raw), weatherSub: [m.station, m.stationName, "observed " + timeLabel(m.observedAt, a.tz), ageText(ageMinutes(m.observedAt))].filter(Boolean).join(" · ") });
  else setText({ metar: m.status === "none" ? "No METAR station at this airport." : "Couldn't load the METAR.", weatherSub: m.reason || m.message || "Conditions at the airport" });
  if (t.status === "ok") setText({ taf: stripType(t.raw), tafMeta: `Issued ${dayTimeUtc(t.issuedAt)} · valid ${dayTimeUtc(t.validFrom)} to ${dayTimeUtc(t.validTo)}` });
  else setText({ taf: t.status === "none" ? t.reason : "Couldn't load the TAF.", tafMeta: t.status === "error" ? t.message : "" });

  $("forecastHead").textContent = "NEXT 24 HOURS · FORECAST" + (a.tz ? "" : " · UTC");
  $("forecastRow").innerHTML = hours.length
    ? forecastSlots(hours, 8).map(h => `<div class="forecast-slot" title="${esc(h.label || "")}"><small>${esc(localHour(h.time, a.tz))}</small><span aria-hidden="true">${iconFor(h.icon, h.night)}</span><strong>${esc(fmtTemp(h.tempC))}</strong></div>`).join("")
    : `<div class="forecast-empty">${esc(fc.status === "error" ? "Forecast unavailable right now" : fc.reason || "No forecast")}</div>`;

  const updated = fmtClock(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date(res.receivedAt));
  $("weatherSource").innerHTML = `METAR/TAF: <a href="https://aviationweather.gov" target="_blank" rel="noopener">NOAA Aviation Weather Center</a> · Forecast: <a href="https://api.met.no/" target="_blank" rel="noopener">MET Norway</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> · Last updated ${updated} (your time)`
    + (res.stale ? `<br><span class="warn">Couldn't refresh (${esc(res.error)}). Showing data received at ${updated}.</span>` : "");
  if ($("weatherModal").classList.contains("open")) renderWeatherDrawer();
}

// ---------- clock ----------
function updateClock() {
  if (!current) return;
  const n = new Date();
  $("utcTime").textContent = fmtClock("UTC", n) + " UTC";
  if (!current.tz) { $("localTime").innerHTML = `<span class="unknown">Time zone not available</span>`; $("localSec").textContent = ""; $("localDate").textContent = ""; return; }
  $("localTime").textContent = fmtClock(current.tz, n);
  $("localSec").textContent = new Intl.DateTimeFormat("en-GB", { timeZone: current.tz, second: "2-digit" }).format(n).padStart(2, "0");
  $("localDate").textContent = new Intl.DateTimeFormat("en-US", { timeZone: current.tz, weekday: "long", month: "long", day: "numeric" }).format(n);
}

// ---------- flights ----------
// kind: "loading" | "live" (provider data, maybe stale) | "demo" | "none"
async function loadFlights(a, quiet = false) {
  if (!quiet) { flightState = { kind: "loading", flights: [] }; renderAll(); }
  let body;
  try { body = await fetchFlights(a.iata); }
  catch (err) {
    console.error("Flights failed to load", err);
    if (current !== a) return;
    flightState = { kind: "none", flights: [], message: "Couldn't load flights (" + err.message + "). Try the refresh button in a minute." };
    renderAll();
    return;
  }
  if (current !== a) return;
  if (body.status === "unconfigured") {
    const demo = demoFlights[a.iata];
    flightState = demo ? { kind: "demo", flights: demo } : { kind: "none", flights: [], message: "Flight data is not connected yet. Demo flights exist only for SEA." };
  } else if (body.board) {
    flightState = { kind: "live", flights: [...body.board.departures, ...body.board.arrivals], body };
  } else {
    flightState = { kind: "none", flights: [], message: body.notice || "Flight data is unavailable right now." };
  }
  renderAll();
  openFlightFromUrl();
}

function renderAll() { renderOverview(); renderTraffic(); renderFlights(); renderSide(); }

// "15:04" in the airport's time zone (or UTC when unknown).
const airportClock = iso => fmtClock(current?.tz, new Date(iso)) + (current?.tz ? "" : " UTC");

function kpi({ label, icon, value, unit = "", foot, cls = "", meter }) {
  return `<div class="kpi ${cls}"><div class="kpi-label">${label}<span aria-hidden="true">${icon}</span></div><div class="kpi-number">${value}${unit ? `<small>${unit}</small>` : ""}</div>${meter || ""}<div class="kpi-foot">${foot}</div></div>`;
}
const meter = parts => `<div class="kpi-meter">${parts.map(([v, c]) => `<i style="width:${Math.max(0, v)}%;background:${c}"></i>`).join("")}</div>`;

function renderOverview() {
  const { kind, flights, body } = flightState;
  const tiles = ["Departures|↗", "Arrivals|↙", "On time|◷", "Average delay|⧗", "Cancellations|⊘"];
  if (kind === "loading" || kind === "none") {
    const t = kind === "loading" ? "Loading…" : "No flight data";
    $("kpis").innerHTML = tiles.map(s => { const [label, icon] = s.split("|"); return kpi({ label, icon, value: "—", foot: t }); }).join("");
    $("overviewNote").textContent = kind === "loading" ? "Loading flights…" : flightState.message;
    $("updatedAt").textContent = kind === "loading" ? "" : "NO FLIGHT DATA";
    $("tabDep").textContent = $("tabArr").textContent = "";
    return;
  }
  const dep = flights.filter(f => f.direction === "departure"), arr = flights.filter(f => f.direction === "arrival");
  const pd = punctuality(dep), pa = punctuality(arr), all = punctuality(flights);
  const scope = kind === "demo" ? "demo list" : "on the board";
  const onCls = all.onTimePct === null ? "" : all.onTimePct >= 80 ? "good" : all.onTimePct >= 60 ? "warn" : "bad";
  const avgCls = all.avgDelayMin === null ? "" : all.avgDelayMin < DELAY_THRESHOLD_MIN ? "good" : all.avgDelayMin < 45 ? "warn" : "bad";
  $("tabDep").textContent = dep.length; $("tabArr").textContent = arr.length;
  $("kpis").innerHTML = [
    kpi({ label: "Departures", icon: "↗", value: pd.total, foot: `<span class="good">${pd.total - pd.delayed - pd.cancelled - pd.diverted} on time</span> · ${pd.delayed} delayed · ${scope}`, meter: pd.total ? meter([[(pd.total - pd.delayed - pd.cancelled) / pd.total * 100, "var(--accent)"], [pd.delayed / pd.total * 100, "var(--amber)"], [pd.cancelled / pd.total * 100, "var(--red)"]]) : "" }),
    kpi({ label: "Arrivals", icon: "↙", value: pa.total, foot: `<span class="good">${pa.total - pa.delayed - pa.cancelled - pa.diverted} on time</span> · ${pa.delayed} delayed · ${scope}`, meter: pa.total ? meter([[(pa.total - pa.delayed - pa.cancelled) / pa.total * 100, "var(--blue)"], [pa.delayed / pa.total * 100, "var(--amber)"], [pa.cancelled / pa.total * 100, "var(--red)"]]) : "" }),
    kpi({ label: "On time", icon: "◷", value: all.onTimePct ?? "—", unit: all.onTimePct === null ? "" : "%", cls: onCls, foot: `Less than ${DELAY_THRESHOLD_MIN} min late, cancellations excluded` }),
    kpi({ label: "Average delay", icon: "⧗", value: all.avgDelayMin ?? "—", unit: all.avgDelayMin === null ? "" : "min", cls: avgCls, foot: all.avgDelayMin === null ? "No late flights with reported times" : `Of late flights · longest ${all.maxDelayMin} min` }),
    kpi({ label: "Cancellations", icon: "⊘", value: all.cancelled, cls: all.cancelled ? "bad" : "", foot: all.diverted ? `${all.diverted} diverted · includes "may be cancelled"` : `Includes "may be cancelled"` }),
  ].join("");
  if (kind === "demo") {
    $("overviewNote").textContent = "A quick snapshot from the demo flight list.";
    $("updatedAt").textContent = "DEMO DATA · NOT LIVE";
  } else {
    const b = body.board;
    $("overviewNote").textContent = `Passenger flights from ${airportClock(b.from)} to ${airportClock(b.to)} airport time.` + (b.live ? "" : " Schedule only: no live updates for this airport.");
    updateFlightAge();
  }
}

function updateFlightAge() {
  const { kind, body } = flightState;
  if (kind !== "live") return;
  $("updatedAt").textContent = `UPDATED ${airportClock(body.board.fetchedAt)} · ${ago(body.board.fetchedAt).toUpperCase()}` + (body.stale ? " · OLD DATA" : "");
}

// ---------- traffic chart ----------
let trafficBuckets = [];
function renderTraffic() {
  const { kind, flights, body } = flightState;
  const box = $("trafficChart");
  if (kind !== "live") {
    trafficBuckets = [];
    box.innerHTML = `<div class="empty-chart">${kind === "loading" ? "Loading…" : kind === "demo" ? "The traffic chart needs live flight times (demo flights have none)." : "No flight data."}</div>`;
    return;
  }
  trafficBuckets = hourlyTraffic(flights, body.board.from, body.board.to);
  const total = flights.length;
  $("trafficSub").textContent = `${total} scheduled movements, ${airportClock(body.board.from)}–${airportClock(body.board.to)} airport time. Bars above the line are departures, below are arrivals.`;
  const w = Math.max(320, Math.round(box.clientWidth || 1000));
  box.innerHTML = trafficSvg(trafficBuckets, { tz: current.tz, width: w, height: w > 700 ? 210 : 190 }) + `<div class="tt" id="trafficTip"></div>`;
}
$("trafficChart").addEventListener("pointermove", e => {
  const g = e.target.closest("[data-i]"), tip = $("trafficTip");
  if (!tip) return;
  if (!g) { tip.style.opacity = 0; return; }
  const b = trafficBuckets[Number(g.dataset.i)];
  const box = $("trafficChart").getBoundingClientRect(), r = g.getBoundingClientRect();
  const h1 = fmtClock(current.tz, new Date(b.start)), h2 = fmtClock(current.tz, new Date(b.start + 3600000));
  tip.innerHTML = `<b>${h1}–${h2}</b><br>↗ ${b.dep} departures${b.depLate ? ` · <span class="warn">${b.depLate} late</span>` : ""}<br>↙ ${b.arr} arrivals${b.arrLate ? ` · <span class="warn">${b.arrLate} late</span>` : ""}${b.cancelled ? `<br><span style="color:var(--red)">${b.cancelled} cancelled</span>` : ""}`;
  tip.style.left = (r.left + r.width / 2 - box.left) + "px";
  tip.style.top = (e.clientY - box.top) + "px";
  tip.style.opacity = 1;
});
$("trafficChart").addEventListener("pointerleave", () => { const t = $("trafficTip"); if (t) t.style.opacity = 0; });

// ---------- board ----------
const sortKey = f => here(f).scheduled?.utc || here(f).scheduled?.local || "";
const isPast = (f, now = Date.now()) => {
  if (isDone(f)) return true;
  if (f.demo) return false;
  if (isCancelled(f) || isOverdue(f, now)) { const t = Date.parse((here(f).revised || here(f).scheduled)?.utc); return Number.isFinite(t) && t < now; }
  return false;
};

// Live statuses found by the flight drawer, by flight id. Kept across board
// refreshes; statusView ignores them once they are older than LIVE_FRESH_MS.
const liveSeen = new Map();
const stOf = (f, now) => statusView(f, now, liveSeen.get(f.id));

function rowHtml(f, now) {
  const o = other(f), h = here(f), st = stOf(f, now), up = updateTime(f);
  const late = lateMinutes(f);
  const sched = hhmm(h.scheduled);
  const changed = up.time !== "—" && up.time !== sched;
  const timeCell = changed
    ? `<span class="t1 struck">${esc(sched)}</span><span class="t2${late !== null && late < 0 ? " early" : ""}">${esc(up.time)}</span><small>${esc(up.note)}</small>`
    : `<span class="t1">${esc(sched)}</span><small>${up.time === "—" ? "Scheduled" : esc(up.note)}</small>`;
  const dirLabel = mode === "all" ? `<span class="dir">${f.direction === "departure" ? "to" : "from"}</span>` : "";
  const gate = f.direction === "arrival"
    ? (h.baggageBelt ? "Belt " + h.baggageBelt : h.gate ? "Gate " + h.gate : "")
    : (h.gate ? "Gate " + h.gate : "");
  const gateMain = f.direction === "arrival" ? (h.baggageBelt || h.gate || "—") : (h.gate || "—");
  const gateSub = h.terminal ? "Terminal " + h.terminal : f.direction === "arrival" ? (h.baggageBelt ? "Baggage belt" : "") : h.gate ? "" : "Gate not listed";
  const delayChip = late !== null && Math.abs(late) >= 5 && !isCancelled(f) ? `<span class="delay${late < 0 ? " early" : ""}">${fmtDelay(late)}</span>` : "";
  const prog = f.direction === "arrival" && !f.demo ? flightProgress(f, now) : null;
  const progBar = prog?.state === "air" ? `<div class="prog" title="Estimated from departure and arrival times"><i style="width:${prog.pct}%"></i></div>` : "";
  const cls = { delayed: "s-delayed", boarding: "s-boarding", cancelled: "s-cancelled", landed: "s-landed", "": "s-ok" }[st.cls] ?? "s-ok";
  return `<button class="frow ${cls}${isPast(f, now) ? " past" : ""}" role="listitem" data-id="${esc(f.id)}" aria-label="${esc(f.number)} ${f.direction === "departure" ? "to" : "from"} ${esc(placeName(o.airport))}, ${esc(st.label)}">
    <div class="c-time">${timeCell}</div>
    <div class="c-flight">${alBadge(f)}<div style="min-width:0"><div class="num">${esc(f.number)}</div><div class="sub">${esc(f.airline.name || "")}</div></div></div>
    <div class="c-route"><div class="city">${dirLabel}${esc(placeName(o.airport))}</div><div class="sub"><span class="code">${esc(o.airport.iata || "")}</span> <span>${esc(o.airport.name && o.airport.name !== placeName(o.airport) ? o.airport.name : "")}</span></div></div>
    <div class="c-ac"><div class="m">${esc(f.aircraft.model || "Aircraft not listed")}</div><div class="sub mono">${esc(f.aircraft.registration || "")}</div><span class="meta-gate">${esc([h.terminal && "T" + h.terminal, gate].filter(Boolean).join(" · "))}</span></div>
    <div class="c-gate">${esc(gateMain)}<div class="sub">${esc(gateSub)}</div></div>
    <div class="c-status"><span class="status ${st.cls}">${esc(st.label)}</span>${delayChip}${progBar}</div>
    <span class="chev" aria-hidden="true">›</span>
  </button>`;
}

function renderFlights() {
  if (!current) return;
  const { kind, flights, body } = flightState;
  const want = { departures: "departure", arrivals: "arrival" }[mode];
  const term = $("flightSearch").value.toLowerCase().trim();
  const hidePast = $("hidePast").checked;
  const now = Date.now();

  const sel = $("statusFilter"), chosen = sel.value;
  const labels = [...new Set(flights.map(f => stOf(f, now).label))].sort();
  sel.innerHTML = `<option value="all">All statuses</option>` + labels.map(l => `<option${l === chosen ? " selected" : ""}>${esc(l)}</option>`).join("");
  const status = labels.includes(chosen) ? chosen : "all";

  const list = flights
    .filter(f => !want || f.direction === want)
    .filter(f => status === "all" || stOf(f, now).label === status)
    .filter(f => !hidePast || !isPast(f, now))
    .filter(f => [f.number, f.airline.name, f.airline.iata, placeName(other(f).airport), other(f).airport.iata, other(f).airport.name, f.aircraft.model, f.aircraft.registration, here(f).gate].join(" ").toLowerCase().includes(term))
    .sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
  $("routeHeader").textContent = mode === "arrivals" ? "Origin" : mode === "all" ? "From / to" : "Destination";

  $("flightsBadge").textContent = kind === "demo" ? "DEMO FLIGHTS" : kind === "live" ? (body.board.live ? "● LIVE · AERODATABOX" : "SCHEDULE ONLY · AERODATABOX") : "FLIGHTS";
  const credit = `Flight data: <a href="https://aerodatabox.com/" target="_blank" rel="noopener">AeroDataBox</a>.`;
  const notice = kind === "live" && body.notice ? ` <span class="board-note-warn">${esc(body.notice)}${body.stale ? ` Showing the board from ${esc(airportClock(body.board.fetchedAt))}.` : ""}</span>` : "";
  $("boardNote").innerHTML = kind === "live" ? `Times are local airport time. Select a flight for route, times, aircraft and destination weather. ${credit}${notice}`
    : kind === "demo" ? "Demo flights, not live. Select any flight to open its details."
    : kind === "loading" ? "Loading flights…" : esc(flightState.message);

  if (kind === "loading") { $("flightRows").innerHTML = `<div class="skel"></div>`.repeat(6); $("emptyState").hidden = true; return; }
  // "Now" divider before the first flight that is still to come.
  let html = "", placed = kind !== "live" || !!term;
  for (const f of list) {
    if (!placed && !isPast(f, now)) { html += `<div class="now-line" role="presentation">NOW · ${esc(fmtClock(current.tz, new Date(now)))}</div>`; placed = true; }
    html += rowHtml(f, now);
  }
  $("flightRows").innerHTML = html;
  const empty = $("emptyState");
  empty.hidden = list.length > 0;
  empty.textContent = kind === "none" ? flightState.message
    : flights.length ? "No flights match your search."
    : "No passenger flights listed in this time window.";
}
$("flightRows").addEventListener("click", e => {
  const b = e.target.closest("[data-id]");
  if (b) openFlight(flightState.flights.find(f => f.id === b.dataset.id), b);
});

// ---------- side column ----------
function bars(list, total, emptyText) {
  if (!list.length) return `<div class="none">${emptyText}</div>`;
  const max = list[0].count;
  return list.map(x => `<div class="bar"><div class="bl">${x.code ? `<span class="code">${esc(x.code)}</span>` : ""}${esc(x.label)}</div><div class="bn">${x.count}${x.late ? ` · <span class="warn">${x.late} late</span>` : ""}</div><div class="bt"><i style="width:${(x.count - x.late) / max * 100}%"></i><i class="l" style="width:${x.late / max * 100}%"></i></div></div>`).join("");
}
function renderSide() {
  const { kind, flights } = flightState;
  const none = kind === "loading" ? "Loading…" : "No flight data";
  if (kind === "loading" || kind === "none") {
    $("nextList").innerHTML = `<div class="none" style="font-size:12px;color:var(--muted)">${none}</div>`;
    for (const id of ["topRoutes", "topAirlines", "topAircraft"]) $(id).innerHTML = `<div class="none">${none}</div>`;
    return;
  }
  const sorted = [...flights].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
  const nx = [nextFlight(sorted, "departure"), nextFlight(sorted, "arrival")];
  $("nextList").innerHTML = nx.map((f, i) => {
    const dep = i === 0;
    if (!f) return `<div class="next"><div class="next-ic ${dep ? "dep" : ""}">${dep ? "↗" : "↙"}</div><div class="next-tx"><strong>No ${dep ? "departure" : "arrival"}</strong><span>${kind === "demo" ? "None in demo list" : "None in this window"}</span></div></div>`;
    const h = here(f), up = updateTime(f);
    const t = up.time !== "—" ? up.time : hhmm(h.scheduled);
    return `<button class="next" data-id="${esc(f.id)}"><div class="next-ic ${dep ? "dep" : ""}">${dep ? "↗" : "↙"}</div><div class="next-tx"><strong>${esc(f.number)} · ${esc(placeName(other(f).airport))}</strong><span>${dep ? "Next departure" : "Next arrival"}${h.gate ? " · Gate " + esc(h.gate) : ""}</span></div><div class="next-t">${esc(t)}<small>${f.demo ? "" : esc(relative(h.revised || h.scheduled))}</small></div></button>`;
  }).join("");
  const scopeFlights = mode === "arrivals" ? flights.filter(f => f.direction === "arrival") : mode === "departures" ? flights.filter(f => f.direction === "departure") : flights;
  $("topRoutesTitle").textContent = mode === "arrivals" ? "Top origins" : mode === "all" ? "Top routes" : "Top destinations";
  $("topRoutes").innerHTML = bars(topBy(scopeFlights, routeKey, 6), scopeFlights.length, "No routes listed");
  $("topAirlines").innerHTML = bars(topBy(flights, airlineKey, 6), flights.length, "No airlines listed");
  $("topAircraft").innerHTML = bars(topBy(flights, aircraftKey, 5), flights.length, "The provider listed no aircraft types");
}
$("nextList").addEventListener("click", e => {
  const b = e.target.closest("[data-id]");
  if (b) openFlight(flightState.flights.find(f => f.id === b.dataset.id), b);
});

// ---------- flight drawer ----------
// Shows only what the provider supplied; everything else says "Not available".
let fd = null; // { flight, aircraft, aircraftNote, photo, photoKind, wx, wxNote, checkNote, checking }

const flightSlug = f => String(f.number).replace(/\s+/g, "").toUpperCase() + "-" + (f.direction === "departure" ? "d" : "a");
function openFlightFromUrl() {
  const slug = new URLSearchParams(location.search).get("flight");
  if (!slug || flightState.kind === "loading") return;
  const f = flightState.flights.find(x => flightSlug(x) === slug.toUpperCase().replace(/-([DA])$/, (m, c) => "-" + c.toLowerCase()));
  if (f && fd?.flight?.id !== f.id) openFlight(f, null, false);
  else if (!f) showToast("That flight is not on the current board");
}

function openFlight(f, opener, push = true) {
  if (!f) return;
  fd = { flight: f, aircraft: null, aircraftNote: "", photo: f.aircraft.photo, photoKind: f.demo ? "demo" : "representative", wx: null, wxNote: "", checkNote: f.demo ? "" : "Uses about 1% of the monthly free allowance.", checking: false };
  if (push) history.pushState(null, "", airportPath(current) + "?flight=" + flightSlug(f));
  renderFlightDrawer();
  openDrawer("flightModal", opener, $("closeFlight"));
  lookupAircraft(f);
  loadOtherWeather(f);
}

function tval(t, ref, kind) {
  if (!t) return `<b class="na">${NA}</b>`;
  const diff = ref && t !== ref ? Math.round((Date.parse(t.utc) - Date.parse(ref.utc)) / 60000) : null;
  const cls = diff !== null && Number.isFinite(diff) ? (diff >= 5 ? "late" : diff <= -5 ? "early" : "") : "";
  return `<b class="${cls}">${esc(hhmm(t))}${kind ? ` <span style="font-weight:500;color:var(--muted);font-family:var(--sans)">${kind}</span>` : ""}</b>`;
}
function endCard(title, m, f, isDep) {
  const done = isDep ? ["departed", "en-route", "approaching", "arrived"].includes(f.status) : f.status === "arrived";
  const rows = [
    ["Scheduled", tval(m.scheduled)],
    [done ? "Actual" : "Estimated", m.revised ? tval(m.revised, m.scheduled) : `<b class="na">${NA}</b>`],
    [isDep ? "Takeoff (runway)" : "Landing (runway)", m.runway ? tval(m.runway) : `<b class="na">${NA}</b>`],
    ["Terminal", m.terminal ? `<b>${esc(m.terminal)}</b>` : `<b class="na">${NA}</b>`],
    ["Gate", m.gate ? `<b>${esc(m.gate)}</b>` : `<b class="na">${NA}</b>`],
    isDep ? ["Check-in desk", m.checkInDesk ? `<b>${esc(m.checkInDesk)}</b>` : `<b class="na">${NA}</b>`] : ["Baggage belt", m.baggageBelt ? `<b>${esc(m.baggageBelt)}</b>` : `<b class="na">${NA}</b>`],
  ];
  const offset = (m.scheduled?.local || "").match(/[+-]\d\d:\d\d$/)?.[0];
  return `<div class="tcard"><h4>${title}${offset ? ` · UTC${offset}` : ""}</h4>${rows.map(([k, v]) => `<div class="trow"><span>${k}</span>${v}</div>`).join("")}</div>`;
}
const fieldHtml = (label, value, mono) => `<div class="field"><small>${label}</small><strong class="${value === NA || value == null ? "na" : mono ? "mono" : ""}">${esc(value ?? NA)}</strong></div>`;

// The registration links to the aircraft's own page.
const regField = reg => (reg && reg !== NA
  ? `<div class="field"><small>REGISTRATION</small><strong class="mono"><a class="reg-link" href="${esc(aircraftPath(reg))}">${esc(reg)} <span aria-hidden="true">→</span></a></strong></div>`
  : fieldHtml("REGISTRATION", NA));

function renderFlightDrawer() {
  if (!fd) return;
  const f = fd.flight, a = fd.aircraft, now = Date.now();
  const st = stOf(f, now);
  const dep = f.departure, arr = f.arrival;
  const depAp = lookup(dep.airport.iata), arrAp = lookup(arr.airport.iata);
  const prog = f.demo ? { state: null } : flightProgress(f, now);
  const dist = f.distanceKm ?? null;
  const dur = fmtDuration(f.scheduledDurationMinutes);
  $("detailEyebrow").textContent = f.demo ? "FLIGHT · DEMO DATA" : "FLIGHT · AERODATABOX";
  document.title = `${f.number} · ${placeName(dep.airport)} → ${placeName(arr.airport)} — Airport Live`;

  let trackNote = "";
  if (prog.state === "air") trackNote = `<span>Departed ${relative(dep.runway || dep.revised || dep.scheduled)}</span><span>Lands ${relative(arr.runway || arr.revised || arr.scheduled)}</span>`;
  else if (prog.state === "before") {
    // Not reported as departed: a time in the past is "due", not "departed".
    const t = dep.revised || dep.scheduled, due = Date.parse(t?.utc) < now;
    trackNote = `<span>${due ? `Departure was due ${relative(t)} · not reported yet` : `Departs ${relative(t)}`}</span><span></span>`;
  }
  // Only "Landed" when the provider reports it; otherwise the arrival was due, not confirmed.
  else if (prog.state === "after") trackNote = `<span>${f.status === "arrived" ? `Landed ${relative(arr.runway || arr.revised || arr.scheduled)}` : `Arrival was due ${relative(arr.runway || arr.revised || arr.scheduled)} · landing not reported yet`}</span><span></span>`;
  // Fresh live data: the line shows where the aircraft really is.
  const ls = st.live ? liveSeen.get(f.id) : null;
  if (ls && fd.live) {
    const pos = { lat: fd.live.lat, lon: fd.live.lon }, done = haversineKm(depAp, pos), left = haversineKm(pos, arrAp);
    const seen = `seen ${relative({ utc: fd.live.seenAt })}`;
    if (ls.key === "landed") { prog.state = "after"; prog.pct = 100; trackNote = `<span>Landed · on the ground at ${esc(arrAp.iata)} (live data, ${seen})</span><span></span>`; }
    else if (ls.key === "ground") { prog.state = "before"; prog.pct = 0; trackNote = `<span>On the ground at ${esc(depAp.iata)} (live data, ${seen})</span><span></span>`; }
    else if (done !== null && left !== null) { prog.state = "air"; prog.live = true; prog.pct = Math.round((100 * done) / (done + left)); trackNote = `<span>Live position · ${fmtNum(left)} km to ${esc(arrAp.iata)}</span><span>${seen}</span>`; }
  }
  const pct = prog.pct ?? 0;
  const track = prog.state
    ? `<div class="track" title="${prog.state === "air" ? (prog.live ? "Live position from ADS-B data" : "Estimated from the departure and arrival times, not a live position") : ""}"><div class="done" style="width:${pct}%"></div><div class="pt on" style="left:0"></div><div class="pt ${pct >= 100 ? "on" : ""}" style="left:100%"></div>${prog.state === "air" ? `<div class="plane" style="left:${pct}%">✈</div>` : ""}</div><div class="track-note">${trackNote}</div>`
    : `<div class="track"><div class="pt on" style="left:0"></div><div class="pt" style="left:100%"></div></div>`;

  const routeEnd = (m, ap, cls) => `<div class="route-end ${cls}"><div class="rc">${esc(m.airport.iata || "—")}</div><div class="rn">${esc(m.airport.name || ap?.name || NA)}</div><div class="rs">${esc([m.airport.city || ap?.city, ap?.country].filter(Boolean).join(", "))}</div></div>`;

  // Photo
  let photoHtml, noteHtml = "";
  const p = fd.photo;
  const reg = fd.reg || f.aircraft.registration || "";
  if (fd.photoKind === "demo") { photoHtml = `<img src="${esc(demoAircraftPhoto)}" alt="Illustrative aircraft photo">`; noteHtml = "Illustrative photo · not this aircraft"; }
  else if (fd.photoKind === "planespotters" && p?.url) {
    // Planespotters.net terms: photographer credit next to the photo, linked to the photo page.
    const credit = `${esc(p.author || "Photographer unknown")} · Planespotters.net`;
    photoHtml = `<img src="${esc(p.url)}" alt="Photo of aircraft ${esc(reg)}" onerror="this.parentElement.classList.add('no-photo')">`;
    noteHtml = `Photo of this aircraft (${esc(reg)}) · ${p.pageUrl ? `<a href="${esc(p.pageUrl)}" target="_blank" rel="noopener">${credit}</a>` : credit}`;
  }
  else if (p?.url) {
    const by = [p.author, p.licence].filter(Boolean).map(esc).join(" · ");
    const credit = by ? " · " + (p.pageUrl ? `<a href="${esc(p.pageUrl)}" target="_blank" rel="noopener">${by}</a>` : by) : "";
    photoHtml = `<img src="${esc(p.url)}" alt="${fd.photoKind === "this-aircraft" ? "Photo of aircraft " + esc(f.aircraft.registration || "") : "Representative photo of a " + esc(f.aircraft.model || "similar aircraft")}" onerror="this.parentElement.classList.add('no-photo')">`;
    noteHtml = fd.photoKind === "this-aircraft" ? `Photo of this aircraft (${esc(f.aircraft.registration || "")}) · matched automatically${credit}` : `Representative photo · may not be this aircraft${credit}`;
  } else { photoHtml = ""; noteHtml = "No aircraft photo available"; }

  const af = aircraftFields(a);
  const model = a?.model || f.aircraft.model || NA;
  const maker = a?.manufacturer || f.aircraft.manufacturer || NA;

  const ms = milestones(f, now);
  const otherEnd = other(f), otherAp = lookup(otherEnd.airport.iata);
  const wx = fd.wx;
  let wxHtml;
  if (!otherAp) wxHtml = `<div class="note">The other airport (${esc(otherEnd.airport.iata || otherEnd.airport.name || "unknown")}) is not in our airport list, so its weather can't be shown.</div>`;
  else if (!wx) wxHtml = `<div class="note">${esc(fd.wxNote || "Loading weather…")}</div>`;
  else {
    const m = wx.metar, fc0 = wx.forecast?.hours?.[0];
    const t = m.status === "ok" ? m.tempC : fc0?.tempC;
    const ic = m.status === "ok" ? iconFor(m.icon, fc0?.night) : fc0 ? iconFor(fc0.icon, fc0.night) : "";
    const line = m.status === "ok" ? [m.condition, m.wind && "Wind " + m.wind, m.visibility && "Vis " + m.visibility, m.flightCategory].filter(Boolean).join(" · ") : fc0 ? "Forecast: " + (fc0.label || "—") + " (no METAR)" : "No weather report";
    wxHtml = `<div class="mini-wx"><div class="mi" aria-hidden="true">${ic}</div><div class="mt">${esc(fmtTemp(t))}</div><div class="md"><b>${esc(otherAp.name)}</b><br>${esc(line)}${otherAp.tz ? `<br>Local time ${esc(fmtClock(otherAp.tz))}` : ""}</div></div>`;
  }

  $("flightBody").innerHTML = `
    <div class="fd-head">${alBadge(f)}<div><h2 id="detailTitle">${esc(f.number)}</h2><div class="sub">${esc([f.airline.name, f.callSign && "Call sign " + f.callSign].filter(Boolean).join(" · ") || NA)}</div></div><span class="status ${st.cls}">${esc(st.label)}</span></div>
    <div class="route">
      <div class="route-ends">${routeEnd(dep, depAp, "from")}<div class="route-mid">${dur ? `<div class="dur">${esc(dur)}</div>scheduled` : ""}${dist !== null ? `<div>${fmtNum(dist)} km</div>` : ""}</div>${routeEnd(arr, arrAp, "to")}</div>
      ${track}
    </div>
    <div class="times">${endCard("Departure", dep, f, true)}${endCard("Arrival", arr, f, false)}</div>
    <div class="note">Times are local at each airport, as the provider gives them. Amber = later than scheduled, green = earlier.</div>

    <div class="fd-sec"><h3>Aircraft <small>${esc(fd.aircraftNote)}</small></h3>
      <div class="ac"><div class="plane-photo${photoHtml ? "" : " no-photo"}">${photoHtml}<span class="photo-note">${noteHtml}</span></div>
      <div class="grid2">${fieldHtml("TYPE", model)}${fieldHtml("MANUFACTURER", maker)}${regField(fd.reg || f.aircraft.registration || af.acReg)}${fieldHtml("MODE-S HEX", f.aircraft.modeS || a?.modeS || NA, true)}${fieldHtml("AGE", af.acAge)}${fieldHtml("SEATS", af.acSeats)}${fieldHtml("ENGINES", af.acEngines)}${fieldHtml("DELIVERED", af.acDelivered)}${fieldHtml("OPERATOR", af.acOperator)}${fieldHtml("SERIAL (MSN)", a?.serial || NA, true)}</div></div>
      ${fd.live ? `<div class="fd-sub"><h4>Live now <small>${esc(fd.live.callsign || "")} · seen ${esc(relative(fd.live.seenAt))}</small></h4><div class="grid3">${liveFields(fd.live).map(([k, v]) => fieldHtml(k, v)).join("")}</div><div class="note">Live ADS-B data: <a href="https://adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> (ODbL).</div></div>` : ""}
    </div>

    <div class="fd-sec"><h3>Timeline</h3><ol class="timeline">${ms.map(x => `<li class="${x.key === "x" ? "bad" : x.done ? "done" : ""}">${esc(x.label)}${x.time ? ` · <span class="tl-t">${esc(hhmm(x.time))}</span><span class="tl-k">${x.kind}</span>` : ""}</li>`).join("")}</ol></div>

    <div class="fd-sec"><h3>Weather ${f.direction === "departure" ? "at destination" : "at origin"}</h3>${wxHtml}</div>

    <div class="fd-sec"><h3>Route &amp; data</h3><div class="grid2">${fieldHtml("GREAT-CIRCLE DISTANCE", dist !== null ? fmtNum(dist) + " km · " + fmtNum(Math.round(dist * 0.539957)) + " nm" : NA)}${fieldHtml("SCHEDULED FLIGHT TIME", dur || NA)}${fieldHtml("DIRECTION", f.direction === "departure" ? "Departure from " + current.iata : "Arrival at " + current.iata)}${fieldHtml("LAST PROVIDER UPDATE", f.updatedAt ? String(f.updatedAt).replace("T", " ").slice(0, 16) + " UTC" : NA)}</div>
      ${f.demo ? `<div class="note">Demo flight: sample values.</div>` : `<div class="check-row"><button class="ghost" id="checkFlightBtn" type="button" ${fd.checking ? "disabled" : ""}>↻ Check this flight</button><span class="note" style="margin:0">${esc(fd.checkNote)}</span></div>`}
    </div>`;
  const btn = $("checkFlightBtn");
  if (btn) btn.onclick = checkFlight;
}

// The drawer found this flight's aircraft in live data: keep it for the
// "Live now" fields, and its live status for the drawer and the board row.
function setLive(f, ac) {
  fd.live = ac;
  const st = liveStatus(f, ac, lookup(f.departure.airport.iata), lookup(f.arrival.airport.iata));
  if (st) liveSeen.set(f.id, st); else liveSeen.delete(f.id);
  renderFlights();
}

const onlyReg = reg => ({ registration: reg, ageYears: null, seats: null, engines: null, engineType: null, deliveryDate: null, airline: null });
const AIRBORNE = ["departed", "en-route", "approaching"];

// Which aircraft is it? The board's registration, else the aircraft that live
// ADS-B data (adsb.lol) shows flying this flight's callsign. Then a real photo
// (Planespotters.net) and the details (AeroDataBox, 1 unit).
async function lookupAircraft(f) {
  if (f.demo) { fd.aircraftNote = "Demo flight: no aircraft lookup."; renderFlightDrawer(); return; }
  let reg = f.aircraft.registration, regFrom = reg ? "board" : null, why = "";
  const cand = callsignFor(f);
  if (!reg) {
    fd.aircraftNote = "Looking for this flight in live ADS-B data…";
    renderFlightDrawer();
    // 1. The provider's own callsign: the aircraft flying it now.
    if (cand?.fromProvider) {
      try {
        const body = await fetchLive(cand.callsign);
        if (fd?.flight !== f) return;
        if (body.aircraft?.registration && !typeConflicts(body.aircraft.typeCode, f.aircraft.model)) { reg = body.aircraft.registration; regFrom = "adsb"; setLive(f, body.aircraft); }
      } catch { /* try the route match */ }
    }
    // 2. Airlines mostly fly under callsigns like "WMT1LH", not the flight number:
    //    find the one aircraft of this airline flying exactly this route near where the flight should be.
    // The airline's ICAO code, or its IATA code (the server then tries every airline using it).
    const from = lookup(f.departure.airport.iata), to = lookup(f.arrival.airport.iata), icao = f.airline?.icao || f.airline?.iata;
    if (!reg && !icao) why = "the provider gave no airline code, so live data can't be matched";
    else if (!reg && (!from || !to)) why = "one of the airports is not in our airport list";
    if (!reg && icao && from && to) {
      try {
        const body = await fetchIdentify(icao, flightDigits(f), from.iata, to.iata, estimatedPosition(f, from, to));
        if (fd?.flight !== f) return;
        const ac = body.aircraft;
        // Says exactly which step found nothing, so a screenshot shows the cause.
        if (ac?.registration && !typeConflicts(ac.typeCode, f.aircraft.model)) { reg = ac.registration; regFrom = "adsb"; setLive(f, ac); }
        else if (ac?.registration) why = `${ac.callsign} flies ${from.iata}–${to.iata} but is a ${ac.typeCode}, a different family from the scheduled ${f.aircraft.model}`;
        else if (body.status !== "ok") why = body.notice || "live data unavailable";
        else if (body.matches > 1) why = "more than one aircraft matched, so none is shown";
        else if (body.airlineUnknown) why = `the airline code ${icao} is not in the open airline list`;
        else if (!body.airlineNearby) why = `no ${(body.airlines || [icao]).join("/")} aircraft within 250 nm (${body.nearby ?? 0} aircraft seen)`;
        else if (!body.candidates) why = `${body.airlineNearby} ${icao} aircraft nearby, none on the ${from.iata}–${to.iata} line or at either airport`;
        else why = `checked ${(body.checked || []).map(c => `${c.callsign} ${c.route || "route unknown"}`).join(", ")}; none on ${from.iata}–${to.iata}`;
      } catch (err) { why = "live lookup failed (" + err.message + ")"; }
    }
    if (fd?.flight !== f) return;
  } else if (cand?.fromProvider && (AIRBORNE.includes(f.status) || isOverdue(f, Date.now()))) {
    // Known aircraft in the air, or no recent report: show its live altitude, speed and status.
    fetchLive(cand.callsign).then(body => { if (fd?.flight === f && body.aircraft?.registration === reg) { setLive(f, body.aircraft); renderFlightDrawer(); } }).catch(() => {});
  }
  if (!reg) {
    const dep = Date.parse((f.departure.revised || f.departure.scheduled)?.utc);
    const early = !AIRBORNE.includes(f.status) && f.status !== "arrived" && Number.isFinite(dep) && dep - Date.now() > 30 * 60000;
    fd.aircraftNote = early ? "Aircraft not known yet: it usually shows up in live data shortly before departure"
      : notFoundMessage(f.aircraft.model, why);
    renderFlightDrawer();
    return;
  }

  fd.reg = reg;
  fd.aircraftNote = "Looking up " + reg + "…";
  renderFlightDrawer();
  const [photoRes, detRes] = await Promise.allSettled([fetchAircraftPhoto(reg), fetchAircraft(reg)]);
  if (fd?.flight !== f) return;
  const real = photoRes.status === "fulfilled" ? photoRes.value.photo : null;
  let a = null, detNote;
  if (detRes.status === "fulfilled") {
    const body = detRes.value;
    a = body.aircraft;
    // Never mix two aircraft: details must be for the registration we identified.
    if (a?.registration && a.registration.toUpperCase() !== reg.toUpperCase()) a = null;
    detNote = a ? "AeroDataBox" + (body.fetchedAt ? " · looked up " + body.fetchedAt.slice(0, 10) : "") + (body.stale ? " · older lookup" : "")
      : body.status === "ok" ? `AeroDataBox has no record of ${reg}` : body.notice || "Aircraft details unavailable";
  } else detNote = "Couldn't look up the aircraft details";
  fd.aircraft = a || onlyReg(reg);
  if (real) { fd.photo = real; fd.photoKind = "planespotters"; }
  else if (a?.photo) { fd.photo = a.photo; fd.photoKind = "this-aircraft"; }
  const swapped = regFrom === "adsb" && fd.live && typeDiffers(fd.live.typeCode, f.aircraft.model) ? `operated by a ${fd.live.typeCode} (the schedule lists ${f.aircraft.model})` : null;
  fd.aircraftNote = [regFrom === "adsb" ? "Registration from live ADS-B (adsb.lol)" : null, swapped, detNote].filter(Boolean).join(" · ");
  renderFlightDrawer();
}

async function loadOtherWeather(f) {
  const ap = lookup(other(f).airport.iata);
  if (!ap || f.demo) { if (f.demo) fd.wxNote = "Not loaded for demo flights."; renderFlightDrawer(); return; }
  try {
    const res = await fetchWeather(ap.iata);
    if (fd?.flight !== f) return;
    fd.wx = res.data;
  } catch (err) { if (fd?.flight === f) fd.wxNote = "Weather unavailable right now."; }
  if (fd?.flight === f) renderFlightDrawer();
}

// "Check this flight": current status of this one flight (2 units, stored 5 minutes).
async function checkFlight() {
  const f = fd?.flight;
  if (!f || f.demo || !current) return;
  fd.checking = true; fd.checkNote = "Checking…"; renderFlightDrawer();
  let body;
  try { body = await fetchFlightStatus(f, current.iata); }
  catch (err) { if (fd?.flight === f) { fd.checking = false; fd.checkNote = "Couldn't check (" + err.message + ")."; renderFlightDrawer(); } return; }
  if (fd?.flight !== f) return;
  fd.checking = false;
  if (!body.flight) { fd.checkNote = body.status === "ok" ? "AeroDataBox has no status for this flight on this date." : body.notice || "Status unavailable right now."; renderFlightDrawer(); return; }
  const known = Object.fromEntries(Object.entries(body.flight.aircraft).filter(([, v]) => v !== null));
  const fresh = { ...body.flight, aircraft: { ...f.aircraft, ...known } };
  if (flightState.kind === "live") { flightState.flights = flightState.flights.map(x => (x.id === f.id ? fresh : x)); renderAll(); }
  fd.flight = fresh;
  fd.checkNote = `Status checked ${body.fetchedAt ? airportClock(body.fetchedAt) : ""} airport time` + (body.stale ? " (older answer)" : "") + ".";
  if (!f.aircraft.registration && fresh.aircraft.registration) lookupAircraft(fresh);
  else renderFlightDrawer();
}

$("shareFlight").onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); showToast("Link copied"); }
  catch { showToast("Copy the address from the address bar"); }
};

// ---------- weather drawer ----------
const arrow = deg => (Number.isFinite(deg) ? `<i style="transform:rotate(${(deg + 180) % 360}deg)">↑</i>` : "");
function renderWeatherDrawer() {
  const a = current, res = weatherState;
  if (!res) { $("weatherBody").innerHTML = `<div class="note">Loading weather…</div>`; return; }
  const { metar: m, taf: t, forecast: fc } = res.data;
  const hours = fc.status === "ok" ? fc.hours : [];
  const fc0 = hours[0];
  const ok = m.status === "ok";
  const big = ok ? fmtTemp(m.tempC) : fc0 ? fmtTemp(fc0.tempC) : "—";
  const ic = ok ? iconFor(m.icon, fc0?.night) : fc0 ? iconFor(fc0.icon, fc0.night) : "";
  const f = (k, v) => fieldHtml(k, v ?? "Not reported");
  const fields = ok ? [
    f("WIND", m.wind), f("VISIBILITY", m.visibility), f("CEILING", m.ceiling),
    f("TEMPERATURE", m.tempC != null ? m.tempC + " °C" : null), f("DEW POINT", m.dewpointC != null ? m.dewpointC + " °C" : null),
    f("PRESSURE", m.pressure), f("FLIGHT CATEGORY", m.flightCategory), f("STATION", [m.station, m.stationName].filter(Boolean).join(" · ") || null),
    f("OBSERVED", m.observedAt ? timeLabel(m.observedAt, a.tz) + " · " + ageText(ageMinutes(m.observedAt)) : null),
  ].join("") : "";
  const tafHtml = t.status === "ok"
    ? `<div class="raw">${esc(stripType(t.raw))}</div><div class="note">Issued ${esc(dayTimeUtc(t.issuedAt))} · valid ${esc(dayTimeUtc(t.validFrom))} to ${esc(dayTimeUtc(t.validTo))}</div><div class="taf-lines">${tafGroups(t.raw).map(g => `<div class="taf-line ${g.kind}"><b>${esc(g.label)}</b><code>${esc(g.text)}</code></div>`).join("")}</div>`
    : `<div class="note">${esc(t.status === "none" ? t.reason : "Couldn't load the TAF.")}</div>`;
  $("weatherBody").innerHTML = `
    <div class="wx-hero"><div class="ic" aria-hidden="true">${ic}</div><div class="big" id="wxTitle">${esc(big)}</div><div><div class="cond">${esc(ok ? m.condition || "Observed" : fc0 ? "Forecast: " + (fc0.label || "—") : "No report")}</div><div class="sub">${esc(a.name)} · ${ok ? "METAR" : "no METAR station reporting"}</div></div>${ok && m.flightCategory ? `<div class="wc-cat cat-${esc(m.flightCategory)}">${esc(m.flightCategory)}</div>` : ""}</div>
    ${ok && m.summary ? `<div class="note" style="font-size:13px;color:#c3d1dd">${esc(m.summary)}</div>` : ""}
    ${ok ? `<div class="fd-sec"><h3>Decoded METAR</h3><div class="wx-grid">${fields}</div><div class="raw" style="margin-top:10px">${esc(stripType(m.raw))}</div></div>` : `<div class="note">${esc(m.reason || m.message || "")}</div>`}
    <div class="fd-sec"><h3>Next ${hours.length} hours <small>MET Norway forecast${a.tz ? ", airport time" : ", UTC"}</small></h3>
      ${hours.length ? `<div class="wx-chart">${forecastSvg(hours, { tz: a.tz })}</div><div class="hours" style="margin-top:10px">${hours.map(h => `<div class="hour" title="${esc(h.label || "")}"><div class="h">${esc(localHour(h.time, a.tz))}</div><div class="i" aria-hidden="true">${iconFor(h.icon, h.night)}</div><div class="t">${esc(fmtTemp(h.tempC))}</div><div class="w">${arrow(h.windDir)}${h.windMs != null ? Math.round(h.windMs * 1.94384) + " kt" : "—"}</div><div class="p">${h.precipMm ? h.precipMm + " mm" : ""}</div></div>`).join("")}</div>` : `<div class="note">${esc(fc.status === "error" ? "Forecast unavailable right now" : fc.reason || "No forecast")}</div>`}
    </div>
    <div class="fd-sec"><h3>TAF <small>terminal aerodrome forecast</small></h3>${tafHtml}</div>
    <div class="note">${$("weatherSource").innerHTML}</div>`;
}
function openWeather(opener) { renderWeatherDrawer(); openDrawer("weatherModal", opener, $("closeWeather")); }
$("weatherCard").onclick = e => openWeather(e.currentTarget);
$("weatherMore").onclick = e => openWeather(e.currentTarget);

// ---------- modals and drawers ----------
function openModal(id, opener, focusEl) {
  lastFocus = opener || document.activeElement;
  $(id).classList.add("open");
  (focusEl || $(id)).focus();
}
function closeModal(id) {
  if (!$(id).classList.contains("open")) return;
  $(id).classList.remove("open");
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
const openDrawer = (id, opener, focusEl) => { document.body.style.overflow = "hidden"; openModal(id, opener, focusEl); };
function closeDrawer(id) {
  if (!$(id).classList.contains("open")) return;
  closeModal(id);
  if (![...document.querySelectorAll(".drawer-backdrop")].some(d => d.classList.contains("open"))) document.body.style.overflow = "";
  if (id === "flightModal") {
    fd = null;
    if (current) document.title = `${current.iata} · ${current.name} — Airport Live`;
    if (location.search && current) history.pushState(null, "", airportPath(current));
  }
}

// ---------- airport picker ----------
function openPicker() {
  if (!index) return;
  $("airportSearch").value = "";
  renderPicker();
  openModal("airportModal", document.activeElement, $("airportSearch"));
}
function optionHtml(a, i) {
  const sub = [a.city, a.country].filter(Boolean).join(", ");
  const fav = isFavorite(a);
  return `<button class="airport-option" role="option" id="opt-${i}" data-i="${i}" aria-selected="false"><span class="ao-ic${fav ? " fav" : ""}">${fav ? "★" : "✈"}</span><span class="ao-tx"><strong>${esc(a.name)}</strong><small>${esc(sub)}${a.icao ? " · " + esc(a.icao) : ""}${a.tz ? " · " + fmtClock(a.tz) + " local" : ""}</small></span><code>${esc(a.iata)}</code></button>`;
}
function renderPicker() {
  const q = $("airportSearch").value;
  let html = "";
  if (q.trim()) {
    // A registration ("YR-ASA") also offers that aircraft's page, first.
    const reg = asRegistration(q);
    pickerResults = [...(reg ? [{ aircraft: reg }] : []), ...searchAirports(index, q, 25)];
    html = pickerResults.length ? pickerResults.map((a, i) => (a.aircraft ? aircraftOptionHtml(a.aircraft, i) : optionHtml(a, i))).join("") : `<div class="option-empty">No airport matches "${esc(q)}".</div>`;
  } else {
    const saved = favorites().map(c => index.byIata.get(c)).filter(Boolean);
    const demo = demoAirportCodes.map(c => index.byIata.get(c)).filter(a => a && !saved.includes(a));
    pickerResults = [...saved, ...demo];
    if (saved.length) html += `<div class="option-group">Saved airports</div>` + saved.map(optionHtml).join("");
    if (demo.length) html += `<div class="option-group">Suggested</div>` + demo.map((a, i) => optionHtml(a, i + saved.length)).join("");
  }
  $("airportOptions").innerHTML = html;
  pickerActive = q.trim() && pickerResults.length ? 0 : -1;
  highlightOption();
}
function highlightOption() {
  $("airportOptions").querySelectorAll(".airport-option").forEach(el => {
    const on = Number(el.dataset.i) === pickerActive;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  });
  if (pickerActive >= 0) $("airportSearch").setAttribute("aria-activedescendant", "opt-" + pickerActive);
  else $("airportSearch").removeAttribute("aria-activedescendant");
}
const aircraftOptionHtml = (reg, i) => `<button class="airport-option" role="option" id="opt-${i}" data-i="${i}" aria-selected="false"><span class="ao-ic">✈</span><span class="ao-tx"><strong>Aircraft ${esc(reg)}</strong><small>Photo, details and where it is now</small></span><code>REG</code></button>`;
function choose(a) {
  if (!a) return;
  if (a.aircraft) { location.href = aircraftPath(a.aircraft); return; }
  lastFocus = $("chooseBtn");
  closeModal("airportModal");
  goTo(a);
  showToast("Airport changed to " + a.iata);
}

// ---------- favourites ----------
function updateFavorite() {
  const on = !!current && isFavorite(current);
  $("favoriteBtn").classList.toggle("active", on);
  $("favoriteBtn").setAttribute("aria-pressed", on);
  $("favoriteBtn").title = on ? "Remove from saved airports" : "Save airport";
  $("favoriteBtn").querySelector(".fav-text").textContent = on ? "Saved" : "Save";
  const home = !!current && store.get("home", null) === current.iata;
  $("homeBtn").classList.toggle("active", home);
  $("homeBtn").setAttribute("aria-pressed", home);
  $("homeBtn").title = home ? "Your home airport: opens when Airport Live starts (click to unset)" : "Open this airport when Airport Live starts";
  $("homeBtn").querySelector(".fav-text").textContent = home ? "Home airport" : "Home";
}

// ---------- events ----------
$("chooseBtn").onclick = openPicker;
$("closeModal").onclick = () => closeModal("airportModal");
$("closeFlight").onclick = () => closeDrawer("flightModal");
$("closeWeather").onclick = () => closeDrawer("weatherModal");
$("airportModal").addEventListener("click", e => { if (e.target === $("airportModal")) closeModal("airportModal"); });
for (const id of ["flightModal", "weatherModal"]) $(id).addEventListener("click", e => { if (e.target === $(id)) closeDrawer(id); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeModal("airportModal"); closeDrawer("flightModal"); closeDrawer("weatherModal"); return; }
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (!typing && (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey)))) { e.preventDefault(); openPicker(); }
});
$("airportSearch").addEventListener("input", renderPicker);
$("airportSearch").addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!pickerResults.length) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    pickerActive = (pickerActive + step + pickerResults.length) % pickerResults.length;
    highlightOption();
  } else if (e.key === "Enter") {
    e.preventDefault();
    choose(pickerResults[pickerActive >= 0 ? pickerActive : 0]);
  }
});
$("airportOptions").addEventListener("click", e => {
  const btn = e.target.closest("[data-i]");
  if (btn) choose(pickerResults[Number(btn.dataset.i)]);
});
$("homeBtn").onclick = () => {
  if (!current) return;
  const on = store.get("home", null) !== current.iata;
  store.set("home", on ? current.iata : null);
  updateFavorite();
  renderQuick();
  showToast(on ? current.iata + " is your home airport: it opens when you start Airport Live" : "Home airport removed");
};
$("favoriteBtn").onclick = () => {
  if (!current) return;
  const list = favorites();
  const on = !list.includes(current.iata);
  store.set("favorites", on ? [...list, current.iata] : list.filter(c => c !== current.iata));
  updateFavorite();
  renderQuick();
  showToast(on ? current.iata + " saved" : current.iata + " removed from saved airports");
};
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
  b.classList.add("active");
  b.setAttribute("aria-pressed", "true");
  mode = b.dataset.mode;
  renderFlights(); renderSide();
});
$("flightSearch").addEventListener("input", renderFlights);
$("statusFilter").addEventListener("change", renderFlights);
$("hidePast").checked = store.get("hidePast", false);
$("hidePast").addEventListener("change", () => { store.set("hidePast", $("hidePast").checked); renderFlights(); });
$("refreshBtn").onclick = () => { if (current) { showAirport(current); showToast("Refreshed"); } };
let resizeT;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(renderTraffic, 200); });
setInterval(() => { if (current && document.visibilityState === "visible") loadFlights(current, true); }, FLIGHTS_REFRESH_MS);
// Every minute: refresh age labels, statuses that became overdue, progress (no new request).
setInterval(() => {
  if (!current || document.visibilityState !== "visible") return;
  renderQuick();
  if (flightState.kind !== "live") return;
  updateFlightAge();
  renderAll();
  if (fd) renderFlightDrawer();
}, 60000);
window.addEventListener("popstate", () => {
  if (!new URLSearchParams(location.search).get("flight") && $("flightModal").classList.contains("open")) { $("flightModal").classList.remove("open"); fd = null; document.body.style.overflow = ""; }
  route();
});
setInterval(updateClock, 1000);
setInterval(() => { if (current && document.visibilityState === "visible") renderWeather(current, true); }, REFRESH_MS);

// Logos arrive separately; the board shows code badges until then.
loadLogos().then(() => { if (current) { renderFlights(); renderSide(); if (fd) renderFlightDrawer(); } });
loadAirports();
