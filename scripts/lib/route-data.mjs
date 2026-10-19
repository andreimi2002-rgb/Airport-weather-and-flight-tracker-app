// Pure helpers used by scripts/build-routes.mjs (and by the tests): the VRS
// standing data (callsign -> airports, CC0) turned into a route index by
// airport pair, plus a compact airline list for search.

// "LROP-EGLL" or "EGLL-LROP-KJFK" (stops) -> consecutive legs [["LROP","EGLL"], ...]
export function legsOf(codes) {
  const parts = String(codes || "").trim().toUpperCase().split("-").filter(p => /^[A-Z0-9]{3,4}$/.test(p));
  const legs = [];
  for (let i = 0; i + 1 < parts.length; i++) if (parts[i] !== parts[i + 1]) legs.push([parts[i], parts[i + 1]]);
  return legs;
}

// routes CSV rows (Callsign,Code,Number,AirlineCode,AirportCodes) -> [{ callsign, legs }]
export function routeRows(rows) {
  const out = [];
  for (const r of rows) {
    const callsign = String(r.Callsign || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,8}$/.test(callsign)) continue;
    const legs = legsOf(r.AirportCodes);
    if (legs.length) out.push({ callsign, legs });
  }
  return out;
}

// Adds an airline's routes to the index. toIata: airport code (ICAO, or an
// IATA code as some rows use) -> our IATA code or null (not in our list: skipped).
// index: { ORIG: { DEST: Set(callsign) } }. Returns how many legs were kept.
export function addToIndex(index, rows, toIata) {
  let kept = 0;
  for (const { callsign, legs } of rows) {
    for (const [a, b] of legs) {
      const from = toIata(a), to = toIata(b);
      if (!from || !to || from === to) continue;
      ((index[from] ??= {})[to] ??= new Set()).add(callsign);
      kept++;
    }
  }
  return kept;
}

// index -> shards by the origin's first character: { O: { OTP: { LHR: ["BAW78U", ...] } } }
export function shardIndex(index) {
  const shards = {};
  for (const from of Object.keys(index).sort()) {
    const dests = {};
    for (const to of Object.keys(index[from]).sort()) dests[to] = [...index[from][to]].sort();
    (shards[from[0]] ??= {})[from] = dests;
  }
  return shards;
}

// VRS airline rows (Code,Name,ICAO,IATA) -> search list. Kept: airlines with
// known routes, or with both an ICAO and an IATA code. routeCounts: ICAO -> legs.
export function airlineList(rows, routeCounts) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const icao = String(r.ICAO || "").trim().toUpperCase(), iata = String(r.IATA || "").trim().toUpperCase(), name = String(r.Name || "").trim();
    if (!name) continue;
    const okIcao = /^[A-Z]{3}$/.test(icao), okIata = /^[A-Z0-9]{2}$/.test(iata);
    const routes = okIcao ? routeCounts[icao] || 0 : 0;
    if (!routes && !(okIcao && okIata)) continue;
    const key = icao || iata + "|" + name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, icao: okIcao ? icao : null, iata: okIata ? iata : null, routes });
  }
  return out.sort((a, b) => b.routes - a.routes || a.name.localeCompare(b.name));
}
