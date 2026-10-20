// Airline logos (public/data/airline-logos.json, built by npm run build:logos)
// with the coloured code badge as fallback. Several airlines can share an
// IATA code (Lufthansa, Lufthansa Regional, Lufthansa Cargo: LH): the logo is
// used only when the flight's airline name, or its ICAO code, picks exactly
// one of them, or they all use the same logo. Otherwise: the badge.

// Where Commons has no free logo, a logo from a CDN is used instead (owner's
// choice for the prototype, 2026-10-20; review before a public launch), only
// when the IATA code belongs to at most one active airline in our list.

let manifest = null, loading = null;
let airlinesPerIata = null; // IATA -> number of active airlines using it (public/data/airlines.json)

export function loadLogos() {
  loading ??= Promise.all([
    fetch("/data/airline-logos.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/data/airlines.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([j, a]) => {
    manifest = j?.logos || {};
    // airlines.json rows: [name, icao, iata, routes]
    setAirlineCodes((a?.airlines || []).map(r => ({ icao: r[1], iata: r[2], routes: r[3] })));
    return manifest;
  });
  return loading;
}
// For tests and for pages that already have the data.
export const setLogos = logos => { manifest = logos || {}; };
// airlines: [{ icao, iata, routes }] -> per IATA code: how many active airlines use it and the main one (most routes).
export function setAirlineCodes(airlines) {
  airlinesPerIata = new Map();
  for (const a of airlines) {
    if (!a.iata) continue;
    const e = airlinesPerIata.get(a.iata) || { n: 0, main: null, routes: -1 };
    e.n++;
    if ((a.routes || 0) > e.routes) { e.main = a.icao; e.routes = a.routes || 0; }
    airlinesPerIata.set(a.iata, e);
  }
}

const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// airline: { iata, icao, name } from the flight. Returns a logo record or null.
export function logoFor(airline, logos = manifest) {
  if (!logos || !airline) return null;
  const iata = String(airline.iata || "").toUpperCase();
  const icao = String(airline.icao || "").toUpperCase();
  let list = iata ? logos[iata] || [] : [];
  if (!list.length && icao) list = Object.values(logos).flat().filter(l => l.icao.includes(icao));
  if (!list.length) return null;
  if (list.length === 1) return !icao || !list[0].icao.length || list[0].icao.includes(icao) ? list[0] : null;
  // Same name, or the flight's name is the start of it ("Turkish" -> "Turkish Airlines").
  const n = norm(airline.name);
  const byName = n ? list.filter(l => l.name && norm(l.name) === n) : [];
  if (byName.length === 1) return byName[0];
  const byStart = n.length >= 3 ? list.filter(l => l.name && norm(l.name).startsWith(n + " ")) : [];
  if (!byName.length && byStart.length === 1) return byStart[0];
  const byIcao = icao ? list.filter(l => l.icao.includes(icao)) : [];
  if (byIcao.length === 1) return byIcao[0];
  const same = (byIcao.length ? byIcao : list).every(l => l.src === list[0].src);
  return same ? list[0] : null;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Badge colour: a stable hue from the code (decoration only, not data).
const hue = s => { let h = 0; for (const c of String(s || "?")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

// The CDN logo (through our /api/airline-logo, so visitors never contact the
// CDN) when Commons has none. A code shared by several active airlines is used
// only for the main one (most known routes), matched by the flight's ICAO code.
export function cdnLogo(airline) {
  const iata = String(airline?.iata || "").toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(iata) || !airlinesPerIata) return null;
  const e = airlinesPerIata.get(iata);
  if (e && e.n > 1 && !(airline.icao && airline.icao.toUpperCase() === e.main)) return null;
  return { src: "/api/airline-logo/" + iata, name: airline.name || iata, cdn: true };
}
// Commons logo first, else the CDN one.
export const anyLogo = airline => logoFor(airline) || cdnLogo(airline);
export const logoTitle = logo => (logo.cdn ? `${logo.name} (logo: Aviasales logo CDN, prototype only)` : `${[logo.name, logo.author, logo.licence].filter(Boolean).join(" · ")} (logo: Wikimedia Commons)`);

// The airline mark for a flight: its logo, or the coloured code badge.
export function airlineBadge(f) {
  const code = f.airline?.iata || f.airline?.icao || (f.number || "").split(" ")[0] || "✈";
  const logo = f.demo ? null : anyLogo(f.airline);
  const badge = `<span class="al" style="--h:${hue(code)}" aria-hidden="true">${esc(code.slice(0, 3))}</span>`;
  if (!logo) return badge;
  // If the image fails to load, the badge takes its place.
  return `<span class="al al-logo" title="${esc(logoTitle(logo))}" aria-hidden="true"><img src="${esc(logo.src)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.outerHTML=${esc(JSON.stringify(badge))}"></span>`;
}
