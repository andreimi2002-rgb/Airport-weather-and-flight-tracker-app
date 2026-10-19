// Pure helpers used by scripts/build-photos.mjs (and by the tests).
// They decide which Wikidata item belongs to which airport, which photo
// to use, and whether a Wikimedia Commons file may be shown (licence,
// author, image type, size).

// "http://commons.wikimedia.org/wiki/Special:FilePath/HC%20arrivals.jpg" -> "HC arrivals.jpg"
export function fileNameFromFilePath(url) {
  const m = String(url || "").match(/Special:FilePath\/(.+)$/);
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
}

// "http://www.wikidata.org/entity/Q123" -> "Q123"
export const qid = url => String(url || "").split("/").pop() || null;

const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Wikidata statement rank -> sort order: preferred photos first, then normal.
// (Deprecated ones are already left out by the query.)
export const rankOrder = rank => (/PreferredRank$/.test(String(rank || "")) ? 0 : 1);

// file -> best rank seen for it
function addImage(images, file, rank) {
  if (!file) return;
  const r = rankOrder(rank);
  if (!images.has(file) || r < images.get(file)) images.set(file, r);
}
// Preferred first, then by name, so the order is stable between runs.
export const orderedImages = images => [...images].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([file]) => file);

// Groups Wikidata rows (a, iata, icao, img, rank) by IATA code.
export function groupAirportItems(rows) {
  const byIata = new Map();
  for (const r of rows) {
    const iata = String(r.iata || "").trim().toUpperCase();
    if (!iata) continue;
    const id = qid(r.a);
    if (!byIata.has(iata)) byIata.set(iata, new Map());
    const items = byIata.get(iata);
    if (!items.has(id)) items.set(id, { qid: id, icao: new Set(), images: new Map(), closed: false, base: false });
    const item = items.get(id);
    if (r.icao) item.icao.add(String(r.icao).trim().toUpperCase());
    // Closed (dissolved / closure date / end time) or a military air base: see matchAirport.
    if (String(r.closed) === "true") item.closed = true;
    if (String(r.base) === "true") item.base = true;
    addImage(item.images, fileNameFromFilePath(r.img), r.rank);
  }
  return byIata;
}

// Finds the one Wikidata item for an airport. Items whose ICAO code
// contradicts ours are dropped. If more than one item is left, an exact
// ICAO match decides; otherwise the airport is skipped (no guessing).
export function matchAirport(airport, byIata) {
  const items = [...(byIata.get(airport.iata)?.values() ?? [])];
  let candidates = items.filter(it => !airport.icao || it.icao.size === 0 || it.icao.has(airport.icao));
  if (candidates.length > 1 && airport.icao) candidates = candidates.filter(it => it.icao.has(airport.icao));
  // Still several (civil airport + air base on the same field, or an old closed airport
  // that kept the code): keep the open, non-military one if exactly one is left.
  if (candidates.length > 1) {
    const active = candidates.filter(it => !it.closed && !it.base);
    if (active.length === 1) candidates = active;
  }
  if (candidates.length !== 1) return null;
  const it = candidates[0];
  return { qid: it.qid, images: orderedImages(it.images) };
}

// Groups city rows (a, city, cityLabel, cimg, crank) by airport item.
// facts: rows (city, pop, cbanner) with each city's population and Wikivoyage
// page banner (P948), used to choose between cities and as a last photo.
export function groupCities(rows, facts = []) {
  const extra = new Map();
  for (const f of facts) {
    const c = qid(f.city), e = extra.get(c) || { pop: null, banner: null };
    const pop = Number(f.pop);
    if (Number.isFinite(pop) && pop > (e.pop ?? -1)) e.pop = pop;
    e.banner ??= fileNameFromFilePath(f.cbanner);
    extra.set(c, e);
  }
  const byAirport = new Map();
  for (const r of rows) {
    const a = qid(r.a), c = qid(r.city);
    if (!byAirport.has(a)) byAirport.set(a, new Map());
    const cities = byAirport.get(a);
    if (!cities.has(c)) cities.set(c, { qid: c, name: r.cityLabel || null, images: new Map(), pop: extra.get(c)?.pop ?? null, banner: extra.get(c)?.banner ?? null });
    addImage(cities.get(c).images, fileNameFromFilePath(r.cimg), r.crank);
  }
  return byAirport;
}

// A city at least this many times bigger than the next one is "the" city
// (Brussels for Brussels-Zaventem); otherwise none (Dallas / Fort Worth).
export const DOMINANT_CITY_FACTOR = 3;

// The city an airport serves: the only one listed, the one whose name
// matches the airport's municipality, or a clearly dominant one by
// population. Several comparable cities -> none.
// A label that is just the Q-id (no English name) is not usable.
// Photos: the city's own photos first, its Wikivoyage banner last.
export function matchCity(airport, airportQid, citiesByAirport) {
  const cities = [...(citiesByAirport.get(airportQid)?.values() ?? [])].filter(c => c.name && !/^Q\d+$/.test(c.name));
  let city = null;
  if (cities.length === 1) city = cities[0];
  else if (cities.length > 1) {
    const same = cities.filter(c => norm(c.name) === norm(airport.city));
    if (same.length === 1) city = same[0];
    else {
      const byPop = [...cities].sort((x, y) => (y.pop ?? -1) - (x.pop ?? -1));
      if (byPop[0].pop && (byPop[1].pop ?? 0) * DOMINANT_CITY_FACTOR <= byPop[0].pop) city = byPop[0];
    }
  }
  if (!city) return null;
  const images = orderedImages(city.images);
  if (city.banner && !images.includes(city.banner)) images.push(city.banner);
  return { qid: city.qid, name: city.name, images };
}

// Only free licences that allow showing the photo with credit.
// "Attribution" is the Commons {{Attribution}} licence: free use, credit required.
const LICENCE_OK = /^(public domain|pd(-[\w.-]+)?|cc0( 1\.0)?|cc[ -]by(-sa)?( \d\.\d)?( [a-z]{2,3})?|attribution)$/i;
export function acceptLicence(name) {
  const n = String(name || "").trim();
  if (!n || /\b(nc|nd)\b/i.test(n)) return false;
  return LICENCE_OK.test(n);
}
export const isPublicDomain = name => /^(public domain|pd\b|pd-|cc0)/i.test(String(name || "").trim());

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
// Author HTML from Commons -> short plain text.
export function cleanAuthor(html) {
  let t = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m))
    .replace(/\(\s*talk\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t
    .replace(/^Original uploader was\s+/i, "")
    .replace(/\s+at\s+\S*wikipedia\b.*$/i, "") // "Name at ro.Wikipedia . Uploaded …" -> "Name"
    .replace(/^User:\s*/i, "")
    .trim();
  if (t.length > 90) t = t.slice(0, 87).trimEnd() + "…";
  return t;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/tiff"]);
export const MIN_WIDTH = 640;

// Commons imageinfo (with extmetadata) -> photo record, or a reason why not.
export function toPhoto(info, verifiedDate) {
  if (!info) return { reject: "missing" };
  if (!IMAGE_TYPES.has(info.mime)) return { reject: "type " + info.mime };
  if (!(info.width >= MIN_WIDTH)) return { reject: "too small" };
  const meta = Object.fromEntries(Object.entries(info.extmetadata || {}).map(([k, v]) => [k, v?.value]));
  const licence = String(meta.LicenseShortName || "").trim();
  if (!acceptLicence(licence)) return { reject: "licence " + (licence || "unknown") };
  const author = cleanAuthor(meta.Artist);
  if (!author && !isPublicDomain(licence)) return { reject: "no author" };
  const src = String(info.thumburl || info.url || "").replace(/\?.*$/, "");
  if (!/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(src)) return { reject: "unexpected url" };
  return {
    photo: {
      src,
      page: info.descriptionurl,
      author: author || null,
      licence,
      licenceUrl: meta.LicenseUrl || null,
      verified: verifiedDate,
    },
  };
}

// Photos are stored in small files by the first character of the IATA
// code (public/data/photos/O.json holds OTP, ORD...).
export const shardKey = iata => String(iata)[0].toUpperCase();
