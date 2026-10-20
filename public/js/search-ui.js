// The search window (command palette) shared by every page: airports,
// airlines, routes, flights and aircraft (search.js). Opens with the search
// button, "/" or Ctrl/Cmd+K; arrows + Enter or a click to go; Esc closes.
import { searchAll, indexAirlines } from "./search.js";
import { anyLogo, loadLogos } from "./logos.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtClock = tz => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); } catch { return ""; } };
const fmtNum = n => Number(n || 0).toLocaleString("en-US");

let airlinesP = null;
export const loadAirlines = () => (airlinesP ??= fetch("/data/airlines.json").then(r => (r.ok ? r.json() : null)).then(j => (j ? indexAirlines(j) : null)).catch(() => null));

const PLACEHOLDER = "Airport, airline, route (CDG-LAX), flight (KL1377) or aircraft (YR-ASA)";
const MODAL = `<div class="modal-backdrop" id="airportModal" role="dialog" aria-modal="true" aria-labelledby="airportModalTitle"><div class="modal airport-modal"><h2 id="airportModalTitle" class="sr-only">Search</h2><div class="palette-input"><span aria-hidden="true">⌕</span><input class="modal-search" id="airportSearch" type="search" placeholder="${PLACEHOLDER}" aria-label="Search airports, airlines, routes, flights and aircraft" aria-controls="airportOptions" autocomplete="off" spellcheck="false"><button class="kbd-btn" id="closeModal" aria-label="Close">esc</button></div><div class="airport-options" id="airportOptions" role="listbox" aria-label="Results"></div></div></div>`;

const ARROW = `<span aria-hidden="true">→</span>`;
function airlineIcon(a) {
  const logo = anyLogo({ iata: a.iata, icao: a.icao, name: a.name });
  return logo ? `<span class="ao-ic ao-logo"><img src="${esc(logo.src)}" alt="" loading="lazy"></span>` : `<span class="ao-ic">✈</span>`;
}

// One result row. kind decides the icon, text and the small tag on the right.
export function resultHtml(r, i, { isFavorite = () => false } = {}) {
  const row = (icon, title, sub, tag) => `<button class="airport-option" role="option" id="opt-${i}" data-i="${i}" aria-selected="false">${icon}<span class="ao-tx"><strong>${title}</strong><small>${sub}</small></span><code>${tag}</code></button>`;
  if (r.kind === "airport") {
    const a = r.airport, fav = isFavorite(a);
    const sub = [a.city, a.country].filter(Boolean).join(", ");
    return row(`<span class="ao-ic${fav ? " fav" : ""}">${fav ? "★" : "✈"}</span>`, esc(a.name), `${esc(sub)}${a.icao ? " · " + esc(a.icao) : ""}${a.tz ? " · " + fmtClock(a.tz) + " local" : ""}`, esc(a.iata));
  }
  if (r.kind === "airline") {
    const a = r.airline;
    return row(airlineIcon(a), esc(a.name), [a.iata && "IATA " + esc(a.iata), a.icao && "ICAO " + esc(a.icao), a.routes ? fmtNum(a.routes) + " known routes" : "no known routes"].filter(Boolean).join(" · "), "AIRLINE");
  }
  if (r.kind === "route") {
    return row(`<span class="ao-ic">⇄</span>`, `${esc(r.from.iata)} ${ARROW} ${esc(r.to.iata)}`, `${esc(r.from.city || r.from.name)} ${ARROW} ${esc(r.to.city || r.to.name)} · airlines, distance, weather`, "ROUTE");
  }
  if (r.kind === "flight") {
    return row(airlineIcon(r.airline), `Flight ${esc(r.code)} ${esc(r.number)}`, `${esc(r.airline.name)} · route, live position and status`, "FLIGHT");
  }
  if (r.kind === "aircraft") return row(`<span class="ao-ic">✈</span>`, `Aircraft ${esc(r.reg)}`, "Photo, details and where it is now", "REG");
  return "";
}

// button: element that opens the search. getIndex(): the airport index (or null while loading).
// onAirport(a): what choosing an airport does (default: open its page).
// suggestions(): [{ title, airports }] shown before anything is typed.
export function mountSearch({ button, getIndex, onAirport = null, suggestions = () => [], isFavorite = () => false }) {
  if (!document.getElementById("airportModal")) document.body.insertAdjacentHTML("beforeend", MODAL);
  const $ = id => document.getElementById(id);
  const modal = $("airportModal"), input = $("airportSearch"), box = $("airportOptions");
  input.placeholder = PLACEHOLDER;
  let results = [], active = -1, airlines = null, opener = null;

  function render() {
    const index = getIndex();
    const q = input.value.trim();
    let html = "";
    if (q && index) {
      results = searchAll(q, { index, airlines });
      html = results.length ? results.map((r, i) => resultHtml(r, i, { isFavorite })).join("") : `<div class="option-empty">Nothing matches "${esc(q)}". Try an airport code (OTP), an airline (Wizz), a route (CDG-LAX), a flight (KL1377) or a registration (YR-ASA).</div>`;
    } else {
      results = [];
      for (const g of suggestions()) {
        if (!g.airports.length) continue;
        html += `<div class="option-group">${esc(g.title)}</div>` + g.airports.map(a => { results.push({ kind: "airport", airport: a, href: "/airport/" + a.iata }); return resultHtml(results.at(-1), results.length - 1, { isFavorite }); }).join("");
      }
      html += `<div class="option-hint">Search airports, airlines, routes (CDG-LAX), flights (KL1377) or aircraft (YR-ASA).</div>`;
    }
    box.innerHTML = html;
    active = q && results.length ? 0 : -1;
    highlight();
  }
  function highlight() {
    box.querySelectorAll(".airport-option").forEach(el => {
      const on = Number(el.dataset.i) === active;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on);
      if (on) el.scrollIntoView({ block: "nearest" });
    });
    if (active >= 0) input.setAttribute("aria-activedescendant", "opt-" + active); else input.removeAttribute("aria-activedescendant");
  }
  function open() {
    if (!getIndex()) return;
    opener = document.activeElement;
    input.value = "";
    render();
    modal.classList.add("open");
    input.focus();
    // Airlines arrive separately (small file); results update when they do.
    if (!airlines) Promise.all([loadAirlines(), loadLogos()]).then(([a]) => { airlines = a; if (modal.classList.contains("open") && input.value.trim()) render(); });
  }
  function close() {
    if (!modal.classList.contains("open")) return;
    modal.classList.remove("open");
    if (opener && document.contains(opener)) opener.focus();
  }
  function choose(r) {
    if (!r) return;
    if (r.kind === "airport" && onAirport) { close(); onAirport(r.airport); return; }
    location.href = r.href;
  }

  button?.addEventListener("click", open);
  $("closeModal").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  input.addEventListener("input", render);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active >= 0 ? active : 0]);
    }
  });
  box.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) choose(results[Number(b.dataset.i)]); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal.classList.contains("open")) { close(); return; }
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
    if (!typing && (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey)))) { e.preventDefault(); open(); }
  });
  return { open, close };
}
