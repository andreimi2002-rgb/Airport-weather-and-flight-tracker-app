// Representative photos per aircraft type (from Wikidata + Wikimedia Commons,
// prepared by `npm run build:aircraft-photos` into /data/aircraft-types.json).
// Used when the actual aircraft is unknown; always labelled "not this aircraft".
// Shared by the build script and the page, so names are matched the same way.

// Makers whose names start aircraft type names (longest first where one contains another).
export const MAKERS = ["De Havilland Canada", "De Havilland", "McDonnell Douglas", "British Aerospace", "Airbus", "Boeing", "Embraer", "ATR", "Bombardier", "Canadair", "Fokker", "Saab", "Sukhoi", "COMAC", "Mitsubishi", "Antonov", "Tupolev", "Ilyushin", "Yakovlev", "Dornier", "BAe", "Avro", "Cessna", "Beechcraft", "Pilatus", "Gulfstream", "Dassault", "Learjet", "Lockheed", "Douglas", "Tecnam", "Piper", "Diamond", "Cirrus", "Let", "Viking", "Irkut", "Xian"];

const STRIP = new Set(["family", "series", "dreamliner", "aircraft", "airliner"]);

// "Airbus A330-900 NEO" -> "airbus a330 900 neo"; "Airbus A321neo" -> "airbus a321 neo"
export function typeKey(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/(\d)(neo|ceo|max|er|lr|sp)\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(w => w && !STRIP.has(w))
    .join(" ");
}

// The maker an aircraft name starts with ("Boeing 737-800" -> "Boeing"), or null.
export function makerOf(name) {
  const k = typeKey(name);
  return MAKERS.find(m => k === typeKey(m) || k.startsWith(typeKey(m) + " ")) || null;
}

// Keys to try for a board model string, most specific first:
// "airbus a330 900 neo", "airbus a330 900", "airbus a330". Each must still
// contain a digit, so we never fall back to just a maker name.
export function keyChain(model) {
  const words = typeKey(model).split(" ").filter(Boolean);
  const out = [];
  for (let n = words.length; n >= 2; n--) {
    const k = words.slice(0, n).join(" ");
    if (/\d/.test(k)) out.push(k);
  }
  return out;
}

// data: { types: [{ name, wikidata, photo }], keys: { key: index } }
export function findType(data, model) {
  if (!data || !model) return null;
  for (const k of keyChain(model)) {
    const i = data.keys?.[k];
    if (i !== undefined && data.types[i]?.photo) return data.types[i];
  }
  return null;
}

let loading = null;
export function loadAircraftTypes() {
  loading ??= fetch("/data/aircraft-types.json").then(r => (r.ok ? r.json() : null)).catch(() => null);
  return loading;
}
