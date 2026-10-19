// Pure helpers for scripts/build-aircraft-photos.mjs (and the tests): which
// names point to which Wikidata aircraft type, and which photos to try.
import { typeKey, makerOf } from "../../public/js/aircraft-types.js";
import { qid, fileNameFromFilePath, rankOrder, orderedImages } from "./photo-data.mjs";

// nameRows: { a, label, aliases ("x | y") }  imageRows: { a, img, rank }
// Returns Map qid -> { qid, name, maker, names: Set, images: [file] }
export function groupTypes(nameRows, imageRows) {
  const items = new Map();
  for (const r of nameRows) {
    const id = qid(r.a), name = String(r.label || "").trim();
    const maker = makerOf(name);
    if (!id || !name || !maker) continue; // only types whose name starts with a known maker
    const it = items.get(id) || { qid: id, name, maker, names: new Set([name]), images: new Map() };
    for (const a of String(r.aliases || "").split(" | ").map(s => s.trim()).filter(Boolean)) it.names.add(a);
    items.set(id, it);
  }
  for (const r of imageRows) {
    const it = items.get(qid(r.a));
    const file = fileNameFromFilePath(r.img);
    if (!it || !file) continue;
    const order = rankOrder(r.rank);
    if (!it.images.has(file) || order < it.images.get(file)) it.images.set(file, order);
  }
  for (const it of items.values()) it.images = orderedImages(it.images);
  return items;
}

// How strongly a name points to its item: 0 its own exact label ("Airbus A320"),
// 1 its label with a word dropped ("Airbus A320 family" -> "airbus a320"), 2 an alias.
const GENERIC = /\b(family|series|dreamliner|aircraft|airliner)\b/i;

// Name -> lookup key with that strength. An alias without the maker
// ("A321neo", "B738") gets the item's maker in front. Keys need two words and a digit.
export function keysFor(item) {
  const keys = new Map();
  for (const n of item.names) {
    const full = makerOf(n) ? n : item.maker + " " + n;
    const k = typeKey(full);
    if (k.split(" ").length < 2 || !/\d/.test(k)) continue;
    const strength = n === item.name ? (GENERIC.test(n) ? 1 : 0) : 2;
    if (!keys.has(k) || strength < keys.get(k)) keys.set(k, strength);
  }
  return keys;
}

// Map key -> qid. When types share a key, the strongest claim wins (an exact
// label beats a family name or an alias); a tie is dropped (no guessing).
export function buildKeyIndex(items) {
  const owners = new Map();
  for (const it of items.values()) for (const [k, strength] of keysFor(it)) {
    if (!owners.has(k)) owners.set(k, []);
    owners.get(k).push({ qid: it.qid, strength });
  }
  const index = new Map(), dropped = [];
  for (const [k, list] of owners) {
    const best = Math.min(...list.map(o => o.strength));
    const winners = [...new Set(list.filter(o => o.strength === best).map(o => o.qid))];
    if (winners.length === 1) index.set(k, winners[0]);
    else dropped.push(k);
  }
  return { index, dropped };
}
