// "My flights": flights the person follows (☆ in the flight drawer), kept in
// this browser only, shown in a strip under the header on every page with a
// live status from ADS-B (the same free, shared answers the boards use; no
// flight-data units). A followed flight is dropped a day after its arrival.
import { statusView, hhmm, matchBoardLive, liveStatus, fetchAirportLive } from "./flights.js";
import { airlineBadge } from "./logos.js";

const KEY = "airportLive.myFlights";
const MAX = 20;
const KEEP_AFTER_MS = 24 * 3600 * 1000;
const LIVE_MS = 8 * 60 * 1000;
export const slugOf = f => String(f.number).replace(/\s+/g, "").toUpperCase() + "-" + (f.direction === "departure" ? "d" : "a");
const idOf = f => [f.number, f.departure?.scheduled?.utc || f.departure?.scheduled?.local || ""].join("|");
const T = m => Date.parse((m?.runway || m?.revised || m?.scheduled)?.utc);

function read() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
function write(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode: not saved */ } }

// Flights whose (scheduled) arrival is more than a day ago are dropped.
export function prune(list, now = Date.now()) {
  return list.filter(x => { const t = T(x.flight.arrival) || T(x.flight.departure); return !Number.isFinite(t) || now - t < KEEP_AFTER_MS; });
}
export const followed = () => prune(read());
export const isFollowed = f => followed().some(x => x.id === idOf(f));

// board: the airport whose board the flight came from (its drawer link).
export function toggleFollow(f, board) {
  const list = followed();
  const id = idOf(f);
  const on = !list.some(x => x.id === id);
  const next = on ? [...list, { id, board, savedAt: new Date().toISOString(), flight: f }].slice(-MAX) : list.filter(x => x.id !== id);
  write(next);
  window.dispatchEvent(new Event("myflights"));
  return on;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The strip under the header. getIndex(): airport index (for live positions), or null.
export function mountMyFlights({ getIndex }) {
  const header = document.querySelector(".topbar");
  if (!header || document.getElementById("myFlights")) return;
  header.insertAdjacentHTML("afterend", `<nav class="myflights" id="myFlights" aria-label="My flights" hidden></nav>`);
  const box = document.getElementById("myFlights");
  const live = new Map(); // id -> live status

  function render() {
    const list = followed().sort((a, b) => (T(a.flight.departure) || 0) - (T(b.flight.departure) || 0));
    box.hidden = !list.length;
    if (!list.length) return;
    box.innerHTML = `<span class="mf-title">My flights</span>` + list.map(x => {
      const f = x.flight, st = statusView(f, Date.now(), live.get(x.id));
      const dep = f.departure, arr = f.arrival;
      const href = `/airport/${encodeURIComponent(x.board)}?flight=${encodeURIComponent(slugOf(f))}`;
      return `<span class="mf-chip"><a href="${esc(href)}" title="Open ${esc(f.number)}">${airlineBadge(f)}<b>${esc(f.number)}</b><span class="mf-route">${esc(dep.airport.iata || "")} → ${esc(arr.airport.iata || "")}</span><span class="mf-time">${esc(hhmm(dep.scheduled))}</span><span class="status ${st.cls}">${esc(st.label)}</span></a><button type="button" class="mf-x" data-id="${esc(x.id)}" aria-label="Stop following ${esc(f.number)}">×</button></span>`;
    }).join("");
  }

  // Live statuses: one shared answer per airport involved (origin and destination).
  async function refreshLive() {
    const index = getIndex();
    const list = followed();
    const now = Date.now();
    // Only flights around their travel time (1 h before departure to 1 h after arrival).
    const active = list.filter(x => { const d = T(x.flight.departure), a = T(x.flight.arrival); return Number.isFinite(d) && now > d - 3600000 && (!Number.isFinite(a) || now < a + 3600000); });
    if (!index || !active.length || document.visibilityState !== "visible") return;
    const codes = [...new Set(active.flatMap(x => [x.flight.departure.airport.iata, x.flight.arrival.airport.iata]).filter(Boolean))];
    const answers = new Map(await Promise.all(codes.map(async c => [c, await fetchAirportLive(c).catch(() => null)])));
    for (const x of active) {
      const f = x.flight, from = f.departure.airport.iata, to = f.arrival.airport.iata;
      // Match as a departure from the origin, else as an arrival at the destination.
      const asDep = { ...f, id: x.id, direction: "departure" }, asArr = { ...f, id: x.id, direction: "arrival" };
      const ac = matchBoardLive([asDep], answers.get(from)?.aircraft || [], from, now).get(x.id) || matchBoardLive([asArr], answers.get(to)?.aircraft || [], to, now).get(x.id);
      const st = ac && liveStatus(f, ac, index.byIata.get(from), index.byIata.get(to), now);
      if (st) live.set(x.id, st);
    }
    render();
  }

  box.addEventListener("click", e => {
    const b = e.target.closest(".mf-x");
    if (!b) return;
    const x = followed().find(y => y.id === b.dataset.id);
    if (x) toggleFollow(x.flight, x.board);
  });
  window.addEventListener("myflights", render);
  window.addEventListener("storage", e => { if (e.key === KEY) render(); });
  render();
  refreshLive();
  setInterval(refreshLive, LIVE_MS);
  setInterval(render, 60 * 1000); // overdue labels, dropped flights
  return { render, refreshLive };
}
