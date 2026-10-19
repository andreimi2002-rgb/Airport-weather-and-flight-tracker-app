import test from "node:test";
import assert from "node:assert/strict";
import { typeKey, makerOf, keyChain, findType } from "../public/js/aircraft-types.js";
import { groupTypes, keysFor, buildKeyIndex } from "../scripts/lib/aircraft-type-data.mjs";

const W = "http://www.wikidata.org/entity/", F = "http://commons.wikimedia.org/wiki/Special:FilePath/", R = "http://wikiba.se/ontology#";

test("type names normalize the same way on the board and in Wikidata", () => {
  assert.equal(typeKey("Airbus A330-900 NEO"), "airbus a330 900 neo");
  assert.equal(typeKey("Airbus A321neo"), "airbus a321 neo");
  assert.equal(typeKey("Airbus A320 family"), "airbus a320");
  assert.equal(typeKey("Boeing 787 Dreamliner"), "boeing 787");
  assert.equal(typeKey("Boeing 777-300ER"), "boeing 777 300 er");
  assert.equal(typeKey("Boeing 737 MAX 8"), "boeing 737 max 8");
  assert.equal(makerOf("De Havilland Canada Dash 8"), "De Havilland Canada");
  assert.equal(makerOf("Boeing 737-800"), "Boeing");
  assert.equal(makerOf("A321neo"), null);
});

test("lookup goes from specific to general but never to just the maker", () => {
  assert.deepEqual(keyChain("Airbus A330-900 NEO"), ["airbus a330 900 neo", "airbus a330 900", "airbus a330"]);
  assert.deepEqual(keyChain("Boeing 737"), ["boeing 737"]);
  assert.deepEqual(keyChain("Airbus"), []);
  assert.deepEqual(keyChain(""), []);
});

test("Wikidata items become keys; aliases without the maker get it; shared keys are dropped", () => {
  const items = groupTypes([
    { a: W + "Q30914140", label: "Airbus A321neo", aliases: "A21N | A321neo" },
    { a: W + "Q12476717", label: "Boeing 737-800", aliases: "738 | 737-800 | B737-800 | B738" },
    { a: W + "Q6387", label: "Boeing 737", aliases: "737 | B-737 | B737" },
    { a: W + "Q999", label: "Boeing 737 Test", aliases: "B737" },        // claims "boeing b737" too
    { a: W + "Q123", label: "Some Glider 3", aliases: "" },               // unknown maker: ignored
  ], [
    { a: W + "Q30914140", img: F + "A321neo%20b.jpg", rank: R + "NormalRank" },
    { a: W + "Q30914140", img: F + "A321neo%20a.jpg", rank: R + "PreferredRank" },
  ]);
  assert.equal(items.has("Q123"), false);
  assert.deepEqual(items.get("Q30914140").images, ["A321neo a.jpg", "A321neo b.jpg"], "preferred first");
  assert.ok(keysFor(items.get("Q30914140")).has("airbus a21n"));
  assert.ok(keysFor(items.get("Q12476717")).has("boeing 737 800"));
  assert.ok(keysFor(items.get("Q12476717")).has("boeing 738"), "short alias '738' gets the maker: 'boeing 738'");
  const { index, dropped } = buildKeyIndex(items);
  assert.equal(index.get("airbus a321 neo"), "Q30914140");
  assert.equal(index.get("boeing 737"), "Q6387");
  assert.ok(dropped.includes("boeing b737"), "two types claim 'B737': dropped");
  assert.equal(index.has("boeing b737"), false);
});

test("findType picks the most specific type that has a photo", () => {
  const photo = { src: "https://upload.wikimedia.org/x.jpg" };
  const data = {
    types: [{ name: "Airbus A330", photo }, { name: "Airbus A330neo", photo }, { name: "Boeing 737-800", photo: null }, { name: "Boeing 737", photo }],
    keys: { "airbus a330": 0, "airbus a330 900 neo": 1, "boeing 737 800": 2, "boeing 737": 3 },
  };
  assert.equal(findType(data, "Airbus A330-900 NEO").name, "Airbus A330neo");
  assert.equal(findType(data, "Airbus A330-200").name, "Airbus A330");
  assert.equal(findType(data, "Boeing 737-800").name, "Boeing 737", "no photo for the variant: falls back to the family");
  assert.equal(findType(data, "Tupolev Tu-154"), null);
  assert.equal(findType(null, "Airbus A330"), null);
});

test("an exact label beats a family name or an alias for the same key (Airbus A320 case)", () => {
  const items = groupTypes([
    { a: W + "Q6475", label: "Airbus A320 family", aliases: "Airbus A318/319/320/321/ACJ" },
    { a: W + "Q18784360", label: "Airbus A320", aliases: "A320 | A-320 | A320ceo" },
    { a: W + "Q1", label: "Boeing 717", aliases: "" },
    { a: W + "Q2", label: "Boeing 717", aliases: "" },
  ], []);
  const { index, dropped } = buildKeyIndex(items);
  assert.equal(index.get("airbus a320"), "Q18784360", "exact label wins over 'family' stripped");
  assert.ok(dropped.includes("boeing 717"), "two exact labels: still ambiguous");
});

test("an alias never takes a name whose real owner has no photo (Boeing 717 vs C-135)", () => {
  const items = groupTypes([
    { a: W + "Q6401", label: "Boeing 717", aliases: "MD-95" },
    { a: W + "Q15", label: "Boeing C-135 Stratolifter", aliases: "Boeing 717" },
  ], [{ a: W + "Q15", img: F + "C135.jpg", rank: R + "NormalRank" }]);
  const { index } = buildKeyIndex(items);           // decided among all types
  assert.equal(index.get("boeing 717"), "Q6401");
  const withPhoto = new Set(["Q15"]);
  const kept = new Map([...index].filter(([, q]) => withPhoto.has(q)));
  assert.equal(kept.has("boeing 717"), false, "no photo for the real 717 -> no photo, not the C-135");
});
