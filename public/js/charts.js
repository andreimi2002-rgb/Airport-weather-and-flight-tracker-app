// Small hand-made SVG charts (no library). They return markup strings.

const hourFmt = tz => new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", hour12: false });

// Mirrored bars: departures above the axis, arrivals below, the delayed part in amber.
// buckets from insights.hourlyTraffic. Each bar group carries data-i for the tooltip.
export function trafficSvg(buckets, { tz, now = Date.now(), width = 1000, height = 210 } = {}) {
  if (!buckets.length) return "";
  const pad = { l: 26, r: 6, t: 10, b: 24 };
  const mid = pad.t + (height - pad.t - pad.b) / 2;
  const half = (height - pad.t - pad.b) / 2 - 4;
  const max = Math.max(1, ...buckets.map(b => Math.max(b.dep, b.arr)));
  const step = (width - pad.l - pad.r) / buckets.length;
  const bw = Math.max(4, Math.min(34, step * 0.62));
  const y = v => (v / max) * half;
  const fmt = hourFmt(tz);
  let out = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Scheduled departures and arrivals per hour">`;
  out += `<defs><linearGradient id="gDep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ce0bd"/><stop offset="1" stop-color="#8ce0bd" stop-opacity=".35"/></linearGradient><linearGradient id="gArr" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#8bbcff"/><stop offset="1" stop-color="#8bbcff" stop-opacity=".35"/></linearGradient></defs>`;
  // grid: max value lines
  out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${mid}" y2="${mid}" stroke="#2e3d4e"/>`;
  out += `<text x="${pad.l - 6}" y="${mid - half + 4}" text-anchor="end" font-size="10" fill="#6b7c8f" font-family="JetBrains Mono,monospace">${max}</text>`;
  out += `<text x="${pad.l - 6}" y="${mid + half + 4}" text-anchor="end" font-size="10" fill="#6b7c8f" font-family="JetBrains Mono,monospace">${max}</text>`;
  out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${mid - half}" y2="${mid - half}" stroke="#1d2834" stroke-dasharray="2 4"/><line x1="${pad.l}" x2="${width - pad.r}" y1="${mid + half}" y2="${mid + half}" stroke="#1d2834" stroke-dasharray="2 4"/>`;
  buckets.forEach((b, i) => {
    const cx = pad.l + step * i + step / 2, x = cx - bw / 2;
    const past = b.start + 3600000 <= now;
    const op = past ? 0.45 : 1;
    out += `<g data-i="${i}" opacity="${op}">`;
    out += `<rect x="${pad.l + step * i}" y="${pad.t}" width="${step}" height="${height - pad.t - pad.b}" fill="transparent"/>`;
    if (b.dep) {
      const h = y(b.dep), hl = y(b.depLate);
      out += `<rect x="${x}" y="${mid - h - 1}" width="${bw}" height="${h}" rx="3" fill="url(#gDep)"/>`;
      if (hl) out += `<rect x="${x}" y="${mid - h - 1}" width="${bw}" height="${hl}" rx="3" fill="#f3c477"/>`;
    }
    if (b.arr) {
      const h = y(b.arr), hl = y(b.arrLate);
      out += `<rect x="${x}" y="${mid + 1}" width="${bw}" height="${h}" rx="3" fill="url(#gArr)"/>`;
      if (hl) out += `<rect x="${x}" y="${mid + 1 + h - hl}" width="${bw}" height="${hl}" rx="3" fill="#f3c477"/>`;
    }
    out += `</g>`;
    const every = buckets.length > 16 ? 2 : 1;
    if (i % every === 0) out += `<text x="${cx}" y="${height - 6}" text-anchor="middle" font-size="10.5" fill="#8192a4" font-family="JetBrains Mono,monospace">${fmt.format(new Date(b.start))}</text>`;
  });
  // "now" marker
  const first = buckets[0].start, total = buckets.length * 3600000;
  if (now >= first && now <= first + total) {
    const nx = pad.l + ((now - first) / total) * (width - pad.l - pad.r);
    out += `<line x1="${nx}" x2="${nx}" y1="${pad.t - 4}" y2="${height - pad.b + 2}" stroke="#8ce0bd" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    out += `<rect x="${nx - 18}" y="${pad.t - 10}" width="36" height="15" rx="5" fill="#8ce0bd"/><text x="${nx}" y="${pad.t + 1}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#092017" font-family="JetBrains Mono,monospace">NOW</text>`;
  }
  return out + `</svg>`;
}

// Temperature line with precipitation bars for the weather drawer.
// hours: [{ time, tempC, precipMm }]
export function forecastSvg(hours, { tz, width = 680, height = 190 } = {}) {
  const pts = hours.filter(h => h.tempC !== null && h.tempC !== undefined);
  if (pts.length < 2) return "";
  const pad = { l: 30, r: 10, t: 22, b: 26 };
  const temps = pts.map(h => h.tempC);
  let lo = Math.floor(Math.min(...temps)) - 1, hi = Math.ceil(Math.max(...temps)) + 1;
  if (hi - lo < 4) { hi += 2; lo -= 2; }
  const n = hours.length, step = (width - pad.l - pad.r) / Math.max(1, n - 1);
  const X = i => pad.l + i * step;
  const Y = t => pad.t + (1 - (t - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const maxP = Math.max(2, ...hours.map(h => h.precipMm || 0));
  const fmt = hourFmt(tz);
  let out = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Temperature and precipitation forecast">`;
  out += `<defs><linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3c477" stop-opacity=".35"/><stop offset="1" stop-color="#f3c477" stop-opacity="0"/></linearGradient></defs>`;
  for (const t of [lo + 1, Math.round((lo + hi) / 2), hi - 1]) {
    out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="#1d2834" stroke-dasharray="2 4"/><text x="${pad.l - 6}" y="${Y(t) + 3}" text-anchor="end" font-size="10" fill="#6b7c8f" font-family="JetBrains Mono,monospace">${t}°</text>`;
  }
  hours.forEach((h, i) => {
    if (h.precipMm > 0) {
      const ph = (h.precipMm / maxP) * (height - pad.t - pad.b) * 0.5;
      out += `<rect x="${X(i) - step * 0.3}" y="${height - pad.b - ph}" width="${step * 0.6}" height="${ph}" rx="2" fill="#8bbcff" opacity=".55"/>`;
    }
    if (i % 3 === 0) out += `<text x="${X(i)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#8192a4" font-family="JetBrains Mono,monospace">${fmt.format(new Date(h.time))}</text>`;
  });
  const line = hours.map((h, i) => (h.tempC === null || h.tempC === undefined ? null : [X(i), Y(h.tempC)])).filter(Boolean);
  const d = line.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  out += `<path d="${d} L${line.at(-1)[0]} ${height - pad.b} L${line[0][0]} ${height - pad.b} Z" fill="url(#gT)"/>`;
  out += `<path d="${d}" fill="none" stroke="#f3c477" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  hours.forEach((h, i) => { if (i % 3 === 0 && h.tempC !== null && h.tempC !== undefined) out += `<circle cx="${X(i)}" cy="${Y(h.tempC)}" r="3" fill="#0b131b" stroke="#f3c477" stroke-width="1.8"/><text x="${X(i)}" y="${Y(h.tempC) - 8}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#eef4fa">${Math.round(h.tempC)}°</text>`; });
  return out + `</svg>`;
}
