// Pure helpers used by scripts/build-airports.mjs (and by the tests).
// They turn the OurAirports CSV files plus the mwgg time zone list into
// the compact public/data/airports.json file the app loads.

export const FIELDS = ["iata", "icao", "name", "city", "region", "country", "lat", "lon", "elevationFt", "type", "scheduled", "tz", "runways"];

// OurAirports type -> one-letter code used in the compact file.
export const TYPE_CODES = { large_airport: "L", medium_airport: "M", small_airport: "S", seaplane_base: "W", heliport: "H" };

// RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF or LF).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// CSV text -> array of objects keyed by the header row.
export function csvToObjects(text) {
  const [header, ...rows] = parseCsv(text);
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ""])));
}

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

// Number of open runways per airport ident. Helipads (H1, H2...) are not runways.
export function countRunways(runways) {
  const counts = new Map();
  for (const r of runways) {
    if (r.closed === "1") continue;
    if (/^H\d*$/i.test(r.le_ident)) continue;
    counts.set(r.airport_ident, (counts.get(r.airport_ident) || 0) + 1);
  }
  return counts;
}

// mwgg airports.json is keyed by ICAO-style ident. Returns a lookup that
// finds a time zone first by ident, then by IATA code (only when that
// IATA code is unique in mwgg). If both match and disagree, the time
// zone is treated as unknown rather than guessed.
export function makeTimeZoneLookup(mwgg) {
  const byIdent = new Map(), byIata = new Map(), iataCount = new Map();
  for (const [key, a] of Object.entries(mwgg)) {
    if (!isValidTimeZone(a.tz)) continue;
    byIdent.set(key.toUpperCase(), a.tz);
    if (a.icao) byIdent.set(String(a.icao).toUpperCase(), a.tz);
    if (a.iata) {
      const code = String(a.iata).toUpperCase();
      iataCount.set(code, (iataCount.get(code) || 0) + 1);
      byIata.set(code, a.tz);
    }
  }
  return function lookup({ iata, idents }) {
    let fromIdent = null;
    for (const id of idents) if (id && byIdent.has(id.toUpperCase())) { fromIdent = byIdent.get(id.toUpperCase()); break; }
    const fromIata = iata && iataCount.get(iata) === 1 ? byIata.get(iata) : null;
    if (fromIdent && fromIata && fromIdent !== fromIata) return null;
    return fromIdent || fromIata || null;
  };
}

const num = v => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// Builds the compact data object. Only airports with an IATA code are kept
// (these are the airports passengers and flight data refer to).
export function buildAirportData({ airports, runways, countries, regions, mwgg, generated, sources }) {
  const runwayCounts = countRunways(runways);
  const tzLookup = makeTimeZoneLookup(mwgg);
  const countryNames = Object.fromEntries(countries.map(c => [c.code, c.name]));
  const regionNames = {};
  const seen = new Set();
  const rows = [];
  const stats = { kept: 0, withTimeZone: 0, skippedDuplicateIata: 0 };

  for (const a of airports) {
    const iata = a.iata_code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(iata) || !TYPE_CODES[a.type]) continue;
    if (seen.has(iata)) { stats.skippedDuplicateIata++; continue; }
    seen.add(iata);
    const tz = tzLookup({ iata, idents: [a.icao_code, a.gps_code, a.ident] });
    const region = a.iso_region || null;
    if (region) regionNames[region] = null; // names filled in below
    rows.push([
      iata,
      a.icao_code.trim().toUpperCase() || null,
      a.name.trim(),
      a.municipality.trim() || null,
      region,
      a.iso_country || null,
      round(num(a.latitude_deg), 4),
      round(num(a.longitude_deg), 4),
      num(a.elevation_ft),
      TYPE_CODES[a.type],
      a.scheduled_service === "yes" ? 1 : 0,
      tz,
      runwayCounts.has(a.ident) ? runwayCounts.get(a.ident) : null,
    ]);
    stats.kept++;
    if (tz) stats.withTimeZone++;
  }

  const regionLookup = new Map(regions.map(r => [r.code, r.name]));
  for (const code of Object.keys(regionNames)) regionNames[code] = regionLookup.get(code) || null;
  const usedCountries = {};
  for (const r of rows) if (r[5]) usedCountries[r[5]] = countryNames[r[5]] || null;

  rows.sort((x, y) => x[0].localeCompare(y[0]));
  return {
    data: { version: 1, generated, sources, fields: FIELDS, countries: usedCountries, regions: regionNames, airports: rows },
    stats,
  };
}
