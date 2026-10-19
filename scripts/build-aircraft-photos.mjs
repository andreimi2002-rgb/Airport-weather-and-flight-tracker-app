// Builds public/data/aircraft-types.json: one representative photo per
// aircraft type (e.g. "Airbus A320", "Boeing 737-800"), from Wikidata +
// Wikimedia Commons, with author and licence. Shown only when the actual
// aircraft is unknown, labelled "not this aircraft".
//   npm run build:aircraft-photos
// Run by hand to refresh, then commit. Every photo URL is checked.
import { readFile, writeFile } from "node:fs/promises";
import { sparql, commonsInfo, checkLink, verify } from "./lib/wikimedia.mjs";
import { toPhoto } from "./lib/photo-data.mjs";
import { groupTypes, buildKeyIndex } from "./lib/aircraft-type-data.mjs";
import { MAKERS } from "../public/js/aircraft-types.js";

const OUT = new URL("../public/data/aircraft-types.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);

// Aircraft model (Q15056995) or aircraft family (Q15056993) items, or items
// that are an airliner (Q210932) or a kind of airliner (e.g. Embraer 175,
// Airbus A330neo), whose English name starts with a known maker.
const makerRe = MAKERS.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&")).join("|");
const FILTER = `{ VALUES ?t { wd:Q15056995 wd:Q15056993 } ?a wdt:P31 ?t } UNION { ?a wdt:P31/wdt:P279* wd:Q210932 } ?a rdfs:label ?label . FILTER(lang(?label) = "en") FILTER(REGEX(?label, "^(${makerRe})( |-)", "i"))`;

console.log("Querying Wikidata…");
const nameRows = await sparql(`SELECT ?a ?label (GROUP_CONCAT(DISTINCT ?alias; separator=" | ") AS ?aliases) WHERE { ${FILTER} OPTIONAL { ?a skos:altLabel ?alias FILTER(lang(?alias) = "en") } } GROUP BY ?a ?label`);
const imageRows = await sparql(`SELECT DISTINCT ?a ?img ?rank WHERE { ${FILTER} ?a p:P18 ?st . ?st ps:P18 ?img ; wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank) }`);
const items = groupTypes(nameRows, imageRows);
const withImages = [...items.values()].filter(it => it.images.length);
console.log(`${items.size} aircraft types, ${withImages.length} with photos.`);

const files = [...new Set(withImages.flatMap(it => it.images))];
const info = await commonsInfo(files);
const photos = new Map(), rejected = {};
for (const file of files) {
  const r = toPhoto(info.get(file), TODAY);
  if (r.photo) photos.set(file, r.photo);
  else { const k = r.reject.split(" ")[0]; rejected[k] = (rejected[k] || 0) + 1; }
}
console.log(`${photos.size} photos pass licence/type/size rules. Rejected:`, rejected);

// Links verified in an earlier run (last 30 days) are not checked again.
const known = new Map();
try {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  for (const t of JSON.parse(await readFile(OUT, "utf8")).types) if (t.photo?.verified >= cutoff) known.set(t.photo.src, t.photo.verified);
} catch { /* no earlier run */ }

const first = it => it.images.map(f => photos.get(f)).filter(Boolean);
const toCheck = new Set(withImages.map(it => first(it)[0]).filter(p => p && !known.has(p.src)).map(p => p.src));
console.log(`${known.size} links verified recently; checking ${toCheck.size}.`);
const { ok: working, reasons } = await verify(toCheck);
for (const [src] of known) working.add(src);

// First usable photo that loads; the next candidate if the first link fails.
const chosen = new Map();
for (const it of withImages) {
  const cands = first(it);
  let p = cands.find(c => working.has(c.src)) ?? null;
  if (!p && cands.length > 1) for (const c of cands.slice(1)) if ((await checkLink(c.src)) === "ok") { p = c; break; }
  if (p) chosen.set(it.qid, { ...p, verified: known.get(p.src) || TODAY });
}

// Who owns each name is decided among ALL types, photo or not: otherwise an
// alias ("Boeing 717" on the C-135) could take a name whose real owner just
// has no usable photo. Then only names whose owner has a photo are kept.
const { index: allIndex, dropped } = buildKeyIndex(items);
const index = new Map([...allIndex].filter(([, q]) => chosen.has(q)));
const typed = new Map([...items].filter(([q]) => chosen.has(q)));
const types = [], pos = new Map();
for (const [key, q] of [...index].sort(([a], [b]) => a.localeCompare(b))) {
  if (!pos.has(q)) { pos.set(q, types.length); const it = typed.get(q); types.push({ name: it.name, wikidata: q, photo: chosen.get(q) }); }
}
const keys = Object.fromEntries([...index].sort(([a], [b]) => a.localeCompare(b)).map(([k, q]) => [k, pos.get(q)]));
if (types.length < 100) throw new Error(`Only ${types.length} aircraft types with photos; expected more. Not writing.`);

await writeFile(OUT, JSON.stringify({
  version: 1, generated: TODAY,
  sources: [
    { name: "Wikidata", url: "https://www.wikidata.org", licence: "CC0", used: "Aircraft types, names and which photo belongs to which type" },
    { name: "Wikimedia Commons", url: "https://commons.wikimedia.org", licence: "Per photo (public domain, CC0, CC BY, CC BY-SA, Attribution)", used: "Representative aircraft type photos" },
  ],
  counts: { types: types.length, keys: Object.keys(keys).length, ambiguousKeysDropped: dropped.length },
  rejected, linkProblems: reasons,
  types, keys,
}));
console.log(`Wrote ${types.length} aircraft types, ${Object.keys(keys).length} names (${dropped.length} ambiguous names dropped).`);
