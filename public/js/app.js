import { indexAirports, findAirport, searchAirports, parseRoute, airportPath, airportLocation, TYPE_LABELS } from "./airports.js";
import { demoAircraftPhoto, demoFlights, demoAirportCodes } from "./demo-data.js";
import { boardStats, DELAY_THRESHOLD_MIN } from "./flight-model.js";
import { fetchFlights, fetchAircraft, fetchFlightStatus, aircraftFields, hhmm, here, other, statusView, updateTime, placeName, fmtDuration, nextFlight, ago, REFRESH_MS as FLIGHTS_REFRESH_MS } from "./flights.js";
import { getPhotos, creditHtml } from "./photos.js";
import { fetchWeather, iconFor, ageMinutes, ageText, timeLabel, dayTimeUtc, stripType, localHour, forecastSlots, fmtTemp, STALE_METAR_MIN, REFRESH_MS } from "./weather.js";

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
let flightState = { kind: "loading", flights: [] };
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
  loadFlights(a);
}

// Shows a photo with its credit, or the styled panel with a short note.
function setPhoto(which, photo, alt, code, note) {
  const card = $(which + "PhotoCard"), img = $(which + "Photo"), caption = $(which + "PhotoCaption");
  card.dataset.code = code;
  card.classList.toggle("no-photo", !photo);
  img.onload = () => card.classList.remove("no-photo");
  img.onerror = () => { card.classList.add("no-photo"); caption.textContent = "Photo couldn't be loaded"; };
  if (photo) {
    img.src = photo.src;
    img.alt = alt;
    caption.innerHTML = creditHtml(photo, esc);
  } else {
    img.removeAttribute("src");
    img.alt = "";
    caption.textContent = note;
  }
}

async function renderPhotos(a) {
  setPhoto("airport", null, "", a.iata, "Loading photo…");
  setPhoto("city", null, "", a.iata, "Loading photo…");
  let p;
  try {
    p = await getPhotos(a.iata);
  } catch (err) {
    console.error("Photo list failed to load", err);
    if (current !== a) return;
    setPhoto("airport", null, "", a.iata, "Photo list couldn't be loaded");
    setPhoto("city", null, "", a.iata, "Photo list couldn't be loaded");
    return;
  }
  if (current !== a) return; // user already switched airport
  const cityName = p.city?.name || a.city;
  $("cityPhotoTitle").textContent = cityName || "City not listed";
  setPhoto("airport", p.airport, "Photo of " + a.name, a.iata, "No freely licensed photo found");
  setPhoto("city", p.city?.photo, "Photo of " + cityName, a.iata, cityName ? "No freely licensed photo found" : "");
}

// quiet = background refresh: keep what is shown until the new answer arrives.
async function renderWeather(a, quiet = false) {
  if (!quiet) {
    setText({ temperature: "—", condition: "Loading weather…", weatherIcon: "", wind: "—", visibility: "—", ceiling: "—", metar: "Loading…", metarText: "—", taf: "Loading…", tafMeta: "", weatherSub: "Conditions at the airport", weatherSource: "" });
    $("condition").classList.remove("warn");
    $("forecastRow").innerHTML = "";
  }
  let res;
  try {
    res = await fetchWeather(a.iata);
  } catch (err) {
    console.error("Weather failed to load", err);
    if (current !== a) return;
    setText({ temperature: "—", condition: "Weather unavailable right now", weatherIcon: "", wind: "—", visibility: "—", ceiling: "—", metar: "Couldn't load the weather.", metarText: err.message, taf: "—", tafMeta: "" });
    $("condition").classList.add("warn");
    $("weatherSource").textContent = "Try the refresh button in a minute.";
    $("forecastRow").innerHTML = `<div class="forecast-empty">Forecast unavailable</div>`;
    return;
  }
  if (current !== a) return; // user already switched airport
  const { metar: m, taf: t, forecast: fc } = res.data;
  const hours = fc.status === "ok" ? fc.hours : [];
  const nowFc = hours[0];

  // Headline: the observed METAR; otherwise the forecast, clearly labelled.
  let condition, warn = false;
  if (m.status === "ok") {
    const age = ageMinutes(m.observedAt);
    condition = [m.condition || "Observed", m.flightCategory].filter(Boolean).join(" · ");
    if (age !== null && age > STALE_METAR_MIN) { condition += ` · report is ${ageText(age).replace(" ago", "")} old`; warn = true; }
    setText({ temperature: fmtTemp(m.tempC), weatherIcon: iconFor(m.icon, nowFc?.night), wind: m.wind || "Not reported", visibility: m.visibility || "Not reported", ceiling: m.ceiling || "Not reported" });
  } else {
    const why = m.status === "none" ? "no METAR station reporting" : "METAR unavailable right now";
    condition = nowFc ? `Forecast: ${nowFc.label || "—"} · ${why}` : why[0].toUpperCase() + why.slice(1);
    warn = m.status === "error";
    setText({ temperature: nowFc ? fmtTemp(nowFc.tempC) : "—", weatherIcon: nowFc ? iconFor(nowFc.icon, nowFc.night) : "", wind: "No report", visibility: "No report", ceiling: "No report" });
  }
  $("condition").textContent = condition;
  $("condition").classList.toggle("warn", warn);

  // Aviation weather panel.
  if (m.status === "ok") {
    setText({ metar: stripType(m.raw), metarText: m.summary || "—", weatherSub: [m.station, m.stationName, "observed " + timeLabel(m.observedAt, a.tz), ageText(ageMinutes(m.observedAt))].filter(Boolean).join(" · ") });
  } else {
    setText({ metar: m.status === "none" ? "No METAR station at this airport." : "Couldn't load the METAR.", metarText: m.reason || m.message || "—", weatherSub: "Conditions at the airport" });
  }
  if (t.status === "ok") {
    setText({ taf: stripType(t.raw), tafMeta: `Issued ${dayTimeUtc(t.issuedAt)} · valid ${dayTimeUtc(t.validFrom)} to ${dayTimeUtc(t.validTo)}` });
  } else {
    setText({ taf: t.status === "none" ? t.reason : "Couldn't load the TAF.", tafMeta: t.status === "error" ? t.message : "" });
  }

  // Next hours from MET Norway.
  $("forecastHead").textContent = "NEXT HOURS · FORECAST" + (a.tz ? "" : " · UTC");
  $("forecastRow").innerHTML = hours.length
    ? forecastSlots(hours).map(h => `<div class="forecast-slot" title="${esc(h.label || "")}"><small>${esc(localHour(h.time, a.tz))}</small><span aria-hidden="true">${iconFor(h.icon, h.night)}</span><strong>${esc(fmtTemp(h.tempC))}</strong></div>`).join("")
    : `<div class="forecast-empty">${esc(fc.status === "error" ? "Forecast unavailable right now" : fc.reason || "No forecast")}</div>`;

  const updated = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(res.receivedAt);
  $("weatherSource").innerHTML = `METAR/TAF: <a href="https://aviationweather.gov" target="_blank" rel="noopener">NOAA Aviation Weather Center</a> · Forecast: <a href="https://api.met.no/" target="_blank" rel="noopener">MET Norway</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> · Last updated ${updated} (your time)`
    + (res.stale ? `<br><span class="warn">Couldn't refresh (${esc(res.error)}). Showing data received at ${updated}.</span>` : "");
}

function updateClock() {
  if (!current) return;
  if (!current.tz) { $("localTime").textContent = "Not available"; $("localTime").classList.add("unknown"); $("localDate").textContent = ""; return; }
  const n = new Date();
  $("localTime").classList.remove("unknown");
  $("localTime").textContent = new Intl.DateTimeFormat("en-GB", { timeZone: current.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(n);
  $("localDate").textContent = new Intl.DateTimeFormat("en-US", { timeZone: current.tz, weekday: "short", month: "short", day: "numeric" }).format(n);
}

// ---------- flights ----------
// kind: "loading" | "live" (provider data, maybe stale) | "demo" | "none"
async function loadFlights(a, quiet = false) {
  if (!quiet) { flightState = { kind: "loading", flights: [] }; renderOverview(); renderFlights(); }
  let body;
  try {
    body = await fetchFlights(a.iata);
  } catch (err) {
    console.error("Flights failed to load", err);
    if (current !== a) return;
    flightState = { kind: "none", flights: [], message: "Couldn't load flights (" + err.message + "). Try the refresh button in a minute." };
    renderOverview(); renderFlights();
    return;
  }
  if (current !== a) return; // user already switched airport
  if (body.status === "unconfigured") {
    const demo = demoFlights[a.iata];
    flightState = demo ? { kind: "demo", flights: demo } : { kind: "none", flights: [], message: `Flight data is not connected yet. Demo flights exist only for SEA.` };
  } else if (body.board) {
    flightState = { kind: "live", flights: [...body.board.departures, ...body.board.arrivals], body };
  } else {
    flightState = { kind: "none", flights: [], message: body.notice || "Flight data is unavailable right now." };
  }
  renderOverview(); renderFlights();
}

// "15:04" in the airport's time zone (or UTC when unknown).
const airportClock = iso => new Intl.DateTimeFormat("en-GB", { timeZone: current?.tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) + (current?.tz ? "" : " UTC");

function renderOverview() {
  const { kind, flights, body } = flightState;
  const dash = { depCount: "—", arrCount: "—", delayCount: "—", cancelCount: "—", nextDepartureTime: "", nextArrivalTime: "" };
  if (kind === "loading" || kind === "none") {
    const t = kind === "loading" ? "Loading…" : "No flight data";
    setText({ ...dash, depFoot: t, arrFoot: t, delayFoot: t, cancelFoot: t, nextDeparture: t, nextArrival: t });
    $("overviewNote").textContent = kind === "loading" ? "Loading flights…" : flightState.message;
    $("updatedAt").textContent = kind === "loading" ? "" : "NO FLIGHT DATA";
    return;
  }
  const s = boardStats(flights);
  const scope = kind === "demo" ? "demo list" : "in this window";
  setText({ depCount: s.departures, arrCount: s.arrivals, delayCount: s.delays, cancelCount: s.cancellations, delayFoot: kind === "demo" ? "Across listed demo flights" : `${DELAY_THRESHOLD_MIN}+ min late or reported delayed`, cancelFoot: kind === "demo" ? "Across listed demo flights" : "Including possibly cancelled" });
  $("depFoot").innerHTML = `<span class="good">${s.departuresOnTime} on time</span> · ${scope}`;
  $("arrFoot").innerHTML = `<span class="good">${s.arrivalsOnTime} on time</span> · ${scope}`;
  if (kind === "demo") {
    $("overviewNote").textContent = "A quick snapshot from the demo flight list.";
    $("updatedAt").textContent = "DEMO DATA · NOT LIVE";
  } else {
    const b = body.board;
    $("overviewNote").textContent = `Passenger flights from ${airportClock(b.from)} to ${airportClock(b.to)} airport time.` + (b.live ? "" : " Schedule only: no live updates for this airport.");
    updateFlightAge();
  }
  const sorted = [...flights].sort((x, y) => hhmmKey(x).localeCompare(hhmmKey(y)));
  const d = nextFlight(sorted, "departure"), r = nextFlight(sorted, "arrival");
  const none = kind === "demo" ? "None in demo list" : "None in this window";
  setText({ nextDeparture: d ? `${d.number} · ${placeName(other(d).airport)}` : none, nextDepartureTime: d ? hhmm(here(d).scheduled) : "", nextArrival: r ? `${r.number} · ${placeName(other(r).airport)}` : none, nextArrivalTime: r ? hhmm(here(r).scheduled) : "" });
}

// "UPDATED 15:04 · 18 MIN AGO": when the board was fetched, kept current every minute.
function updateFlightAge() {
  const { kind, body } = flightState;
  if (kind !== "live") return;
  $("updatedAt").textContent = `UPDATED ${airportClock(body.board.fetchedAt)} · ${ago(body.board.fetchedAt).toUpperCase()}` + (body.stale ? " · OLD DATA" : "");
}

const hhmmKey = f => here(f).scheduled?.utc || here(f).scheduled?.local || "";

function renderFlights() {
  if (!current) return;
  const { kind, flights, body } = flightState;
  const want = { departures: "departure", arrivals: "arrival" }[mode];
  const term = $("flightSearch").value.toLowerCase().trim();

  // Status filter offers the statuses actually on the board.
  const sel = $("statusFilter"), chosen = sel.value;
  const labels = [...new Set(flights.map(f => statusView(f).label))].sort();
  sel.innerHTML = `<option value="all">All statuses</option>` + labels.map(l => `<option${l === chosen ? " selected" : ""}>${esc(l)}</option>`).join("");
  const status = labels.includes(chosen) ? chosen : "all";

  const list = flights
    .filter(f => !want || f.direction === want)
    .filter(f => status === "all" || statusView(f).label === status)
    .filter(f => [f.number, f.airline.name, placeName(other(f).airport), other(f).airport.iata, other(f).airport.name, f.aircraft.model, f.aircraft.registration].join(" ").toLowerCase().includes(term))
    .sort((x, y) => hhmmKey(x).localeCompare(hhmmKey(y)));
  $("routeHeader").textContent = mode === "arrivals" ? "Origin" : mode === "all" ? "From / to" : "Destination";

  $("flightsBadge").textContent = kind === "demo" ? "DEMO FLIGHTS" : kind === "live" ? (body.board.live ? "LIVE · AERODATABOX" : "SCHEDULE ONLY · AERODATABOX") : "FLIGHTS";
  const credit = `Flight data: <a href="https://aerodatabox.com/" target="_blank" rel="noopener">AeroDataBox</a>.`;
  const notice = kind === "live" && body.notice ? ` <span class="board-note-warn">${esc(body.notice)}${body.stale ? ` Showing the board from ${esc(airportClock(body.board.fetchedAt))}.` : ""}</span>` : "";
  $("boardNote").innerHTML = kind === "live" ? `Select any flight to open its details. ${credit}${notice}`
    : kind === "demo" ? "Demo flights, not live. Select any flight to open its details."
    : kind === "loading" ? "Loading flights…" : esc(flightState.message);

  $("flightRows").innerHTML = list.map(f => {
    const o = other(f), h = here(f), st = statusView(f), up = updateTime(f);
    const place = f.direction === "arrival" && mode === "all" ? "From " + placeName(o.airport) : f.direction === "departure" && mode === "all" ? "To " + placeName(o.airport) : placeName(o.airport);
    const sub = f.direction === "arrival" ? (h.baggageBelt ? "Belt " + h.baggageBelt : h.gate ? "Gate " + h.gate : "") : (h.gate ? "Gate " + h.gate : "Gate not listed");
    return `<tr><td><div class="flight-main">${esc(f.number)}</div><div class="flight-sub">${esc(f.airline.name || "")}</div></td><td><div class="flight-main">${esc(place)}</div><div class="flight-sub">${esc([o.airport.iata, f.aircraft.model].filter(Boolean).join(" · "))}</div></td><td><div class="time">${esc(hhmm(h.scheduled))}<small>Scheduled</small></div></td><td><div class="time">${esc(up.time)}<small>${esc(up.note)}</small></div></td><td><div class="flight-main">${esc(h.terminal || "—")}</div><div class="flight-sub">${esc(sub)}</div></td><td><span class="status ${st.cls}">${esc(st.label)}</span></td><td><button class="row-action" title="Open flight details" aria-label="Open details for ${esc(f.number)}" data-id="${esc(f.id)}">↗</button></td></tr>`;
  }).join("");
  const empty = $("emptyState");
  empty.hidden = list.length > 0;
  empty.textContent = kind === "loading" ? "Loading flights…"
    : kind === "none" ? flightState.message
    : flights.length ? "No flights match your search."
    : "No passenger flights listed in this time window.";
  $("flightRows").querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => openFlight(flights.find(f => f.id === b.dataset.id), b)));
}

// ---------- flight detail ----------
// Shows only what the provider supplied; everything else says "Not available".
let openedFlight = null; // the flight shown in the detail window
let openedAircraft = null; // its aircraft lookup result, once found

// The lookup knows the exact model and manufacturer better than the board.
function applyAircraft(a) {
  if (a?.manufacturer) setText({ detailManufacturer: a.manufacturer });
  if (a?.model) setText({ detailAircraft: a.model });
}

function fillFlight(f) {
  const NA = "Not available", h = here(f), st = statusView(f), up = updateTime(f);
  setText({
    detailTitle: [f.number, f.airline.name].filter(Boolean).join(" · "),
    fromCode: f.departure.airport.iata || "—", fromCity: placeName(f.departure.airport),
    toCode: f.arrival.airport.iata || "—", toCity: placeName(f.arrival.airport),
    detailStatusText: st.label, detailAircraft: f.aircraft.model || NA, detailManufacturer: f.aircraft.manufacturer || NA,
    detailFlightNo: f.number, detailAirline: f.airline.name || NA,
    detailGate: [h.terminal && "Terminal " + h.terminal, h.gate && "Gate " + h.gate, f.direction === "arrival" && h.baggageBelt && "Belt " + h.baggageBelt].filter(Boolean).join(" · ") || NA,
  });
  $("detailEyebrow").textContent = f.demo ? "FLIGHT DETAILS · DEMO DATA" : "FLIGHT DETAILS · AERODATABOX";
  $("detailStatus").textContent = st.label;
  $("detailStatus").className = "status " + st.cls;
  // The other end of the route, worded neutrally: we only know what the provider sent.
  const otherEnd = other(f), otherTime = otherEnd.revised || otherEnd.scheduled;
  const otherKind = otherEnd.revised ? "estimated or actual" : "scheduled";
  const otherWhere = otherEnd.airport.iata || placeName(otherEnd.airport);
  $("detailTiming").textContent = `Scheduled ${hhmm(h.scheduled)} · ${up.note} ${up.time} · local airport time` + (otherTime && !f.demo ? ` · ${f.direction === "departure" ? "Arrival at" : "Departure from"} ${otherWhere}: ${hhmm(otherTime)} local time (${otherKind})` : "");
  const dur = fmtDuration(f.scheduledDurationMinutes);
  $("detailNote").textContent = [
    `Great-circle distance: ${f.distanceKm !== null ? f.distanceKm.toLocaleString("en-US") + " km" : NA}`,
    `Scheduled flight time: ${dur || NA}`,
  ].join(" · ") + (f.demo ? ". Sample values (demo data)." : ".");
}

// kind: "this-aircraft" (found by registration), "representative" (board photo), "demo", or no photo.
function setPlanePhoto(p, kind, f) {
  const box = $("planePhoto").parentElement, img = $("planePhoto"), note = $("planePhotoNote");
  img.onerror = () => { box.classList.add("no-photo"); note.textContent = "Photo couldn't be loaded"; };
  if (kind === "demo") {
    box.classList.remove("no-photo");
    img.src = demoAircraftPhoto;
    img.alt = "Illustrative aircraft photo, not " + (f.aircraft.model || "this aircraft");
    note.textContent = "Illustrative photo · not this aircraft";
    return;
  }
  if (!p) {
    box.classList.add("no-photo");
    img.removeAttribute("src");
    img.alt = "";
    note.textContent = "No aircraft photo available";
    return;
  }
  box.classList.remove("no-photo");
  img.src = p.url;
  const by = [p.author, p.licence].filter(Boolean).map(esc).join(" · ");
  const credit = by ? " · " + (p.pageUrl ? `<a href="${esc(p.pageUrl)}" target="_blank" rel="noopener">${by}</a>` : by) : "";
  if (kind === "this-aircraft") {
    img.alt = "Photo of aircraft " + (f.aircraft.registration || "");
    note.innerHTML = `Photo of this aircraft (${esc(f.aircraft.registration || "")}) · matched automatically${credit}`;
  } else {
    img.alt = "Representative photo of a " + (f.aircraft.model || "similar aircraft");
    note.innerHTML = `Representative photo · may not be this aircraft${credit}`;
  }
}

const LOOKING = "Looking up…";
function setAircraftSection(a, note) {
  const fields = aircraftFields(a);
  setText(fields);
  for (const id of Object.keys(fields)) $(id).classList.toggle("unknown", fields[id] === "Not available" || fields[id] === LOOKING);
  $("aircraftNote").textContent = note || "";
}
const onlyReg = reg => ({ registration: reg, ageYears: null, seats: null, engines: null, engineType: null, deliveryDate: null, airline: null });

// Looks up the aircraft by registration (1 unit, stored 7 days on the server).
async function lookupAircraft(f) {
  const reg = f.aircraft.registration;
  if (f.demo) { setAircraftSection(null, "Demo flight: no aircraft lookup."); return; }
  if (!reg) { setAircraftSection(null, "The provider has not given this flight's registration (yet), so the aircraft can't be looked up."); return; }
  setText({ acReg: reg, acAge: LOOKING, acSeats: LOOKING, acEngines: LOOKING, acDelivered: LOOKING, acOperator: LOOKING });
  $("aircraftNote").textContent = "Looking up " + reg + "…";
  let body;
  try { body = await fetchAircraft(reg); }
  catch (err) { if (openedFlight === f) setAircraftSection(onlyReg(reg), "Couldn't look up the aircraft (" + err.message + ")."); return; }
  if (openedFlight !== f) return; // another flight was opened meanwhile
  const a = body.aircraft;
  if (!a) {
    setAircraftSection(onlyReg(reg), body.status === "ok" ? `AeroDataBox has no record of ${reg}.` : body.notice || "Aircraft details are unavailable right now.");
    return;
  }
  const looked = body.fetchedAt ? " Looked up " + body.fetchedAt.slice(0, 10) + "." : "";
  setAircraftSection(a, "Aircraft details: AeroDataBox." + looked + (body.stale ? " " + (body.notice || "") + " Showing an older lookup." : ""));
  openedAircraft = a;
  applyAircraft(a);
  if (a.photo) setPlanePhoto(a.photo, "this-aircraft", f);
}

function openFlight(f, opener) {
  if (!f) return;
  openedFlight = f;
  openedAircraft = null;
  fillFlight(f);
  setPlanePhoto(f.aircraft.photo, f.demo ? "demo" : "representative", f);
  $("checkRow").hidden = !!f.demo;
  $("checkFlightBtn").disabled = false;
  $("checkFlightNote").textContent = "Uses about 1% of the monthly free allowance.";
  openModal("flightModal", opener, $("closeFlight"));
  lookupAircraft(f);
}

// "Check this flight": current status of this one flight (2 units, stored 5 minutes).
$("checkFlightBtn").onclick = async () => {
  const f = openedFlight;
  if (!f || f.demo || !current) return;
  const btn = $("checkFlightBtn");
  btn.disabled = true;
  $("checkFlightNote").textContent = "Checking…";
  let body;
  try { body = await fetchFlightStatus(f, current.iata); }
  catch (err) { if (openedFlight === f) { $("checkFlightNote").textContent = "Couldn't check (" + err.message + ")."; btn.disabled = false; } return; }
  if (openedFlight !== f) return;
  btn.disabled = false;
  if (!body.flight) {
    $("checkFlightNote").textContent = body.status === "ok" ? "AeroDataBox has no status for this flight on this date." : body.notice || "Status unavailable right now.";
    return;
  }
  // Keep what the board knew about the aircraft where the status answer has nothing.
  const known = Object.fromEntries(Object.entries(body.flight.aircraft).filter(([, v]) => v !== null));
  const fresh = { ...body.flight, aircraft: { ...f.aircraft, ...known } };
  if (flightState.kind === "live") {
    flightState.flights = flightState.flights.map(x => (x.id === f.id ? fresh : x));
    renderOverview(); renderFlights();
  }
  openedFlight = fresh;
  fillFlight(fresh);
  applyAircraft(openedAircraft);
  $("checkFlightNote").textContent = `Status checked ${body.fetchedAt ? airportClock(body.fetchedAt) : ""} airport time` + (body.stale ? " (older answer)" : "") + ".";
};

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
$("refreshBtn").onclick = () => { if (current) { showAirport(current); showToast("Refreshed"); } };
setInterval(() => { if (current && document.visibilityState === "visible") loadFlights(current, true); }, FLIGHTS_REFRESH_MS);
// Every minute: refresh the age label and statuses that became overdue (no new request).
setInterval(() => {
  if (!current || flightState.kind !== "live" || document.visibilityState !== "visible") return;
  updateFlightAge();
  if (!$("flightModal").classList.contains("open")) { renderOverview(); renderFlights(); }
}, 60000);
window.addEventListener("popstate", route);
setInterval(updateClock, 10000);
setInterval(() => { if (current && document.visibilityState === "visible") renderWeather(current, true); }, REFRESH_MS);

loadAirports();
