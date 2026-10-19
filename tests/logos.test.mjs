import { test } from "node:test";
import assert from "node:assert/strict";
import { logoFor, airlineBadge, setLogos } from "../public/js/logos.js";
import { groupAirlines, toLogo, thumbWidth, logoFileName } from "../scripts/lib/logo-data.mjs";
import { readFileSync, existsSync } from "node:fs";

const L = (name, icao, src) => ({ name, icao, src, licence: "Public domain" });
const logos = {
  LH: [L("Lufthansa Cargo", ["GEC"], "/c.png"), L("Lufthansa Regional", ["DLH"], "/r.png"), L("Lufthansa", ["DLH"], "/lh.png")],
  W4: [L("Wizz Air Malta", ["WMT"], "/w4.png")],
  XX: [L("One", ["AAA"], "/x.png"), L("Two", ["BBB"], "/x.png")],
  YY: [L("First", ["CCC"], "/y1.png"), L("Second", ["DDD"], "/y2.png")],
};

test("logo: the flight's airline name or ICAO code picks one, never a guess", () => {
  assert.equal(logoFor({ iata: "LH", icao: "DLH", name: "Lufthansa" }, logos).src, "/lh.png");
  assert.equal(logoFor({ iata: "LH", icao: "GEC", name: "Lufthansa Cargo AG" }, logos).src, "/c.png");
  // Two airlines with DLH and no name match: no logo
  assert.equal(logoFor({ iata: "LH", icao: "DLH", name: "Lufthansa CityLine" }, logos), null);
  assert.equal(logoFor({ iata: "W4", icao: null, name: "Wizz Air Malta" }, logos).src, "/w4.png");
  // The only airline with that code has a different ICAO code: not this airline
  assert.equal(logoFor({ iata: "W4", icao: "XYZ", name: "Other" }, logos), null);
  // Shared code, same logo file: fine
  assert.equal(logoFor({ iata: "XX", name: "?" }, logos).src, "/x.png");
  assert.equal(logoFor({ iata: "YY", name: "?" }, logos), null);
  // No IATA code: found by ICAO
  assert.equal(logoFor({ iata: null, icao: "WMT" }, logos).src, "/w4.png");
  assert.equal(logoFor({ iata: "ZZ" }, logos), null);
});

test("badge: logo when known, coloured code otherwise, never for demo flights", () => {
  setLogos(logos);
  assert.match(airlineBadge({ airline: { iata: "W4", name: "Wizz Air Malta" }, number: "W4 3055" }), /al-logo.*src="\/w4.png"/);
  assert.match(airlineBadge({ airline: { iata: "ZZ" }, number: "ZZ 1" }), /class="al" style="--h:\d+"[^>]*>ZZ</);
  assert.doesNotMatch(airlineBadge({ demo: true, airline: { iata: "W4", name: "Wizz Air Malta" }, number: "W4 1" }), /al-logo/);
});

test("build: open airlines, current logos (no end date), preferred first", () => {
  const rows = [
    { a: "http://www.wikidata.org/entity/Q1", aLabel: "Air One", iata: "A1", icao: "AAA", logo: "http://commons.wikimedia.org/wiki/Special:FilePath/Old.svg", rank: "x#NormalRank", ended: "true", closed: "false" },
    { a: "http://www.wikidata.org/entity/Q1", aLabel: "Air One", iata: "A1", icao: "AAA", logo: "http://commons.wikimedia.org/wiki/Special:FilePath/New.svg", rank: "x#NormalRank", ended: "false", closed: "false" },
    { a: "http://www.wikidata.org/entity/Q1", aLabel: "Air One", iata: "A1", icao: "AAA", logo: "http://commons.wikimedia.org/wiki/Special:FilePath/Best.svg", rank: "x#PreferredRank", ended: "false", closed: "false" },
    { a: "http://www.wikidata.org/entity/Q2", aLabel: "Gone Air", iata: "G1", icao: "GGG", logo: "http://commons.wikimedia.org/wiki/Special:FilePath/G.svg", rank: "x#NormalRank", ended: "false", closed: "true" },
    { a: "http://www.wikidata.org/entity/Q3", aLabel: "Q3", iata: "N1", icao: "", logo: "", rank: "", ended: "", closed: "false" },
  ];
  const out = groupAirlines(rows);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { qid: "Q1", name: "Air One", iata: "A1", icao: ["AAA"], logos: ["Best.svg", "New.svg"], closed: false });
});

test("build: licence rule as for photos; thumbnail width; file name", () => {
  const meta = (lic, artist = "") => ({ mime: "image/svg+xml", width: 200, height: 100, descriptionurl: "https://commons.wikimedia.org/wiki/File:X.svg", extmetadata: { LicenseShortName: { value: lic }, Artist: { value: artist } } });
  assert.ok(toLogo(meta("Public domain")).logo);
  assert.equal(toLogo(meta("CC BY-SA 3.0", "Someone")).logo.author, "Someone");
  assert.match(toLogo(meta("CC BY-SA 3.0")).reject, /no author/);
  assert.match(toLogo(meta("Copyrighted free use")).reject, /licence/);
  assert.match(toLogo({ ...meta("Public domain"), mime: "image/gif" }).reject, /type/);
  assert.equal(thumbWidth(130, 92), 120);
  assert.equal(thumbWidth(244, 30), 250);
  assert.equal(logoFileName("W6", "Q335147", "png"), "W6-Q335147.png");
});

test("generated logo data is sane", () => {
  const m = JSON.parse(readFileSync(new URL("../public/data/airline-logos.json", import.meta.url), "utf8"));
  const all = Object.values(m.logos).flat();
  assert.ok(all.length >= 300, "expected at least 300 logos");
  for (const l of all) {
    assert.match(l.src, /^\/data\/logos\/[A-Z0-9]{2}-Q\d+\.(png|jpg|webp)$/);
    assert.ok(existsSync(new URL("../public" + l.src, import.meta.url)), l.src);
    assert.ok(l.licence && l.page);
  }
});
