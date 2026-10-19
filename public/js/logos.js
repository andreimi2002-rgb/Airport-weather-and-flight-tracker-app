// Airline logos (public/data/airline-logos.json, built by npm run build:logos)
// with the coloured code badge as fallback. Several airlines can share an
// IATA code (Lufthansa, Lufthansa Regional, Lufthansa Cargo: LH): the logo is
// used only when the flight's airline name, or its ICAO code, picks exactly
// one of them, or they all use the same logo. Otherwise: the badge.

let manifest = null, loading = null;

export function loadLogos() {
  loading ??= fetch("/data/airline-logos.json").then(r => (r.ok ? r.json() : null)).then(j => { manifest = j?.logos || {}; return manifest; }).catch(() => { manifest = {}; return manifest; });
  return loading;
}
// For tests and for pages that already have the data.
export const setLogos = logos => { manifest = logos || {}; };

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
  const byName = list.filter(l => l.name && norm(l.name) === norm(airline.name));
  if (byName.length === 1) return byName[0];
  const byIcao = icao ? list.filter(l => l.icao.includes(icao)) : [];
  if (byIcao.length === 1) return byIcao[0];
  const same = (byIcao.length ? byIcao : list).every(l => l.src === list[0].src);
  return same ? list[0] : null;
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Badge colour: a stable hue from the code (decoration only, not data).
const hue = s => { let h = 0; for (const c of String(s || "?")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

// The airline mark for a flight: its logo, or the coloured code badge.
export function airlineBadge(f) {
  const code = f.airline?.iata || f.airline?.icao || (f.number || "").split(" ")[0] || "✈";
  const logo = f.demo ? null : logoFor(f.airline);
  const badge = `<span class="al" style="--h:${hue(code)}" aria-hidden="true">${esc(code.slice(0, 3))}</span>`;
  if (!logo) return badge;
  const credit = [logo.name, logo.author, logo.licence].filter(Boolean).join(" · ");
  // If the image fails to load, the badge takes its place.
  return `<span class="al al-logo" title="${esc(credit)} (logo: Wikimedia Commons)" aria-hidden="true"><img src="${esc(logo.src)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.outerHTML=${esc(JSON.stringify(badge))}"></span>`;
}
