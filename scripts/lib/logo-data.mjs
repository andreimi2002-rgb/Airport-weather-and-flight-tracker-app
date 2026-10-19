// Pure helpers used by scripts/build-logos.mjs (and by the tests): which
// Wikidata airline items and logo files are used, and the stored record.
import { fileNameFromFilePath, qid, rankOrder, acceptLicence, isPublicDomain, cleanAuthor } from "./photo-data.mjs";

// Rows (a, aLabel, iata, icao, logo, rank, ended, closed) -> open airlines with
// their current logos (no end date), preferred first.
export function groupAirlines(rows) {
  const items = new Map();
  for (const r of rows) {
    const id = qid(r.a);
    const iata = String(r.iata || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(iata)) continue;
    if (!items.has(id)) items.set(id, { qid: id, name: r.aLabel && !/^Q\d+$/.test(r.aLabel) ? r.aLabel : null, iata, icao: new Set(), logos: new Map(), closed: false });
    const it = items.get(id);
    if (String(r.closed) === "true") it.closed = true;
    const icao = String(r.icao || "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(icao)) it.icao.add(icao);
    const file = fileNameFromFilePath(r.logo);
    if (file && String(r.ended) !== "true") {
      const rank = rankOrder(r.rank);
      if (!it.logos.has(file) || rank < it.logos.get(file)) it.logos.set(file, rank);
    }
  }
  return [...items.values()]
    .filter(it => !it.closed && it.logos.size)
    .map(it => ({ ...it, icao: [...it.icao], logos: [...it.logos].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([f]) => f) }));
}

const LOGO_TYPES = new Set(["image/svg+xml", "image/png", "image/jpeg", "image/webp"]);

// Thumbnail width to ask Commons for: tall enough for a sharp badge (about
// 60 px high), using its standard thumbnail widths.
export function thumbWidth(w, h) {
  const aspect = w > 0 && h > 0 ? w / h : 1;
  return aspect <= 1.9 ? 120 : 250;
}

// Commons imageinfo -> { logo } or { reject }. Same licence rule as the photos.
export function toLogo(info) {
  if (!info) return { reject: "missing" };
  if (!LOGO_TYPES.has(info.mime)) return { reject: "type " + info.mime };
  const meta = Object.fromEntries(Object.entries(info.extmetadata || {}).map(([k, v]) => [k, v?.value]));
  const licence = String(meta.LicenseShortName || "").trim();
  if (!acceptLicence(licence)) return { reject: "licence " + (licence || "unknown") };
  const author = cleanAuthor(meta.Artist);
  if (!author && !isPublicDomain(licence)) return { reject: "no author" };
  return { logo: { page: info.descriptionurl, author: author || null, licence, licenceUrl: meta.LicenseUrl || null, width: info.width, height: info.height } };
}

// Stored file name: "W6-Q212103.png" (the Wikidata id keeps airlines sharing codes apart).
export const logoFileName = (iata, qidValue, ext) => `${iata}-${qidValue}.${ext}`;
