import { test } from "node:test";
import assert from "node:assert/strict";
import { liveStatus, statusView, LIVE_FRESH_MS } from "../public/js/flights.js";

const OTP = { iata: "OTP", lat: 44.5711, lon: 26.085 };
const VLC = { iata: "VLC", lat: 39.4893, lon: -0.4816 };
const now = Date.parse("2026-10-19T12:00:00Z");
const at = min => ({ utc: new Date(now + min * 60000).toISOString() });
// OTP -> VLC, left 3 h ago, due 10 min ago
const flight = (dep = -180, arr = -10, extra = {}) => ({ id: "x", status: "en-route", departure: { scheduled: at(dep) }, arrival: { scheduled: at(arr) }, ...extra });
const ac = extra => ({ seenAt: new Date(now - 30000).toISOString(), onGround: false, altitudeFt: 36000, verticalRateFpm: 0, lat: 42, lon: 12, ...extra });

test("liveStatus: on the ground at the destination after departure -> landed", () => {
  const s = liveStatus(flight(), ac({ onGround: true, lat: 39.49, lon: -0.47 }), OTP, VLC, now);
  assert.equal(s.label, "Landed (live data)");
  assert.equal(s.cls, "landed");
});

test("liveStatus: on the ground at the destination before departure -> no claim", () => {
  assert.equal(liveStatus(flight(60, 240), ac({ onGround: true, lat: 39.49, lon: -0.47 }), OTP, VLC, now), null);
});

test("liveStatus: on the ground at the origin -> not left yet", () => {
  const s = liveStatus(flight(-5, 175), ac({ onGround: true, lat: 44.57, lon: 26.09 }), OTP, VLC, now);
  assert.equal(s.label, "On the ground at OTP (live data)");
});

test("liveStatus: on the ground elsewhere -> no claim", () => {
  assert.equal(liveStatus(flight(), ac({ onGround: true }), OTP, VLC, now), null);
});

test("liveStatus: cruising -> in the air; near destination and descending -> approaching", () => {
  assert.equal(liveStatus(flight(), ac(), OTP, VLC, now).label, "In the air (live data)");
  assert.equal(liveStatus(flight(), ac({ lat: 39.9, lon: -0.2, altitudeFt: 9000, verticalRateFpm: -1200 }), OTP, VLC, now).label, "Approaching VLC (live data)");
  // Near but level and high (passing over): still just in the air
  assert.equal(liveStatus(flight(), ac({ lat: 39.9, lon: -0.2, altitudeFt: 35000, verticalRateFpm: 0 }), OTP, VLC, now).label, "In the air (live data)");
});

test("liveStatus: old or position-less data -> null", () => {
  assert.equal(liveStatus(flight(), ac({ seenAt: new Date(now - LIVE_FRESH_MS - 1000).toISOString() }), OTP, VLC, now), null);
  assert.equal(liveStatus(flight(), ac({ lat: null }), OTP, VLC, now), null);
  assert.equal(liveStatus(flight(), null, OTP, VLC, now), null);
});

test("statusView: fresh live status wins over 'No recent update', not over a cancellation", () => {
  const f = flight(-180, -30, { status: "expected" });
  assert.equal(statusView(f, now).label, "No recent update");
  const live = { label: "Landed (live data)", cls: "landed", at: new Date(now - 60000).toISOString() };
  assert.equal(statusView(f, now, live).label, "Landed (live data)");
  assert.equal(statusView({ ...f, status: "cancelled" }, now, live).label, "Cancelled");
  // Too old: back to the provider's view
  assert.equal(statusView(f, now + LIVE_FRESH_MS, live).label, "No recent update");
});
