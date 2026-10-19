import { indexAirports, findAirport, searchAirports, parseRoute, airportPath, airportLocation, TYPE_LABELS } from "./airports.js";
import { demoWeather, demoPhotos, demoAircraftPhoto, demoFlights, demoAirportCodes, flightStats } from "./demo-data.js";

const DEFAULT_AIRPORT = "SEA";
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

// ---------- routing: /airport/OTP ----------
function route() {
  if (!index) return;
  const r = parseRoute(location.pathname);
  if (r.invalid) return notFound(r.code);
  const code = r.code || store.get("last", DEFAULT_AIRPORT);
  const a = findAirport(index, code) || (!r.code && findAirport(index, DEFAULT_AIRPORT));
  if (!a) return notFound(code);
  // Canonical address uses the IATA code (e.g. /airport/LROP -> /airport/OTP).
  if (location.pathname !== airportPath(a)) history.replaceState(null, "", airportPath(a) + location.search);
  showAirport(a);
}

function notFound(code) {
  current = null;
  document.title = "Airport not found — Airport Live";
  showStatus("Airport not found", code ? `No airport with the code "${code}" is in the list. Use a 3-letter (IATA) or 4-letter (ICAO) code, or search by name.` : "This address doesn't match an airport.", { label: "⌕  Search airports", run: openPicker });
}

function goTo(a) {
  if (location.pathname !== airportPath(a)) history.pushState(null, "", airportPath(a));
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

  const kind = [TYPE_LABELS[a.type], a.scheduled ? "Scheduled flights" : "No scheduled flights listed"].join(" · ");
  setText({
    airportKind: kind, airportCode: a.iata, airportName: a.name, airportLocation: airportLocation(a),
    timezone: a.tz || "Not available", icaoCode: a.icao || "Not available",
    runways: a.runways ?? "Not listed", airportPhotoTitle: a.name, cityPhotoTitle: a.city || "City not listed",
  });
  $("timezone").classList.toggle("unknown", !a.tz);
  $("icaoCode").classList.toggle("unknown", !a.icao);
  $("runways").classList.toggle("unknown", a.runways == null);
  $("runwaysNote").textContent = a.runways == null ? "" : "listed";
  updateFavorite();
  renderPhotos(a);
  renderWeather(a);
  updateClock();
  renderOverview(a);
  renderFlights();
}

function setPhoto(card, img, url, alt, code) {
  card.dataset.code = code;
  card.classList.toggle("no-photo", !url);
  img.onerror = () => card.classList.add("no-photo");
  img.onload = () => card.classList.remove("no-photo");
  if (url) { img.src = url; img.alt = alt; } else { img.removeAttribute("src"); img.alt = ""; }
}

function renderPhotos(a) {
  const p = demoPhotos[a.iata] || {};
  setPhoto($("airportPhotoCard"), $("airportPhoto"), p.airport, "Illustrative aviation photo", a.iata);
  setPhoto($("cityPhotoCard"), $("cityPhoto"), p.city, (a.city || "City") + " · illustrative photo", a.iata);
  $("airportPhotoCaption").textContent = p.airport ? "Illustrative photo · not this airport" : "No verified photo yet";
  $("cityPhotoCaption").textContent = p.city ? p.cityCaption : "No verified photo yet";
}

function renderWeather(a) {
  const w = demoWeather[a.iata];
  if (w) {
    setText({ temperature: w.temp + "°", condition: w.condition + " · demo conditions", weatherIcon: w.icon, wind: w.wind, visibility: w.visibility, ceiling: w.ceiling, metar: w.metar, metarText: w.metarText, weatherSub: "Conditions at the airport · sample report, not live" });
  } else {
    setText({ temperature: "—", condition: "Weather not connected yet", weatherIcon: "", wind: "—", visibility: "—", ceiling: "—", metar: "Not available yet", metarText: "Real METAR/TAF reports are planned for a later step.", weatherSub: "Conditions at the airport" });
  }
}

function updateClock() {
  if (!current) return;
  if (!current.tz) { $("localTime").textContent = "Not available"; $("localTime").classList.add("unknown"); $("localDate").textContent = ""; return; }
  const n = new Date();
  $("localTime").classList.remove("unknown");
  $("localTime").textContent = new Intl.DateTimeFormat("en-GB", { timeZone: current.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(n);
  $("localDate").textContent = new Intl.DateTimeFormat("en-US", { timeZone: current.tz, weekday: "short", month: "short", day: "numeric" }).format(n);
}

function renderOverview(a) {
  const flights = demoFlights[a.iata];
  if (!flights) {
    setText({ depCount: "—", arrCount: "—", delayCount: "—", cancelCount: "—", depFoot: "No flight data yet", arrFoot: "No flight data yet", delayFoot: "No flight data yet", cancelFoot: "No flight data yet", nextDeparture: "No flight data yet", nextDepartureTime: "", nextArrival: "No flight data yet", nextArrivalTime: "" });
    $("overviewNote").textContent = "Flight numbers appear here once a flight data source is connected.";
    return;
  }
  const s = flightStats(flights);
  setText({ depCount: s.departures, arrCount: s.arrivals, delayCount: s.delays, cancelCount: s.cancellations, delayFoot: "Across listed demo flights", cancelFoot: "Across listed demo flights" });
  $("depFoot").innerHTML = `<span class="good">${s.departuresOnTime} on time</span> · demo list`;
  $("arrFoot").innerHTML = `<span class="good">${s.arrivalsOnTime} on time</span> · demo list`;
  $("overviewNote").textContent = "A quick snapshot from the demo flight list.";
  const next = type => flights.find(f => f.type === type && f.status !== "Cancelled" && f.status !== "Landed");
  const d = next("departures"), r = next("arrivals");
  setText({ nextDeparture: d ? `${d.flight} · ${d.city}` : "None in demo list", nextDepartureTime: d?.scheduled || "", nextArrival: r ? `${r.flight} · ${r.city}` : "None in demo list", nextArrivalTime: r?.scheduled || "" });
}

function renderFlights() {
  if (!current) return;
  const all = demoFlights[current.iata] || [];
  const term = $("flightSearch").value.toLowerCase().trim(), status = $("statusFilter").value;
  const list = all.filter(f => (mode === "all" || f.type === mode) && (status === "all" || f.status === status) && [f.flight, f.airline, f.city, f.code, f.aircraft].join(" ").toLowerCase().includes(term));
  $("routeHeader").textContent = mode === "arrivals" ? "Origin" : mode === "all" ? "From / to" : "Destination";
  $("boardNote").textContent = all.length ? "Select any flight to open its aircraft and operational details." : "No flight data for this airport yet.";
  $("flightRows").innerHTML = list.map((f, i) => `<tr><td><div class="flight-main">${esc(f.flight)}</div><div class="flight-sub">${esc(f.airline)}</div></td><td><div class="flight-main">${esc(f.city)}</div><div class="flight-sub">${esc(f.code)} · ${esc(f.aircraft)}</div></td><td><div class="time">${esc(f.scheduled)}<small>Scheduled</small></div></td><td><div class="time">${esc(f.estimated)}<small>${f.status === "Landed" ? "Actual" : "Estimated"}</small></div></td><td><div class="flight-main">${esc(f.terminal)}</div><div class="flight-sub">Gate ${esc(f.gate)}</div></td><td><span class="status ${esc(f.status.toLowerCase())}">${esc(f.status)}</span></td><td><button class="row-action" title="Open flight details" aria-label="Open details for ${esc(f.flight)}" data-index="${all.indexOf(f)}">↗</button></td></tr>`).join("");
  const empty = $("emptyState");
  empty.hidden = list.length > 0;
  empty.textContent = all.length ? "No flights match your search." : `No flight data for ${current.iata} yet. Demo flights exist only for SEA; real flights come in a later step.`;
  $("flightRows").querySelectorAll("[data-index]").forEach(b => b.addEventListener("click", () => openFlight(all[Number(b.dataset.index)], b)));
}

// ---------- flight detail ----------
function openFlight(f, opener) {
  if (!f) return;
  setText({ detailTitle: f.flight + " · " + f.airline, fromCode: f.from, fromCity: f.fromCity, toCode: f.to, toCity: f.toCity, detailStatusText: f.status, detailAircraft: f.aircraft, detailManufacturer: f.manufacturer || "Not available", detailFlightNo: f.flight, detailAirline: f.airline, detailGate: f.terminal + " / " + f.gate });
  $("planePhoto").src = demoAircraftPhoto;
  $("planePhoto").alt = "Illustrative aircraft photo, not " + f.aircraft;
  $("detailStatus").textContent = f.status;
  $("detailStatus").className = "status " + f.status.toLowerCase();
  $("detailTiming").textContent = `Scheduled ${f.scheduled} · Estimated / actual ${f.estimated} · local airport time`;
  $("detailNote").textContent = `Sample route duration: ${f.duration || "not available"} · Approximate route distance: ${f.distance || "not available"}. Aircraft registration: not available in demo data.`;
  openModal("flightModal", opener, $("closeFlight"));
}

// ---------- modals ----------
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

// ---------- airport picker ----------
function openPicker() {
  if (!index) return;
  $("airportSearch").value = "";
  renderPicker();
  openModal("airportModal", document.activeElement, $("airportSearch"));
}

function optionHtml(a, i) {
  const sub = [a.city, a.country].filter(Boolean).join(", ");
  return `<button class="airport-option" role="option" id="opt-${i}" data-i="${i}" aria-selected="false"><span style="font-size:20px">${isFavorite(a) ? "★" : "✈"}</span><span><strong>${esc(a.name)}</strong><small>${esc(sub)}${a.icao ? " · " + esc(a.icao) : ""}</small></span><code>${esc(a.iata)}</code></button>`;
}

function renderPicker() {
  const q = $("airportSearch").value;
  let html = "";
  if (q.trim()) {
    pickerResults = searchAirports(index, q, 25);
    html = pickerResults.length ? pickerResults.map(optionHtml).join("") : `<div class="option-empty">No airport matches "${esc(q)}".</div>`;
  } else {
    const saved = favorites().map(c => index.byIata.get(c)).filter(Boolean);
    const demo = demoAirportCodes.map(c => index.byIata.get(c)).filter(a => a && !saved.includes(a));
    pickerResults = [...saved, ...demo];
    if (saved.length) html += `<div class="option-group">Saved airports</div>` + saved.map(optionHtml).join("");
    if (demo.length) html += `<div class="option-group">Demo airports</div>` + demo.map((a, i) => optionHtml(a, i + saved.length)).join("");
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

function choose(a) {
  if (!a) return;
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
}

// ---------- events ----------
$("chooseBtn").onclick = openPicker;
$("closeModal").onclick = () => closeModal("airportModal");
$("closeFlight").onclick = () => closeModal("flightModal");
for (const id of ["airportModal", "flightModal"]) $(id).addEventListener("click", e => { if (e.target === $(id)) closeModal(id); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeModal("flightModal"); closeModal("airportModal"); }
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
$("favoriteBtn").onclick = () => {
  if (!current) return;
  const list = favorites();
  const on = !list.includes(current.iata);
  store.set("favorites", on ? [...list, current.iata] : list.filter(c => c !== current.iata));
  updateFavorite();
  showToast(on ? current.iata + " saved" : current.iata + " removed from saved airports");
};
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
  b.classList.add("active");
  b.setAttribute("aria-pressed", "true");
  mode = b.dataset.mode;
  renderFlights();
});
$("flightSearch").addEventListener("input", renderFlights);
$("statusFilter").addEventListener("change", renderFlights);
$("refreshBtn").onclick = () => { if (current) { showAirport(current); showToast("Refreshed · flights and weather are still demo data"); } };
window.addEventListener("popstate", route);
setInterval(updateClock, 10000);

loadAirports();
