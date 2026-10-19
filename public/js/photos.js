// Airport and city photos (Wikimedia Commons, prepared by
// scripts/build-photos.mjs). Photos for airports starting with "O" live in
// /data/photos/O.json, so only a small file is loaded per airport.

const shards = new Map(); // "O" -> Promise of { OTP: {...}, ... }

function loadShard(key) {
  if (!shards.has(key)) {
    const p = fetch(`/data/photos/${encodeURIComponent(key)}.json`).then(res => {
      if (res.status === 404) return {};
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
    // A failed download can be retried next time.
    p.catch(() => shards.delete(key));
    shards.set(key, p);
  }
  return shards.get(key);
}

// Returns { airport: photo|null, city: { name, photo|null }|null } or
// throws when the photo list could not be downloaded.
export async function getPhotos(iata) {
  const entry = (await loadShard(String(iata)[0].toUpperCase()))[iata];
  return { airport: entry?.airport ?? null, city: entry?.city ?? null };
}

// "Photo: Alexrap · CC BY-SA 4.0" as safe HTML with links to the file page
// and the licence. `esc` escapes text for HTML.
export function creditHtml(photo, esc) {
  if (!photo) return "";
  const safeUrl = u => (/^https:\/\//.test(u || "") ? esc(u) : null);
  const page = safeUrl(photo.page);
  const lic = safeUrl(photo.licenceUrl);
  const who = photo.author ? esc(photo.author) : "Unknown author";
  const author = page ? `<a href="${page}" target="_blank" rel="noopener">${who}</a>` : who;
  const licence = lic ? `<a href="${lic}" target="_blank" rel="noopener">${esc(photo.licence)}</a>` : esc(photo.licence);
  return `Photo: ${author} · ${licence} · Wikimedia Commons`;
}
