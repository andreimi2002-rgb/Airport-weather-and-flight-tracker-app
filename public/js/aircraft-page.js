// The aircraft page, /aircraft/YR-ASA: photo, details, where it is now, its
// current flight and (only on request) its flights on one day.
import { indexAirports, airportPath } from "./airports.js";
import { fetchAircraft, fetchAircraftPhoto, fetchAircraftNow, fetchAircraftFlights, aircraftFields, liveFields, liveProgressPct, aircraftPath, hhmm, statusView, placeName, LIVE_FRESH_MS } from "./flights.js";
import { haversineKm, relative } from "./insights.js";
import { mountSearch } from "./search-ui.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const NA = "Not available";
const NOW_REFRESH_MS = 2 * 60 * 1000;
const fmtNum = n => n.toLocaleString("en-US");
const field = (label, value, mono) => `<div class="field"><small>${label}</small><strong class="${value == null || value === NA ? "na" : mono ? "mono" : ""}">${esc(value ?? NA)}</strong></div>`;

// Any registration format is accepted here (the search box is stricter, see asRegistration).
const fromUrl = (() => { try { return decodeURIComponent(location.pathname.split("/")[2] || "").trim().toUpperCase(); } catch { return ""; } })();
const reg = /^[A-Z0-9][A-Z0-9-]{1,9}$/.test(fromUrl) ? fromUrl : null;
let index = null, details = null, now = null, photo = null;

// The same search window as on the other pages (airports, airlines, routes, flights, aircraft).
mountSearch({ button: $("chooseBtn"), getIndex: () => index });

function fail(title, text) {
  $("statusTitle").textContent = title;
  $("statusText").textContent = text;
  $("statusView").hidden = false;
  $("acView").hidden = true;
}

async function start() {
  if (!reg) return fail("Not an aircraft registration", "Use an address like /aircraft/YR-ASA, or type a registration above.");
  $("acReg").textContent = reg;
  document.title = `${reg} — Airport Live`;
  $("statusView").hidden = true;
  $("acView").hidden = false;
  fillDates();
  // Airports (for route names and positions) and the three lookups run together.
  fetch("/data/airports.json").then(r => r.json()).then(j => { index = indexAirports(j); renderFlight(); renderHistory(); }).catch(() => {});
  fetchAircraftPhoto(reg).then(b => { photo = b.photo || null; renderPhoto(); }).catch(() => { renderPhoto(); });
  fetchAircraft(reg).then(b => { details = b; renderDetails(); renderPhoto(); }).catch(err => { details = { status: "error", notice: err.message }; renderDetails(); renderPhoto(); });
  await loadNow();
  setInterval(() => { if (!document.hidden) loadNow(); }, NOW_REFRESH_MS);
}

async function loadNow() {
  try { now = await fetchAircraftNow(reg); }
  catch (err) { now = { status: "error", notice: err.message }; }
  renderLive(); renderFlight();
  if (details) renderDetails(); // the Mode-S hex comes from the live data
}

const lookup = code => (code && index ? index.byIata.get(code) : null);

// ---------- photo ----------
function renderPhoto() {
  const box = $("acPhoto");
  const own = details?.aircraft?.photo;
  let img = "", note;
  if (photo?.url) {
    // Planespotters.net terms: photographer credit next to the photo, linked to the photo page.
    const credit = `${esc(photo.author || "Photographer unknown")} · Planespotters.net`;
    img = `<img src="${esc(photo.url)}" alt="Photo of aircraft ${esc(reg)}" onerror="this.parentElement.classList.add('no-photo')">`;
    note = `Photo of this aircraft · ${photo.pageUrl ? `<a href="${esc(photo.pageUrl)}" target="_blank" rel="noopener">${credit}</a>` : credit}`;
  } else if (own?.url) {
    const by = [own.author, own.licence].filter(Boolean).map(esc).join(" · ");
    img = `<img src="${esc(own.url)}" alt="Photo of aircraft ${esc(reg)}" onerror="this.parentElement.classList.add('no-photo')">`;
    note = `Photo of this aircraft · matched automatically${by ? " · " + (own.pageUrl ? `<a href="${esc(own.pageUrl)}" target="_blank" rel="noopener">${by}</a>` : by) : ""}`;
  } else note = photo === null && !details ? "Looking for a photo…" : "No photo of this aircraft found";
  box.classList.toggle("no-photo", !img);
  box.innerHTML = `${img}<span class="photo-note">${note}</span>`;
}

// ---------- details ----------
function renderDetails() {
  const a = details?.aircraft || null;
  const af = aircraftFields(a);
  const live = now?.aircraft;
  if (a?.model) {
    $("acModel").textContent = [a.model, a.airline].filter(Boolean).join(" · ");
    document.title = `${reg} · ${a.model} — Airport Live`;
  } else if (!live?.typeCode) $("acModel").textContent = details?.status === "ok" ? "Type not known" : "—";
  $("acDetailsNote").textContent = details?.status === "ok"
    ? (a ? "From AeroDataBox" + (details.fetchedAt ? " · looked up " + relative(details.fetchedAt) : "") : "AeroDataBox has no record of " + reg + ".")
    : details?.notice || "Details unavailable right now.";
  $("acDetails").innerHTML = [
    field("TYPE", a?.model || NA), field("MANUFACTURER", a?.manufacturer || NA), field("OPERATOR", af.acOperator),
    field("AGE", af.acAge), field("SEATS", af.acSeats), field("ENGINES", af.acEngines),
    field("DELIVERED", af.acDelivered), field("FIRST FLIGHT", a?.firstFlightDate || NA), field("SERIAL (MSN)", a?.serial || NA, true),
    field("ICAO TYPE", a?.modelCode || live?.typeCode || NA, true), field("MODE-S HEX", live?.hex ? live.hex.toUpperCase() : NA, true), field("STILL FLYING", a ? (a.active ? "Yes, active" : "Not listed as active") : NA),
  ].join("");
}

// ---------- live ----------
const isFresh = ac => ac && Date.now() - Date.parse(ac.seenAt) < LIVE_FRESH_MS;

function liveLabel(ac, route) {
  if (!isFresh(ac)) return { label: "Not in live data right now", cls: "landed" };
  const to = lookup(route?.to);
  if (ac.onGround) {
    const at = [lookup(route?.from), to].find(x => haversineKm(x, ac) !== null && haversineKm(x, ac) <= 15);
    return { label: at ? `On the ground at ${at.iata} (live data)` : "On the ground (live data)", cls: "boarding" };
  }
  const km = haversineKm(to, ac);
  if (km !== null && km <= 120 && ((ac.verticalRateFpm ?? 0) <= -300 || (ac.altitudeFt ?? 99999) < 10000)) return { label: `Approaching ${to.iata} (live data)`, cls: "landed" };
  return { label: "In the air (live data)", cls: "landed" };
}

function renderLive() {
  const ac = now?.aircraft;
  const st = liveLabel(ac, now?.route);
  $("acStatus").className = "status " + st.cls;
  $("acStatus").textContent = st.label;
  $("acSeen").textContent = ac ? `${ac.callsign ? ac.callsign + " · " : ""}seen ${relative(ac.seenAt)}` : "";
  $("acLive").innerHTML = isFresh(ac) ? liveFields(ac).map(([k, v]) => field(k, v)).join("") : "";
  $("acLiveNote").innerHTML = now?.status && now.status !== "ok" ? esc(now.notice || "Live data unavailable right now.")
    : ac ? `Live ADS-B data: <a href="https://adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> (ODbL), refreshed every 2 minutes.`
    : "Not transmitting now: parked, outside receiver coverage, or an aircraft that doesn't broadcast its position (common for older ATR 72s).";
  if (!details?.aircraft?.model && ac?.typeCode) $("acModel").textContent = ac.typeCode + " (from live data)";
}

const routeEnd = (code, icao, cls) => {
  const ap = lookup(code);
  return `<div class="route-end ${cls}"><div class="rc">${ap ? `<a href="${esc(airportPath(ap))}">${esc(ap.iata)}</a>` : esc(code || icao || "—")}</div><div class="rn">${esc(ap?.name || icao || NA)}</div><div class="rs">${esc([ap?.city, ap?.country].filter(Boolean).join(", "))}</div></div>`;
};

function renderFlight() {
  const box = $("acFlight");
  const ac = now?.aircraft, r = now?.route;
  if (!now) return;
  if (!isFresh(ac)) { box.innerHTML = `<div class="note" style="margin:0">No current flight: ${esc(reg)} is not in live data right now.</div>`; return; }
  if (!r) {
    box.innerHTML = `<div class="grid2">${field("CALLSIGN", ac.callsign || NA, true)}${field("ROUTE", "Not known")}</div><div class="note">${esc(now.routeNote || "This callsign has no known route.")}</div>`;
    return;
  }
  const A = lookup(r.from), B = lookup(r.to);
  const pct = ac.onGround ? (haversineKm(A, ac) <= 15 ? 0 : 100) : liveProgressPct(ac, A, B);
  const left = haversineKm(ac, B), total = haversineKm(A, B);
  const track = pct === null ? "" : `<div class="track" title="Live position from ADS-B data"><div class="done" style="width:${pct}%"></div><div class="pt on" style="left:0"></div><div class="pt ${pct >= 100 ? "on" : ""}" style="left:100%"></div>${ac.onGround ? "" : `<div class="plane" style="left:${pct}%">✈</div>`}</div>
    <div class="track-note"><span>${ac.onGround ? "On the ground" : left !== null ? `Live position · ${fmtNum(left)} km to ${esc(B?.iata || r.to)}` : "Live position"}</span><span>seen ${esc(relative(ac.seenAt))}</span></div>`;
  box.innerHTML = `<div class="route" style="margin-top:0">
      <div class="route-ends">${routeEnd(r.from, r.fromIcao, "from")}<div class="route-mid"><div class="dur">${esc(r.callsign)}</div>callsign${total !== null ? `<div>${fmtNum(total)} km</div>` : ""}</div>${routeEnd(r.to, r.toIcao, "to")}</div>
      ${track}
    </div>
    <div class="note">Route: the usual route of callsign ${esc(r.callsign)} (<a href="${esc(r.source?.url || "https://github.com/vradarserver/standing-data")}" target="_blank" rel="noopener">VRS standing data</a>, CC0), shown because the live position is on it. ${B ? `<a href="${esc(airportPath(B))}">Open the ${esc(B.iata)} board →</a>` : ""}</div>`;
}

// ---------- history (2 units, on request) ----------
let history = null, histLoading = false;

// Today (UTC) and the 6 days before it.
function fillDates() {
  const opts = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    opts.push(`<option value="${d}">${i === 0 ? "Today" : i === 1 ? "Yesterday" : new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${d}</option>`);
  }
  $("histDate").innerHTML = opts.join("");
}

$("histBtn").onclick = async () => {
  if (histLoading) return;
  histLoading = true;
  $("histBtn").disabled = true;
  $("histNote").textContent = "Loading…";
  try { history = await fetchAircraftFlights(reg, $("histDate").value); }
  catch (err) { history = { status: "error", notice: err.message, flights: [] }; }
  histLoading = false;
  $("histBtn").disabled = false;
  renderHistory();
};

function renderHistory() {
  if (!history) return;
  const list = history.flights || [];
  $("histNote").textContent = history.status !== "ok" ? history.notice || "Flight history unavailable right now."
    : `${list.length} flight${list.length === 1 ? "" : "s"} · AeroDataBox${history.fetchedAt ? " · loaded " + relative(history.fetchedAt) : ""}${history.stale ? " · older copy" : ""}`;
  if (history.status === "ok" && !list.length) { $("histList").innerHTML = `<div class="note">No flights of ${esc(reg)} found on this day.</div>`; return; }
  $("histList").innerHTML = list.map(f => {
    const st = statusView(f);
    const end = m => {
      const ap = lookup(m.airport.iata);
      const t = m.runway || m.revised;
      return `<div class="h-end"><b>${ap ? `<a href="${esc(airportPath(ap))}">${esc(m.airport.iata)}</a>` : esc(m.airport.iata || "—")}</b><span>${esc(placeName(m.airport))}</span><span class="mono">${esc(hhmm(m.scheduled))}${t && hhmm(t) !== hhmm(m.scheduled) ? ` → ${esc(hhmm(t))}` : ""}</span></div>`;
    };
    return `<div class="h-row"><div class="h-num"><b>${esc(f.number)}</b><span>${esc(f.airline?.name || "")}</span></div>${end(f.departure)}<div class="h-arrow" aria-hidden="true">→</div>${end(f.arrival)}<div class="h-st"><span class="status ${st.cls}">${esc(st.label)}</span></div></div>`;
  }).join("") + (list.length ? `<div class="note">Times are local at each airport (scheduled → actual or estimated).</div>` : "");
}

start();
