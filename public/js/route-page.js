// Route page, /route/CDG-LAX: the two airports, distance and time difference,
// airlines known to fly it (VRS callsign routes, free), aircraft on it now near
// either airport (adsb.lol, free), today's flights from the departure board
// (AeroDataBox, on request) and the weather at both ends.
import { $, esc, fmtNum, field, NA, startPage, fail, timeDifference, clock, miniWeather } from "./page-common.js";
import { airportPath, airportLocation } from "./airports.js";
import { airlinePath, routePath } from "./search.js";
import { airlineBadge } from "./logos.js";
import { haversineKm } from "./insights.js";
import { fetchFlights, fetchAirportLive, liveFields, hhmm, statusView, aircraftPath } from "./flights.js";

const [fromCode, toCode] = (decodeURIComponent(location.pathname.split("/")[2] || "").toUpperCase().match(/^([A-Z0-9]{3,4})-([A-Z0-9]{3,4})$/) || []).slice(1);

const { index, airlines } = await startPage().catch(err => { fail("Couldn't load the airport list", err.message); throw err; });
const find = c => (c?.length === 4 ? index.byIcao.get(c) : index.byIata.get(c)) || null;
const A = find(fromCode), B = find(toCode);
if (!fromCode) fail("Not a route", "Use an address like /route/CDG-LAX, or search for two airports.");
else if (!A || !B) fail("Airport not found", `${!A ? fromCode : toCode} is not in the airport list. Use 3-letter (IATA) or 4-letter (ICAO) codes.`);
else render();

function render() {
  if (location.pathname !== routePath(A.iata, B.iata)) history.replaceState(null, "", routePath(A.iata, B.iata));
  document.title = `${A.iata} → ${B.iata} · ${A.city || A.name} to ${B.city || B.name} — Airport Live`;
  const end = (a, cls) => `<div class="route-end ${cls}"><div class="rc"><a href="${esc(airportPath(a))}">${esc(a.iata)}</a></div><div class="rn">${esc(a.name)}</div><div class="rs">${esc(airportLocation(a))}</div></div>`;
  const km = haversineKm(A, B);
  $("rEnds").innerHTML = `${end(A, "from")}<div class="route-mid">${km !== null ? `<div class="dur">${fmtNum(km)} km</div>great circle` : ""}</div>${end(B, "to")}`;
  $("rSwap").href = routePath(B.iata, A.iata);
  $("rSwap").textContent = `⇄ ${B.iata} → ${A.iata}`;
  renderFacts(null);
  loadAirlines();
  loadLive();
  Promise.all([miniWeather(A), miniWeather(B)]).then(([a, b]) => { $("rWx").innerHTML = a + b; });
  $("rTodayNote").textContent = `${A.iata} → ${B.iata} departures on the ${A.iata} flight board (AeroDataBox, next ~10 hours). Loading may use 2 of the 400 monthly units if the ${A.iata} board isn't stored already.`;
  $("rTodayBtn").textContent = `Load today's ${A.iata} → ${B.iata} flights`;
  $("rTodayBtn").onclick = loadToday;
}

function renderFacts(airlineCount) {
  const km = haversineKm(A, B);
  $("rFacts").innerHTML = [
    field("DISTANCE", km !== null ? `${fmtNum(km)} km · ${fmtNum(Math.round(km * 0.539957))} nm` : NA),
    field("TIME DIFFERENCE", esc(timeDifference(A.tz, B.tz) || NA)),
    field("LOCAL TIME", `${esc(A.iata)} ${esc(clock(A.tz))} · ${esc(B.iata)} ${esc(clock(B.tz))}`),
    field("KNOWN AIRLINES", airlineCount === null ? "…" : String(airlineCount)),
  ].join("");
}

// ---------- airlines (VRS route index, one small file per first letter) ----------
async function loadAirlines() {
  let callsigns = [];
  try {
    const shard = await (await fetch(`/data/routes/${A.iata[0]}.json`)).json();
    callsigns = shard[A.iata]?.[B.iata] || [];
  } catch { $("rAirlines").innerHTML = `<div class="note">Route data is unavailable right now.</div>`; return; }
  const groups = new Map();
  for (const cs of callsigns) {
    const icao = cs.slice(0, 3);
    if (!groups.has(icao)) groups.set(icao, []);
    groups.get(icao).push(cs);
  }
  renderFacts(groups.size);
  $("rAirCount").textContent = groups.size ? `${groups.size} AIRLINE${groups.size === 1 ? "" : "S"} · ${callsigns.length} CALLSIGNS` : "";
  if (!groups.size) {
    $("rAirlines").innerHTML = `<div class="note">No airline is known to fly ${esc(A.iata)} → ${esc(B.iata)} in the open route data. That doesn't prove nobody does: the data is crowd-sourced and incomplete. <a href="${esc(routePath(B.iata, A.iata))}">Try ${esc(B.iata)} → ${esc(A.iata)}</a>.</div>`;
    return;
  }
  const rows = [...groups].map(([icao, list]) => {
    const al = airlines?.byIcao.get(icao) || { name: icao, icao, iata: null };
    // A callsign that is the airline code + digits is also the flight number (e.g. AFR66 = AF 66).
    const chips = list.slice(0, 14).map(cs => {
      const tail = cs.slice(3);
      return /^\d+$/.test(tail) && al.iata
        ? `<a class="cs-chip" href="/flight/${esc(al.iata)}${esc(tail)}" title="Callsign ${esc(cs)}">${esc(al.iata)} ${esc(tail)}</a>`
        : `<a class="cs-chip mono" href="/flight/${esc(cs)}" title="Callsign (not the flight number)">${esc(cs)}</a>`;
    }).join("") + (list.length > 14 ? `<span class="cs-more">+${list.length - 14} more</span>` : "");
    return { n: list.length, html: `<div class="ra-row">${airlineBadge({ airline: { name: al.name, iata: al.iata, icao: al.icao }, number: icao })}<div class="ra-main"><a class="ra-name" href="${esc(airlinePath(al))}">${esc(al.name)}</a><div class="ra-codes">${[al.iata, icao].filter(Boolean).map(esc).join(" · ")}</div></div><div class="ra-chips">${chips}</div></div>` };
  }).sort((x, y) => y.n - x.n);
  $("rAirlines").innerHTML = rows.map(r => r.html).join("");
}

// ---------- live aircraft (free; the same stored answers as the airport boards) ----------
function liveLabel(ac) {
  const near = x => haversineKm(x, ac) !== null && haversineKm(x, ac) <= 15;
  if (ac.onGround) return near(B) ? "Landed (live data)" : near(A) ? ((ac.groundSpeedKt ?? 0) >= 5 ? `Taxiing at ${A.iata} (live data)` : `On the ground at ${A.iata} (live data)`) : "On the ground (live data)";
  const km = haversineKm(B, ac);
  return km !== null && km <= 120 && ((ac.verticalRateFpm ?? 0) <= -300 || (ac.altitudeFt ?? 99999) < 10000) ? `Approaching ${B.iata} (live data)` : "In the air (live data)";
}
async function loadLive() {
  const answers = await Promise.all([A, B].map(x => fetchAirportLive(x.iata).catch(() => null)));
  const seen = new Map();
  for (const body of answers) for (const ac of body?.aircraft || []) if (ac.from === A.iata && ac.to === B.iata) seen.set(ac.hex || ac.callsign, ac);
  const list = [...seen.values()];
  if (answers.every(b => !b || b.status !== "ok")) { $("rLive").innerHTML = `<div class="note">Live data is unavailable right now${answers.find(b => b?.notice) ? " (" + esc(answers.find(b => b?.notice).notice) + ")" : ""}.</div>`; return; }
  if (!list.length) { $("rLive").innerHTML = `<div class="note">No aircraft on ${esc(A.iata)} → ${esc(B.iata)} near either airport right now. Aircraft further away (mid-route) or not transmitting aren't seen.</div>`; return; }
  $("rLive").innerHTML = list.map(ac => {
    const left = haversineKm(ac, B);
    return `<div class="rl-row"><div class="rl-id"><b class="mono">${esc(ac.callsign)}</b>${ac.registration ? `<a class="mono" href="${esc(aircraftPath(ac.registration))}">${esc(ac.registration)}</a>` : ""}<span>${esc(ac.typeCode || "")}</span></div><span class="status landed">${esc(liveLabel(ac))}</span><div class="grid3">${liveFields(ac).map(([k, v]) => field(k, esc(v))).join("")}</div><div class="note">${left !== null ? `${fmtNum(left)} km to ${esc(B.iata)} · ` : ""}seen ${esc(new Date(ac.seenAt).toISOString().slice(11, 16))} UTC</div></div>`;
  }).join("") + `<div class="note">Live ADS-B data: <a href="https://adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> (ODbL); routes from the VRS standing data.</div>`;
}

// ---------- today's flights (AeroDataBox board of the departure airport, on request) ----------
async function loadToday() {
  $("rTodayBtn").disabled = true;
  $("rTodayStatus").textContent = "Loading…";
  let body;
  try { body = await fetchFlights(A.iata); }
  catch (err) { $("rTodayStatus").textContent = "Couldn't load flights (" + err.message + ")."; $("rTodayBtn").disabled = false; return; }
  $("rTodayBtn").disabled = false;
  if (!body.board) { $("rTodayStatus").textContent = body.notice || "Flight data is unavailable right now."; return; }
  const list = body.board.departures.filter(f => f.arrival.airport.iata === B.iata);
  $("rTodayStatus").textContent = `${list.length} flight${list.length === 1 ? "" : "s"} · ${A.iata} board from ${clock(A.tz, body.board.fetchedAt)} ${A.tz ? "local time" : "UTC"}${body.stale ? " (older copy)" : ""}`;
  $("rTodayList").innerHTML = list.length ? list.map(f => {
    const st = statusView(f);
    const t = f.departure.revised || f.departure.runway;
    return `<div class="h-row"><div class="h-num"><b>${airlineBadge(f)} <a href="/flight/${esc(f.number.replace(/\s+/g, ""))}">${esc(f.number)}</a></b><span>${esc(f.airline?.name || "")}</span></div><div class="h-end"><b>${esc(A.iata)}</b><span class="mono">${esc(hhmm(f.departure.scheduled))}${t && hhmm(t) !== hhmm(f.departure.scheduled) ? " → " + esc(hhmm(t)) : ""}</span></div><div class="h-arrow" aria-hidden="true">→</div><div class="h-end"><b>${esc(B.iata)}</b><span class="mono">${esc(hhmm(f.arrival.scheduled))}</span></div><div class="h-st"><span class="status ${st.cls}">${esc(st.label)}</span></div></div>`;
  }).join("") + `<div class="note">Times are local at each airport.</div>` : `<div class="note">No ${esc(A.iata)} → ${esc(B.iata)} departures on the ${esc(A.iata)} board right now (it covers about the next 10 hours).</div>`;
}
