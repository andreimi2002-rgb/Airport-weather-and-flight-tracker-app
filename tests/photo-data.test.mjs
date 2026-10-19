import test from "node:test";
import assert from "node:assert/strict";
import { fileNameFromFilePath, groupAirportItems, matchAirport, groupCities, matchCity, acceptLicence, cleanAuthor, toPhoto, shardKey, rankOrder } from "../scripts/lib/photo-data.mjs";

const W = "http://www.wikidata.org/entity/";
const FP = "http://commons.wikimedia.org/wiki/Special:FilePath/";

test("fileNameFromFilePath decodes Commons file names", () => {
  assert.equal(fileNameFromFilePath(FP + "HC%20arrivals.jpg"), "HC arrivals.jpg");
  assert.equal(fileNameFromFilePath(""), null);
});

test("matchAirport: single item, ICAO conflict, ambiguity", () => {
  const byIata = groupAirportItems([
    { a: W + "Q1", iata: "OTP", icao: "LROP", img: FP + "b.jpg" },
    { a: W + "Q1", iata: "OTP", icao: "LROP", img: FP + "a.jpg" },
    { a: W + "Q2", iata: "OTP", icao: "XXXX", img: FP + "wrong.jpg" },
    { a: W + "Q3", iata: "DUP", icao: "", img: FP + "x.jpg" },
    { a: W + "Q4", iata: "DUP", icao: "", img: FP + "y.jpg" },
    { a: W + "Q5", iata: "NOI", icao: "", img: "" },
  ]);
  assert.deepEqual(matchAirport({ iata: "OTP", icao: "LROP" }, byIata), { qid: "Q1", images: ["a.jpg", "b.jpg"] }, "ICAO-conflicting item dropped, photos in stable order");
  assert.equal(matchAirport({ iata: "DUP", icao: null }, byIata), null, "two items, nothing to decide -> skip");
  assert.deepEqual(matchAirport({ iata: "NOI", icao: "ABCD" }, byIata), { qid: "Q5", images: [] }, "item without ICAO is accepted");
  assert.equal(matchAirport({ iata: "ZZZ", icao: null }, byIata), null);
});

test("matchCity: single city, municipality tie-break, ambiguous, no label", () => {
  const cities = groupCities([
    { a: W + "Q1", city: W + "Q19660", cityLabel: "Bucharest", cimg: FP + "Bucharest.jpg" },
    { a: W + "Q2", city: W + "Q10", cityLabel: "Minneapolis", cimg: FP + "m.jpg" },
    { a: W + "Q2", city: W + "Q11", cityLabel: "Saint Paul", cimg: FP + "s.jpg" },
    { a: W + "Q3", city: W + "Q12", cityLabel: "Dallas", cimg: "" },
    { a: W + "Q3", city: W + "Q13", cityLabel: "Fort Worth", cimg: "" },
    { a: W + "Q4", city: W + "Q99", cityLabel: "Q99", cimg: FP + "q.jpg" },
  ]);
  assert.deepEqual(matchCity({ city: "Otopeni" }, "Q1", cities), { qid: "Q19660", name: "Bucharest", images: ["Bucharest.jpg"] });
  assert.equal(matchCity({ city: "Saint Paul" }, "Q2", cities).name, "Saint Paul");
  assert.equal(matchCity({ city: "Grapevine" }, "Q3", cities), null, "two cities, none matching -> skip");
  assert.equal(matchCity({ city: "X" }, "Q4", cities), null, "no English name -> skip");
  assert.equal(matchCity({ city: "X" }, "Q404", cities), null);
});

test("acceptLicence allows only free licences", () => {
  for (const ok of ["Public domain", "CC0", "CC BY 2.0", "CC BY-SA 4.0", "CC BY-SA 3.0 de", "PD-USGov", "Attribution", "FAL", "FAL 1.3", "Free Art License", "LAL 1.3"]) assert.ok(acceptLicence(ok), ok);
  for (const bad of ["", "CC BY-NC 2.0", "CC BY-ND 4.0", "GFDL", "All rights reserved", "Fair use", "Attribution-NonCommercial", "Attribution NoDerivs"]) assert.ok(!acceptLicence(bad), bad);
});

test("cleanAuthor turns Commons HTML into short text", () => {
  assert.equal(cleanAuthor('<a href="//commons.wikimedia.org/wiki/User:Alexrap">Alexrap</a>'), "Alexrap");
  assert.equal(cleanAuthor('Original Uploader was <a href="x">Cristibur</a> (<a href="y">talk</a>) at <a href="z">en.wikipedia</a>.'), "Cristibur");
  assert.equal(cleanAuthor("Ana &amp; Ion"), "Ana & Ion");
  assert.equal(cleanAuthor('<a href="x">Magercu</a> at <a href="y">ro.Wikipedia</a> . Uploaded 00:40, 19 March 2007 (UTC) to en:Wikipedia by Cristi'), "Magercu");
  assert.equal(cleanAuthor('<a href="x">User:KenzieAbraham</a>'), "KenzieAbraham");
  assert.ok(cleanAuthor("x".repeat(200)).length <= 90);
});

const meta = (licence, artist, url) => ({ LicenseShortName: { value: licence }, Artist: { value: artist }, ...(url ? { LicenseUrl: { value: url } } : {}) });
const info = (o = {}) => ({ mime: "image/jpeg", width: 2000, thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1280px-X.jpg?utm_source=x", descriptionurl: "https://commons.wikimedia.org/wiki/File:X.jpg", extmetadata: meta("CC BY-SA 4.0", "Alexrap", "https://creativecommons.org/licenses/by-sa/4.0"), ...o });

test("toPhoto builds a credited record and rejects unusable files", () => {
  const ok = toPhoto(info(), "2026-10-19").photo;
  assert.deepEqual(ok, { src: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1280px-X.jpg", page: "https://commons.wikimedia.org/wiki/File:X.jpg", author: "Alexrap", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0", verified: "2026-10-19" });
  assert.equal(toPhoto(null).reject, "missing");
  assert.match(toPhoto(info({ mime: "image/svg+xml" })).reject, /^type/, "maps/logos (SVG) rejected");
  assert.equal(toPhoto(info({ width: 500 })).reject, "too small");
  assert.match(toPhoto(info({ extmetadata: meta("CC BY-NC 2.0", "A") })).reject, /^licence/);
  assert.equal(toPhoto(info({ extmetadata: meta("CC BY 2.0", "") })).reject, "no author", "CC BY needs an author");
  assert.equal(toPhoto(info({ extmetadata: meta("Public domain", "") })).photo.author, null, "public domain without author is fine");
  assert.equal(toPhoto(info({ thumburl: "https://evil.example/x.jpg" })).reject, "unexpected url");
});

test("shardKey", () => {
  assert.equal(shardKey("OTP"), "O");
  assert.equal(shardKey("1AB"), "1");
});

test("all photos are kept, preferred rank first (Schiphol/Amsterdam case)", () => {
  const W = "http://www.wikidata.org/entity/", F = "http://commons.wikimedia.org/wiki/Special:FilePath/";
  const R = "http://wikiba.se/ontology#";
  const byIata = groupAirportItems([
    { a: W + "Q9694", iata: "AMS", icao: "EHAM", img: F + "Schiphol%20Tower.jpg", rank: R + "NormalRank" },
    { a: W + "Q9694", iata: "AMS", icao: "EHAM", img: F + "Ams-above-2007.jpg", rank: R + "PreferredRank" },
    { a: W + "Q9694", iata: "AMS", icao: "EHAM", img: F + "Schiphol%202016%20PH-PBA%20(29097500693).jpg", rank: R + "NormalRank" },
  ]);
  assert.deepEqual(matchAirport({ iata: "AMS", icao: "EHAM" }, byIata).images,
    ["Ams-above-2007.jpg", "Schiphol 2016 PH-PBA (29097500693).jpg", "Schiphol Tower.jpg"]);
  const cities = groupCities([
    { a: W + "Q9694", city: W + "Q727", cityLabel: "Amsterdam", cimg: F + "Imagen.png", crank: R + "NormalRank" },
    { a: W + "Q9694", city: W + "Q727", cityLabel: "Amsterdam", cimg: F + "Amsterdam%20airphoto.jpg", crank: R + "PreferredRank" },
  ]);
  assert.deepEqual(matchCity({ city: "Amsterdam" }, "Q9694", cities).images, ["Amsterdam airphoto.jpg", "Imagen.png"]);
  assert.equal(rankOrder(R + "PreferredRank"), 0);
  assert.equal(rankOrder(undefined), 1, "rows without rank (old format) count as normal");
});

test("same IATA+ICAO on two items: the open civil airport wins over an air base or a closed airport", () => {
  const W = "http://www.wikidata.org/entity/", F = "http://commons.wikimedia.org/wiki/Special:FilePath/";
  const byIata = groupAirportItems([
    { a: W + "Q478620", iata: "AAL", icao: "EKYT", img: F + "Aalborg.jpg", closed: "false", base: "false" },
    { a: W + "Q2886531", iata: "AAL", icao: "EKYT", img: F + "Jet.jpg", closed: "false", base: "true" },
    { a: W + "Q1430913", iata: "AUS", icao: "KAUS", img: F + "AUS.jpg", closed: "false", base: "false" },
    { a: W + "Q7347861", iata: "AUS", icao: "KAUS", img: F + "Mueller.jpg", closed: "true", base: "false" },
    { a: W + "Q1", iata: "XXX", icao: "XXXX", closed: "false", base: "false" },
    { a: W + "Q2", iata: "XXX", icao: "XXXX", closed: "false", base: "false" },
  ]);
  assert.equal(matchAirport({ iata: "AAL", icao: "EKYT" }, byIata).qid, "Q478620");
  assert.equal(matchAirport({ iata: "AUS", icao: "KAUS" }, byIata).qid, "Q1430913");
  assert.equal(matchAirport({ iata: "XXX", icao: "XXXX" }, byIata), null, "two open civil items: still no guess");
});

test("several served cities: a clearly dominant one is chosen; the Wikivoyage banner is the last photo", () => {
  const W = "http://www.wikidata.org/entity/", F = "http://commons.wikimedia.org/wiki/Special:FilePath/";
  const cities = groupCities([
    { a: W + "Q1", city: W + "Q239", cityLabel: "Brussels", cimg: F + "Brussels.jpg" },
    { a: W + "Q1", city: W + "Q2", cityLabel: "Zaventem" },
    { a: W + "Q9", city: W + "Q16557", cityLabel: "Dallas" },
    { a: W + "Q9", city: W + "Q16558", cityLabel: "Fort Worth" },
    { a: W + "Q5", city: W + "Q10686", cityLabel: "Belfast", cimg: F + "Small.jpg" },
  ], [
    { city: W + "Q239", pop: "1222637", cbanner: F + "Brussels%20banner.jpg" },
    { city: W + "Q2", pop: "33000" },
    { city: W + "Q16557", pop: "1304379" },
    { city: W + "Q16558", pop: "956709" },
    { city: W + "Q10686", pop: "345000", cbanner: F + "Belfast%20Wikivoyage%20Banner.png" },
  ]);
  assert.deepEqual(matchCity({ city: "Steenokkerzeel" }, "Q1", cities), { qid: "Q239", name: "Brussels", images: ["Brussels.jpg", "Brussels banner.jpg"] });
  assert.equal(matchCity({ city: "Grapevine" }, "Q9", cities), null, "Dallas is not 3x Fort Worth: no guess");
  assert.equal(matchCity({ city: "Dallas" }, "Q9", cities).name, "Dallas", "a name match still wins");
  assert.deepEqual(matchCity({ city: "Belfast" }, "Q5", cities).images, ["Small.jpg", "Belfast Wikivoyage Banner.png"]);
});
