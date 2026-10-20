// Airline page, /airline/KLM (or /airline/KL): logo, codes, main airports and
// every known route, from the VRS callsign routes (free). No fleet list or
// flight history: those need a paid data plan.
import { $, esc, fmtNum, field, NA, startPage, fail } from "./page-common.js";
import { airportPath } from "./airports.js";
import { airlineForCode, airlinePath, routePath } from "./search.js";
import { anyLogo, logoTitle, airlineBadge } from "./logos.js";

const code = decodeURIComponent(location.pathname.split("/")[2] || "").trim().toUpperCase();
const { index, airlines } = await startPage().catch(err => { fail("Couldn't load the airport list", err.message); throw err; });
const airline = airlineForCode(airlines, code);
if (!airline) fail("Airline not found", `No airline with the code "${code}" in the open airline list. Use a 2-character IATA code (KL) or a 3-letter ICAO code (KLM).`);
else render();

async function render() {
  if (airline.icao && location.pathname !== airlinePath(airline)) history.replaceState(null, "", airlinePath(airline));
  document.title = `${airline.name} — Airport Live`;
  $("aName").textContent = airline.name;
  $("aCodes").innerHTML = [airline.iata && `IATA <b>${esc(airline.iata)}</b>`, airline.icao && `ICAO <b>${esc(airline.icao)}</b>`].filter(Boolean).join(" · ");
  const logo = anyLogo(airline);
  $("aLogo").innerHTML = logo ? `<img src="${esc(logo.src)}" alt="${esc(airline.name)} logo" title="${esc(logoTitle(logo))}">` : airlineBadge({ airline, number: airline.iata || airline.icao });
  // Other airlines that use the same IATA code (codes get reused).
  const same = airline.iata ? (airlines.byIata.get(airline.iata) || []).filter(a => a !== airline) : [];
  $("aAlso").innerHTML = same.length ? `The code ${esc(airline.iata)} is also listed for ${same.slice(0, 4).map(a => `<a href="${esc(airlinePath(a))}">${esc(a.name)}</a>`).join(", ")}.` : "";

  let routes = [];
  if (airline.icao) {
    try {
      const body = await (await fetch("/api/airline-routes/" + airline.icao)).json();
      if (body.status !== "ok") throw new Error(body.notice || body.error || "unavailable");
      routes = body.routes;
    } catch (err) { $("aHubs").innerHTML = $("aRoutes").innerHTML = `<div class="note">Route data is unavailable right now (${esc(err.message)}).</div>`; facts(null, null); return; }
  }
  // Unique airport pairs with their callsigns.
  const pairs = new Map(), airportCount = new Map();
  for (const [cs, from, to] of routes) {
    if (!from || !to || from === to) continue;
    const k = from + "-" + to;
    if (!pairs.has(k)) pairs.set(k, { from, to, callsigns: [] });
    pairs.get(k).callsigns.push(cs);
  }
  for (const p of pairs.values()) for (const c of [p.from, p.to]) airportCount.set(c, (airportCount.get(c) || 0) + 1);
  facts(pairs.size, airportCount.size);

  const hubs = [...airportCount].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = hubs[0]?.[1] || 1;
  $("aHubs").innerHTML = hubs.length ? hubs.map(([c, n]) => {
    const a = index.byIata.get(c);
    return `<div class="bar"><div class="bl"><span class="code">${esc(c)}</span>${a ? `<a href="${esc(airportPath(a))}">${esc(a.city || a.name)}</a>` : esc(c)}</div><div class="bn">${n} routes</div><div class="bt"><i style="width:${(n / max) * 100}%"></i></div></div>`;
  }).join("") : `<div class="note">No known routes for ${esc(airline.name)}${airline.icao ? "" : " (no ICAO code to look them up)"}.</div>`;

  const list = [...pairs.values()].map(p => ({ ...p, A: index.byIata.get(p.from), B: index.byIata.get(p.to) }))
    .sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  const LIMIT = 150;
  const show = () => {
    const n = $("aFilter").value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    const text = p => [p.from, p.to, p.A?.city, p.B?.city, p.A?.name, p.B?.name, p.A?.country, p.B?.country].join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const hits = n ? list.filter(p => text(p).includes(n)) : list;
    $("aFilterNote").textContent = hits.length > LIMIT ? `Showing ${LIMIT} of ${fmtNum(hits.length)} routes; type to narrow down.` : `${fmtNum(hits.length)} route${hits.length === 1 ? "" : "s"}`;
    $("aRoutes").innerHTML = hits.slice(0, LIMIT).map(p => `<a class="ar-row" href="${esc(routePath(p.from, p.to))}"><b class="mono">${esc(p.from)}</b><span>${esc(p.A?.city || p.A?.name || "")}</span><span class="ar-arrow" aria-hidden="true">→</span><b class="mono">${esc(p.to)}</b><span>${esc(p.B?.city || p.B?.name || "")}</span><small>${p.callsigns.length} callsign${p.callsigns.length === 1 ? "" : "s"}</small></a>`).join("");
  };
  $("aFilter").addEventListener("input", show);
  $("aRouteCount").textContent = pairs.size ? `${fmtNum(pairs.size)} ROUTES` : "";
  show();
}

function facts(routes, airports) {
  $("aFacts").innerHTML = [
    field("IATA CODE", airline.iata ? esc(airline.iata) : NA, true),
    field("ICAO CODE", airline.icao ? esc(airline.icao) : NA, true),
    field("KNOWN ROUTES", routes === null ? NA : fmtNum(routes)),
    field("AIRPORTS", airports === null ? NA : fmtNum(airports)),
  ].join("");
}
