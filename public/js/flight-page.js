// Flight page, /flight/KL1377 (flight number) or /flight/WZZ1AB (callsign):
// the callsign's usual route (VRS, free), the aircraft flying it now (adsb.lol,
// free) and, on request, today's status from AeroDataBox (2 units).
import { $, esc, fmtNum, field, NA, startPage, fail, clock } from "./page-common.js";
import { airportPath, airportLocation } from "./airports.js";
import { airlineForCode, airlinePath, routePath } from "./search.js";
import { airlineBadge } from "./logos.js";
import { haversineKm } from "./insights.js";
import { fetchLive, liveFields, liveProgressPct, aircraftPath, hhmm, statusView, placeName } from "./flights.js";

const raw = decodeURIComponent(location.pathname.split("/")[2] || "").trim().toUpperCase().replace(/\s+/g, "");
const m = raw.match(/^([A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})([0-9A-Z]{1,5})$/);
const { index, airlines } = await startPage().catch(err => { fail("Couldn't load the airport list", err.message); throw err; });
const airline = m ? airlineForCode(airlines, m[1]) : null;
if (!m) fail("Not a flight", "Use an address like /flight/KL1377, or search for a flight number.");
else if (!airline) fail("Airline not found", `No airline with the code "${m[1]}" in the open airline list.`);
else render();

async function render() {
  const tail = m[2], numeric = /^\d+[A-Z]?$/.test(tail);
  // Flight number (IATA code + digits) and the ICAO callsign. A callsign like
  // WZZ1AB is not a flight number: only the callsign is known then.
  const number = numeric && airline.iata ? `${airline.iata} ${tail.replace(/^0+(?=\d)/, "")}` : null;
  const callsign = airline.icao ? airline.icao + tail.replace(/^0+(?=\d)/, "") : null;
  const title = number || callsign || raw;
  document.title = `${title} · ${airline.name} — Airport Live`;
  const pill = `<span class="status landed" id="fPill">Checking live data…</span>`;
  $("fHead").innerHTML = `${airlineBadge({ airline, number: title })}<div><h2>${esc(title)}</h2><div class="sub"><a href="${esc(airlinePath(airline))}">${esc(airline.name)}</a>${callsign && number ? ` · callsign ${esc(callsign)}` : ""}</div></div>${pill}`;
  if (!number) $("fStatusNote").textContent = `${callsign} is a callsign, not a flight number, so the flight-status lookup (which needs the flight number) isn't available.`;

  // 1. Usual route of the callsign.
  let route = null;
  if (callsign) {
    try {
      const body = await (await fetch("/api/airline-routes/" + airline.icao)).json();
      const r = (body.routes || []).find(x => x[0] === callsign);
      if (r) route = { from: r[1], to: r[2], A: index.byIata.get(r[1]), B: index.byIata.get(r[2]) };
    } catch { /* shown as unknown */ }
  }
  // 2. Live aircraft.
  let live = null, liveNote = "";
  if (callsign) {
    try { const b = await fetchLive(callsign); live = b.aircraft; if (b.status !== "ok") liveNote = b.notice || ""; }
    catch (err) { liveNote = err.message; }
  }
  renderRoute(route, live, callsign);
  renderLive(live, liveNote, callsign, route);
  setupStatus(number, route);
}

function liveLabel(ac, route) {
  if (!ac || !(Date.now() - Date.parse(ac.seenAt) < 15 * 60000)) return "Not in live data right now";
  const B = route?.B, A = route?.A;
  const near = x => x && haversineKm(x, ac) !== null && haversineKm(x, ac) <= 15;
  if (ac.onGround) return near(B) ? "Landed (live data)" : near(A) ? ((ac.groundSpeedKt ?? 0) >= 5 ? `Taxiing at ${A.iata} (live data)` : `On the ground at ${A.iata} (live data)`) : "On the ground (live data)";
  const km = B ? haversineKm(B, ac) : null;
  return km !== null && km <= 120 && ((ac.verticalRateFpm ?? 0) <= -300 || (ac.altitudeFt ?? 99999) < 10000) ? `Approaching ${B.iata} (live data)` : "In the air (live data)";
}

function renderRoute(route, live, callsign) {
  $("fPill").textContent = liveLabel(live, route);
  if (!route) {
    $("fRoute").innerHTML = `<div class="note" style="margin:0">Route not known.</div>`;
    $("fRouteNote").textContent = callsign ? `No known route for callsign ${callsign} in the open VRS data. Many airlines fly under callsigns that differ from the flight number (e.g. Wizz Air "WZZ1AB"), so a flight number often can't be matched for free.` : "This airline has no ICAO code in the open airline list, so its route can't be looked up.";
    return;
  }
  const end = (a, code, cls) => `<div class="route-end ${cls}"><div class="rc">${a ? `<a href="${esc(airportPath(a))}">${esc(a.iata)}</a>` : esc(code)}</div><div class="rn">${esc(a?.name || NA)}</div><div class="rs">${esc(a ? airportLocation(a) : "")}</div></div>`;
  const km = route.A && route.B ? haversineKm(route.A, route.B) : null;
  const fresh = live && Date.now() - Date.parse(live.seenAt) < 15 * 60000;
  const pct = fresh && route.A && route.B ? (live.onGround ? (haversineKm(route.A, live) <= 15 ? 0 : 100) : liveProgressPct(live, route.A, route.B)) : null;
  const track = pct === null ? `<div class="track"><div class="pt on" style="left:0"></div><div class="pt" style="left:100%"></div></div>`
    : `<div class="track" title="Live position from ADS-B data"><div class="done" style="width:${pct}%"></div><div class="pt on" style="left:0"></div><div class="pt ${pct >= 100 ? "on" : ""}" style="left:100%"></div>${live.onGround ? "" : `<div class="plane" style="left:${pct}%">✈</div>`}</div><div class="track-note"><span>${live.onGround ? "On the ground" : `Live position · ${fmtNum(haversineKm(live, route.B))} km to ${esc(route.B.iata)}`}</span><span></span></div>`;
  $("fRoute").innerHTML = `<div class="route-ends">${end(route.A, route.from, "from")}<div class="route-mid">${km !== null ? `<div class="dur">${fmtNum(km)} km</div>great circle` : ""}</div>${end(route.B, route.to, "to")}</div>${track}`;
  $("fRouteNote").innerHTML = `Usual route of callsign ${esc(callsign)} in the open VRS data (CC0); it can differ on a given day. <a href="${esc(routePath(route.from, route.to))}">All airlines on ${esc(route.from)} → ${esc(route.to)} →</a>`;
}

function renderLive(ac, note, callsign, route) {
  if (!callsign) { $("fLive").innerHTML = `<div class="note">No callsign to look for.</div>`; return; }
  if (!ac) { $("fLive").innerHTML = `<div class="note">${esc(callsign)} is not in live data right now${note ? ` (${esc(note)})` : ""}. It may not be flying now, may use a different callsign today, or may not transmit its position (common for older ATR 72s).</div>`; return; }
  $("fLive").innerHTML = `<div class="grid2">${field("REGISTRATION", ac.registration ? `<a class="reg-link" href="${esc(aircraftPath(ac.registration))}">${esc(ac.registration)} →</a>` : NA, true)}${field("TYPE", ac.typeCode ? esc(ac.typeCode) : NA, true)}</div><div class="grid3" style="margin-top:8px">${liveFields(ac).map(([k, v]) => field(k, esc(v))).join("")}</div><div class="note">Seen ${esc(clock(null, ac.seenAt))} UTC · live ADS-B data: <a href="https://adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> (ODbL).${route ? "" : " The route is not known, so the progress can't be shown."}</div>`;
}

// ---------- today's status (AeroDataBox, 2 units, on request) ----------
function setupStatus(number, route) {
  const btn = $("fStatusBtn");
  if (!number) { btn.hidden = true; return; }
  btn.onclick = async () => {
    // Today at the departure airport when the route is known, else today in UTC.
    const tz = route?.A?.tz;
    const date = tz ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()) : new Date().toISOString().slice(0, 10);
    btn.disabled = true;
    $("fStatusMsg").textContent = "Loading…";
    let body;
    try { body = await (await fetch(`/api/flight-status/${encodeURIComponent(number.replace(/\s+/g, ""))}/${date}`)).json(); }
    catch (err) { $("fStatusMsg").textContent = "Couldn't load the status (" + err.message + ")."; btn.disabled = false; return; }
    btn.disabled = false;
    if (body.error || body.status !== "ok") { $("fStatusMsg").textContent = body.error || body.notice || "Status unavailable right now."; return; }
    const legs = body.flights || [];
    $("fStatusMsg").textContent = legs.length ? `${legs.length} leg${legs.length === 1 ? "" : "s"} on ${date} · AeroDataBox${body.stale ? " (older answer)" : ""}` : `AeroDataBox has no ${number} on ${date}.`;
    $("fStatus").innerHTML = legs.map(legHtml).join("");
  };
}

function legHtml(f) {
  const st = statusView(f);
  const t = (mv, label) => {
    const newer = mv.runway || mv.revised;
    const rows = [["Scheduled", hhmm(mv.scheduled)], [mv.runway ? (label === "dep" ? "Takeoff" : "Landing") : "Estimated", newer ? hhmm(newer) : NA], ["Terminal", mv.terminal || NA], [label === "dep" ? "Gate" : "Baggage belt", (label === "dep" ? mv.gate : mv.baggageBelt) || NA]];
    return rows.map(([k, v]) => `<div class="trow"><span>${k}</span><b class="${v === NA ? "na" : ""}">${esc(v)}</b></div>`).join("");
  };
  const reg = f.aircraft?.registration;
  return `<div class="leg">
    <div class="leg-head"><b class="mono">${esc(f.departure.airport.iata || "—")} → ${esc(f.arrival.airport.iata || "—")}</b><span>${esc(placeName(f.departure.airport))} → ${esc(placeName(f.arrival.airport))}</span><span class="status ${st.cls}">${esc(st.label)}</span></div>
    <div class="times"><div class="tcard"><h4>Departure · local</h4>${t(f.departure, "dep")}</div><div class="tcard"><h4>Arrival · local</h4>${t(f.arrival, "arr")}</div></div>
    <div class="note">Aircraft: ${esc(f.aircraft?.model || "not listed")}${reg ? ` · <a href="${esc(aircraftPath(reg))}">${esc(reg)}</a>` : ""}</div>
  </div>`;
}
