// Wikidata and Wikimedia Commons helpers shared by the photo build scripts
// (build-photos.mjs, build-aircraft-photos.mjs). Network only; no decisions.
import { csvToObjects } from "./airport-data.mjs";

const UA = "AirportLive/0.1 (https://github.com/andreimi2002-rgb/Airport-weather-and-flight-tracker-app; photo metadata build)";
const SPARQL = "https://query.wikidata.org/sparql";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every request has a time limit that also covers reading the answer
// (`read`), so a slow or silent server leads to a retry, not a hang.
export async function fetchRetry(url, { init = {}, tries = 4, timeoutMs = 60000, read = res => res } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, ...(init.headers || {}) } });
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(3000 * i); continue; }
      return await read(res);
    } catch (err) {
      if (i >= tries) throw err;
      console.log(`  retry ${i}/${tries - 1} after: ${err.name === "TimeoutError" ? "timeout" : err.message}`);
      await sleep(3000 * i);
    }
  }
}

export async function sparql(query) {
  const text = await fetchRetry(SPARQL + "?query=" + encodeURIComponent(query), {
    init: { headers: { Accept: "text/csv" } },
    timeoutMs: 180000,
    read: res => { if (!res.ok) throw new Error(`Wikidata query failed: HTTP ${res.status}`); return res.text(); },
  });
  return csvToObjects(text);
}

// Commons file info, 50 files per request.
export async function commonsInfo(files) {
  const info = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", maxlag: "5",
      prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "1280",
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
      titles: batch.map(f => "File:" + f).join("|"),
    });
    const j = await fetchRetry(COMMONS + "?" + params, {
      read: async res => {
        if (!res.ok) throw new Error(`Commons API failed: HTTP ${res.status}`);
        const body = await res.json();
        if (body.error) throw new Error(`Commons API: ${body.error.code}`); // e.g. maxlag: servers busy, retry
        return body;
      },
    });
    const back = new Map();
    for (const n of j.query?.normalized ?? []) back.set(n.to, n.from);
    for (const p of j.query?.pages ?? []) {
      const asked = (back.get(p.title) ?? p.title).replace(/^File:/, "");
      info.set(asked, p.imageinfo?.[0] ?? null);
    }
    if ((i / 50) % 20 === 0 || i + 50 >= files.length) console.log(`  Commons metadata ${Math.min(i + 50, files.length)}/${files.length}`);
  }
  return info;
}

// Checks that a URL really returns an image. Returns "ok" or a reason.
export async function checkLink(url) {
  try {
    const res = await fetchRetry(url, { init: { method: "HEAD" }, tries: 2, timeoutMs: 20000 });
    if (res.status === 429) return "rate-limited";
    if (!res.ok) return "HTTP " + res.status;
    return /^image\//.test(res.headers.get("content-type") || "") ? "ok" : "not an image";
  } catch (err) {
    return err.name === "TimeoutError" ? "timeout" : "network error";
  }
}

// Round 1: 2 at a time. Round 2: failures again, one at a time with a
// pause, so a temporary "too many requests" doesn't remove good photos.
export async function verify(urls) {
  const ok = new Set();
  let failed = [];
  const list = [...urls];
  let done = 0;
  async function worker() {
    while (list.length) {
      const url = list.pop();
      if ((await checkLink(url)) === "ok") ok.add(url); else failed.push(url);
      if (++done % 500 === 0 || done === urls.size) console.log(`  Checked ${done}/${urls.size} photo links`);
    }
  }
  await Promise.all(Array.from({ length: 2 }, worker));
  const reasons = {};
  if (failed.length) {
    console.log(`  ${failed.length} failed; checking them again slowly…`);
    for (const url of failed) {
      await sleep(1000);
      const r = await checkLink(url);
      if (r === "ok") ok.add(url); else reasons[r] = (reasons[r] || 0) + 1;
    }
  }
  return { ok, reasons };
}

