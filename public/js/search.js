// Universal search: what the text in the search box can mean, and where it
// leads. Pure functions (tested); the search window is search-ui.js.
//   OTP, Heathrow, Cluj      -> airport        /airport/OTP
//   Wizz, W6, WZZ            -> airline        /airline/WZZ
//   CDG-LAX, CDG LAX, Paris to Los Angeles -> route /route/CDG-LAX
//   KL1377, KL 1377, KLM1377 -> flight         /flight/KL1377
//   YR-ASA                   -> aircraft       /aircraft/YR-ASA
import { searchAirports, airportPath } from "./airports.js";
import { asRegistration, aircraftPath } from "./flights.js";

const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// public/data/airlines.json -> { list, byIcao, byIata (code -> airlines, most routes first) }
export function indexAirlines(data) {
  const f = Object.fromEntries((data?.fields || []).map((k, i) => [k, i]));
  const list = (data?.airlines || []).map(r => ({ name: r[f.name], icao: r[f.icao] || null, iata: r[f.iata] || null, routes: r[f.routes] || 0 }));
  const byIcao = new Map(), byIata = new Map();
  for (const a of list) {
    if (a.icao && !byIcao.has(a.icao)) byIcao.set(a.icao, a);
    if (a.iata) byIata.set(a.iata, [...(byIata.get(a.iata) || []), a]);
  }
  for (const l of byIata.values()) l.sort((x, y) => y.routes - x.routes);
  return { list, byIcao, byIata };
}

export const airlinePath = a => "/airline/" + encodeURIComponent(a.icao || a.iata);
export const routePath = (from, to) => `/route/${from}-${to}`;
// Flight numbers keep the code the person typed (KL1377 or KLM1377).
export const flightPath = (code, number) => `/flight/${code}${number}`;

// The airline for a code: 3 letters = ICAO, 2 characters = IATA (the one with most known routes).
export function airlineForCode(airlines, code) {
  const c = String(code || "").toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return airlines?.byIcao.get(c) || null;
  if (/^[A-Z0-9]{2}$/.test(c)) return airlines?.byIata.get(c)?.[0] || null;
  return null;
}

// "KL 1377", "kl1377", "KLM1377" -> { code: "KL", number: "1377", airline } when the airline is known.
export function parseFlight(q, airlines) {
  const m = String(q || "").trim().toUpperCase().replace(/\s+/g, "").match(/^([A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})(\d{1,4}[A-Z]?)$/);
  if (!m) return null;
  const airline = airlineForCode(airlines, m[1]);
  return airline ? { code: m[1], number: m[2], airline } : null;
}

// One side of a route: a 3-letter (IATA) or 4-letter (ICAO) code, else the best name matches.
function side(index, text, limit) {
  const t = text.trim();
  const code = t.toUpperCase();
  if (/^[A-Z0-9]{3}$/.test(code) && index.byIata.get(code)) return [index.byIata.get(code)];
  if (/^[A-Z0-9]{4}$/.test(code) && index.byIcao.get(code)) return [index.byIcao.get(code)];
  if (t.length < 3) return [];
  // Only airports whose name or city really contains the words (not a loose match).
  const n = norm(t);
  return searchAirports(index, t, 6).filter(a => norm(a.city).includes(n) || norm(a.name).includes(n)).slice(0, limit);
}

// "CDG-LAX", "CDG LAX", "CDG → LAX", "Paris to Los Angeles", "Bucharest London"
// -> [{ from, to }] (airports), at most 4 combinations.
export function parseRoute(q, index) {
  const s = String(q || "").trim();
  if (!s || !index) return [];
  const combos = (A, B) => A.flatMap(a => B.filter(b => b !== a).map(b => ({ from: a, to: b }))).slice(0, 4);
  const byCode = c => { const u = c.toUpperCase(); return (u.length === 3 ? index.byIata.get(u) : index.byIcao.get(u)) || null; };
  // 1. An explicit separator: "to", an arrow, " - ", a dash or a slash.
  const sep = s.split(/\s+to\s+|\s*(?:→|->|>|–|—|\/)\s*|\s+-\s+/i).filter(Boolean);
  if (sep.length === 2) return combos(side(index, sep[0], 2), side(index, sep[1], 2));
  // 2. Two codes: "CDG-LAX", "CDG LAX", "LFPG-KLAX".
  const codes = s.match(/^([A-Za-z0-9]{3,4})[\s-]+([A-Za-z0-9]{3,4})$/);
  if (codes && byCode(codes[1]) && byCode(codes[2])) return combos([byCode(codes[1])], [byCode(codes[2])]);
  // 3. Names without a separator: try every split point ("Bucharest London", "Paris Los Angeles"),
  //    unless the whole text is already one place ("New York", "Los Angeles").
  const words = s.split(/\s+/);
  if (words.length < 2 || side(index, s, 1).length) return [];
  for (let i = 1; i < words.length && words.length <= 6; i++) {
    const A = side(index, words.slice(0, i).join(" "), 2), B = side(index, words.slice(i).join(" "), 2);
    if (A.length && B.length) return combos(A, B);
  }
  return [];
}

// Airlines by code (exact) or name (start of a word first), most routes first.
export function searchAirlines(airlines, q, limit = 6) {
  const n = norm(q), code = String(q || "").trim().toUpperCase();
  if (!airlines || n.length < 2) return [];
  const exact = [airlines.byIcao.get(code), ...(airlines.byIata.get(code) || [])].filter(Boolean);
  const byName = airlines.list.filter(a => {
    const name = norm(a.name);
    return name.startsWith(n) || name.includes(" " + n);
  });
  return [...new Set([...exact, ...byName])].slice(0, limit);
}

// Everything the text can mean, the most specific first.
export function searchAll(q, { index, airlines }) {
  const s = String(q || "").trim();
  if (!s || !index) return [];
  const out = [];
  const reg = asRegistration(s);
  if (reg) out.push({ kind: "aircraft", reg, href: aircraftPath(reg) });
  const flight = parseFlight(s, airlines);
  if (flight) out.push({ kind: "flight", ...flight, href: flightPath(flight.code, flight.number) });
  for (const r of parseRoute(s, index)) out.push({ kind: "route", ...r, href: routePath(r.from.iata, r.to.iata) });
  const airports = searchAirports(index, s, 12).map(a => ({ kind: "airport", airport: a, href: airportPath(a) }));
  const lines = searchAirlines(airlines, s).map(a => ({ kind: "airline", airline: a, href: airlinePath(a) }));
  // An exact airline code ("W6", "KLM") goes before airports; names after the first airports.
  const code = s.toUpperCase();
  const exactLine = lines.filter(x => x.airline.icao === code || x.airline.iata === code);
  const otherLines = lines.filter(x => !exactLine.includes(x));
  out.push(...exactLine, ...airports.slice(0, 6), ...otherLines, ...airports.slice(6));
  return out.slice(0, 24);
}
