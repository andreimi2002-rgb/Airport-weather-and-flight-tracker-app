// Airport list: loading, lookup, search and URL routing.
// No DOM code here, so it can be tested with node --test.

export const TYPE_LABELS = { L: "Large airport", M: "Medium airport", S: "Small airport", W: "Seaplane base", H: "Heliport" };
const TYPE_RANK = { L: 250, M: 150, S: 20, W: 0, H: 0 };

// Letters that Unicode normalisation does not split into base + accent.
const SPECIAL = { ł: "l", ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", þ: "th", ı: "i" };

// Lower case, no accents, only letters/digits separated by single spaces.
// "Henri Coandă" -> "henri coanda", "Zürich" -> "zurich".
export function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łøæœßđðþı]/g, ch => SPECIAL[ch])
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Turns the compact JSON (arrays) into airport objects plus lookups.
export function indexAirports(data) {
  const f = Object.fromEntries(data.fields.map((k, i) => [k, i]));
  const list = data.airports.map(r => {
    const a = {
      iata: r[f.iata], icao: r[f.icao], name: r[f.name], city: r[f.city],
      regionCode: r[f.region], region: data.regions[r[f.region]] ?? null,
      countryCode: r[f.country], country: data.countries[r[f.country]] ?? null,
      lat: r[f.lat], lon: r[f.lon], elevationFt: r[f.elevationFt],
      type: r[f.type], scheduled: r[f.scheduled] === 1, tz: r[f.tz], runways: r[f.runways],
    };
    a._name = normalize(a.name);
    a._city = normalize(a.city);
    a._country = normalize(a.country);
    a._keywords = f.keywords == null || !r[f.keywords] ? [] : r[f.keywords].split(",").map(normalize).filter(Boolean);
    a._all = [a.iata, a.icao, a._name, a._city, normalize(a.region), a._country, ...a._keywords].filter(Boolean).join(" ").toLowerCase();
    return a;
  });
  const byIata = new Map(list.map(a => [a.iata, a]));
  const byIcao = new Map(list.filter(a => a.icao).map(a => [a.icao, a]));
  return { list, byIata, byIcao, sources: data.sources, generated: data.generated };
}

// Finds an airport by IATA (3 characters) or ICAO (4 characters) code.
export function findAirport(index, code) {
  const c = String(code ?? "").trim().toUpperCase();
  if (c.length === 3) return index.byIata.get(c) ?? null;
  if (c.length === 4) return index.byIcao.get(c) ?? null;
  return null;
}

// True when some word in `text` starts with `q`.
const startsWord = (text, q) => text.startsWith(q) || text.includes(" " + q);

// Search by code, name, city, region or country. Every word typed must
// match somewhere; exact codes come first, then name/city matches, then
// bigger airports with scheduled flights.
export function searchAirports(index, query, limit = 20) {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(" ");
  const upper = q.replace(/ /g, "").toUpperCase();
  const results = [];
  for (const a of index.list) {
    if (!words.every(w => a._all.includes(w))) continue;
    let score = 0;
    if (a.iata === upper) score += 1000;
    else if (a.icao === upper) score += 900;
    else if (upper.length < 3 && a.iata.startsWith(upper)) score += 300;
    // City and name matches don't add up: the best one counts, so
    // "new york" prefers JFK over "New York Skyports Seaplane Base".
    const cityScore = a._city === q ? 450 : a._city && startsWord(a._city, q) ? 350 : 0;
    const nameScore = startsWord(a._name, q) ? 300 : 0;
    // Keywords hold other names and city codes ("tokyo", "tyo" for Narita).
    const keywordScore = a._keywords.includes(q) ? 400 : a._keywords.some(k => startsWord(k, q)) ? 200 : 0;
    score += Math.max(cityScore, nameScore, keywordScore);
    if (a._country === q) score += 150;
    for (const w of words) if (a._name.split(" ").includes(w) || a._city.split(" ").includes(w)) score += 40;
    score += TYPE_RANK[a.type] ?? 0;
    if (a.scheduled) score += 60;
    results.push([score, a]);
  }
  results.sort((x, y) => y[0] - x[0] || x[1].iata.localeCompare(y[1].iata));
  return results.slice(0, limit).map(r => r[1]);
}

// "/airport/otp" -> { code: "OTP" }, "/" -> { code: null },
// anything else -> { invalid: true }.
export function parseRoute(pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/index.html") return { code: null };
  const m = path.match(/^\/airport\/([A-Za-z0-9]{3,4})$/);
  if (m) return { code: m[1].toUpperCase() };
  const any = path.match(/^\/airport\/([^/]+)$/);
  return { invalid: true, code: any ? decodeURIComponent(any[1]).slice(0, 12) : null };
}

export const airportPath = a => `/airport/${a.iata}`;

// "Seattle, Washington, United States". Skips parts that repeat the city.
export function airportLocation(a) {
  const parts = [a.city];
  const region = a.region?.replace(/\s*\(.*\)$/, "");
  if (region && region !== a.city && !region.startsWith(a.city ?? "\u0000")) parts.push(region);
  if (a.country) parts.push(a.country);
  return parts.filter(Boolean).join(", ") || "Location not available";
}
