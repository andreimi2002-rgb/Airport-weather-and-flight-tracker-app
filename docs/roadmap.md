# Airport Live roadmap

Agreed with the owner on 2026-10-19. Work in this order, one branch and one preview per step. The order can change; ask the owner before reordering.

**Long-term goal:** step by step, toward what [FlightAware](https://www.flightaware.com/) offers, with a much nicer design that stays close to the current dark aviation dashboard. The limits are data cost and display licensing, not code: the free tiers we use allow a personal prototype, not a busy public site.

## Done
1. Global airport data and search, a page per airport (`/airport/OTP`).
2. Airport and city photos from Wikimedia Commons with credits, plus the photo builder fix (all Wikidata photos, "Attribution" licence).
3. Live weather: METAR/TAF (aviationweather.gov) and forecast (MET Norway).
4. Live flights from AeroDataBox (free Basic plan), with demo fallback, monthly budget, stale and "No recent update" states.

## Next, in order
1. **Flight detail (scope item 5)**, branch `feature/flight-detail`:
   - When a flight with a known registration is opened, look up that aircraft (1 unit): manufacturer, exact model, age, seats, engines, delivery date.
   - Show that aircraft's photo, found by registration, with credit and a "matched automatically" label.
   - Cache each aircraft for 7 days (the Basic plan's limit).
   - Anything not supplied shows "Not available".
   - Optional: a "Check this flight" button for the current status (2 units per press).
2. **Aircraft type photos** (owner chose option 1, 2026-10-19), branch `feature/aircraft-type-photos`: many flights (e.g. at OTP) have no registration, so no photo of the actual aircraft. Prepare one representative photo per common aircraft type (about 100–150 types) from Wikidata + Wikimedia Commons with a build script, same licence/credit/link rules as airport photos. Label it "Representative photo · <type> · not this aircraft". A photo of the actual aircraft, when found, always wins. No AeroDataBox units used.
3. **Missing photos rule**: when two Wikidata items share an airport's IATA and ICAO codes (civil airport plus an air base or a closed airport: Austin, Aalborg, Bergen, Timișoara), drop items that are dissolved or military air bases, and match only if exactly one is left.
4. **Weather panel**: clickable, with a detailed view (decoded TAF, more forecast hours, more fields).

**Done in `feature/redesign` (2026-10-19):** step 4 (clickable weather with decoded METAR/TAF, 24 h chart) and part of stage A (a link per flight on the airport page, `?flight=`), plus airport analytics from the board and the phone board fix from item 6.

**Real aircraft photos (2026-10-19, `feature/real-aircraft-photos`):** Planespotters.net photo by registration, registration from adsb.lol live data when the board has none. Replaces the Wikimedia aircraft-type photos idea (owner found photos in another airline's livery misleading).

## Then, toward FlightAware (stages A–E)
| Stage | What | Needs |
|---|---|---|
| A | A page per flight (`/flight/RO391`) and search by flight number | Same provider, 2 units per lookup |
| B | Aircraft pages (`/aircraft/YR-ASA`): registration history, photos | Same provider |
| C | Live map with aircraft positions | An ADS-B source (e.g. OpenSky, non-commercial only) and a map library; the owner must lift the "no map yet" rule first |
| D | Alerts ("tell me when RO391 boards") and installable app (PWA) | AeroDataBox webhooks (paid per update) |
| E | Statistics: airport delays, history | A paid plan or data collected over time |

## Last (owner's choice, 2026-10-19)
**Saved airports and board view (scope item 6)**:
- home airport and shortcuts between saved airports;
- a clean one-screen board for a desktop monitor, tablet or phone;
- fix the sideways-scrolling flight table on phones (can be pulled forward on its own if the owner asks).

Before stage C, the single-page app will likely need to move to React/Vite. Propose it only when the code actually needs it, and keep the design exactly as it is.

## Later
Native widget, and a licensing review before any public launch.
