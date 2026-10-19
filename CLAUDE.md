# Airport Live

Real airport information app. Today it is a single-file visual prototype (`index.html`, ~34 KB, no build step, deployed on Netlify from GitHub).

## Platforms
- This is NOT a phone-only app. It must work equally well in a desktop/laptop browser and on a phone (and tablet). Design and test every feature for both: responsive layouts, mouse/keyboard and touch input, and sensible use of wide screens (not just a stretched mobile view).
- The web app is the main product. Installable PWA and a native iPhone widget are later extras, never a replacement for the browser version.
- Each Netlify preview report must say what to check on desktop and what to check on phone.

## Non-negotiables
- Keep the existing dark, minimalist aviation dashboard design (colors, cards, tables, spacing, modals). Do not swap in a generic template.
- Never invent live flight, aircraft, weather or image data. Label demo data as demo.
- No API keys in client code or git. Provider calls go through server-side (Netlify Functions) with caching and rate limiting.
- No paid subscriptions or charges. Document providers, don't buy.
- No map and no native widget yet.
- Test anything claimed to work. Report what works, what is incomplete, and which external services are still needed.

## Phase 1 findings (from inspecting the prototype)
- Architecture: one HTML file with inline CSS and JS. Plain DOM, `getElementById`, string-template rendering. No framework, no dependencies.
- Airports: `airports` object hardcoded to SEA, LHR, OTP, JFK. The picker is generated from that object.
- Bug: `flights` is one hardcoded Seattle-only list (`from:"SEA"`), shown for every airport. Switching to LHR still shows Seattle flights.
- Images: external Unsplash URLs hotlinked by fixed photo ID, with no `onerror` or fallback. One ID is reused for the SEA airport photo, the OTP airport photo and the aircraft photo; another for LHR and JFK. So images are not airport-specific, and any removed/blocked URL leaves a broken image. URLs were not tested (no network access during inspection).
- Weather: hardcoded demo values per airport, including a sample METAR string.
- Already good: airport-local clock using real time zones, responsive layout, flight detail modal, search/status filters.

## Proposed smallest changes
1. Split data from UI: `data/` (airports, images metadata), `netlify/functions/` (airports search, flights, weather), keep the existing CSS and markup.
2. Airport data: OurAirports (public domain) converted to a compact indexed JSON; search by name, IATA, ICAO, city, country via a function; route per airport (`/airport/OTP`).
3. Images: separate metadata file (url, credit, license, source page, verified date) per airport and city; verified by a script that checks each URL returns an image; CSS gradient fallback on error.
4. Flights: provider adapter interface (AeroDataBox, FlightAware AeroAPI, aviationstack, etc.), normalized `Flight` and `Aircraft` models, stale-data and error states. Document coverage, limits, pricing and redistribution terms before choosing.
5. Weather: aviationweather.gov METAR/TAF (via function, cached) plus Open-Meteo forecast.

## First deliverable
Implement items 1–3 with the design preserved, run checks, test airport switching and image fallbacks, and report honestly. Do not claim live flight data until a real provider is integrated and verified.

## Working mode (how to collaborate with me)
- Narrate as you work: before each step say what you are about to do and why, and after it say what happened. Keep updates short and plain.
- Ask me before any important decision: choosing a library, dataset, data provider or image source; changing the design; anything that costs money, needs an account or API key, or adds a dependency. Offer 2–3 options with a recommendation, then wait.
- Don't ask about small, reversible details. Decide, tell me, and continue.
- Never work on `main`. For each task create a branch (`feature/<short-name>`), commit in small steps with clear messages, and push it.
- After pushing, open a pull request (use the `gh` CLI if available; otherwise give me the compare link) and give me the Netlify deploy preview URL for that branch. If no preview appears, tell me which Netlify setting to check instead of guessing.
- With each preview, tell me exactly what to test on my phone and what is still incomplete.
- Merge to `main` only after I say so. If something breaks, explain what happened and how to roll back.
- Never claim something works unless you ran it or tested it. Say what you could not test.

## Current scope (updated) — work in this order, one branch and preview per item
1. Global airport data and search, plus a page and URL for each airport.
2. Reliable airport and city photos with credit, license, URL testing and fallbacks.
3. Real weather: METAR/TAF (aviationweather.gov) and forecast (Open-Meteo) via a cached Netlify function.
4. Real flight data: build the provider adapter with normalized Flight and Aircraft models, then connect a real provider on a free tier. Compare options first (coverage, limits, pricing, commercial display rights, aircraft details) in a short markdown file and recommend one. I create the account and add the key to Netlify environment variables; do not sign up or pay yourself. Until it is connected and verified, show clearly labeled demo flights. Include loading, error, empty and stale-data states and a "last updated" label.
5. Flight detail page/view: aircraft type, manufacturer, registration, aircraft photo (with credit), route distance and duration, but only fields the provider actually supplies. Show "not available" for the rest; never fill gaps with invented data.
6. Saved airports and shortcuts: pin multiple airports (stored locally for now), a bookmarkable URL for each airport (e.g. /airport/OTP), a "home airport" that opens by default, and a clean one-screen board view suitable for leaving open on a desktop monitor, tablet or phone.

Later (not now): installable PWA polish, alerts, Explorer layer, native widget, public launch licensing review.

In review: item 5 (branch `feature/flight-detail`): `/api/aircraft/<REG>` (1 unit, stored 7 days) and `/api/flight-status/<NUMBER>/<DATE>/<IATA>` (2 units, 5 min) in `netlify/functions/flight-details.mjs`; budget now in units (`netlify/lib/flights/budget.mjs`, cap 360, env `FLIGHTS_MONTHLY_UNIT_CAP`). Manufacturer only from a known name at the start of the provider's type name. "No recent update" now also requires no provider update after the expected time (`updatedAt`).

**Agreed order from here (2026-10-19), details in `docs/roadmap.md`:** item 5 (flight detail) → aircraft type photos from Wikimedia (owner's choice: representative photo per aircraft type, labelled "not this aircraft", for flights without a registration) → missing-photos rule (Austin, Aalborg, Bergen, Timișoara) → clickable weather panel → stages A–E toward FlightAware (flight pages and search, aircraft pages, live map, alerts/PWA, statistics) → item 6 last (owner's choice; the phone table fix can be pulled forward on request). Long-term goal: FlightAware-level features with the current design. Ask the owner before reordering.

## Progress and decisions (keep this updated after each item)
Local copy of the repo: `C:\Users\stroe\Downloads\airport-live-repo` (open this folder in VS Code). Netlify site: `live-airport` (Deploy Previews come from pull requests; previews need Netlify team login). The `gh` CLI is not installed: push the branch and give the owner the `pull/new/<branch>` link.

Done and merged:
- Item 1 (PR #1): ~9,000 airports from OurAirports (public domain) in `public/data/airports.json`, built by `npm run build:airports`. Time zones from mwgg/Airports (MIT); unknown/conflicting time zones stay empty. Search on the device, `/airport/OTP` addresses (netlify.toml rewrite), saved airports in localStorage, demo weather only for SEA/LHR/OTP/JFK, demo flights only for SEA.
- Item 2 (PR #2): photos from Wikidata + Wikimedia Commons, prepared by `npm run build:photos` into `public/data/photos/<letter>.json`, credited on each photo. Only public domain / CC0 / CC BY / CC BY-SA, >= 640 px, links checked. Ambiguous matches skipped, never guessed.

Owner's choices so far: OurAirports for airports; mwgg for time zones; airport search on the device (no function); no build step for now (move to React/Vite only when needed); Wikimedia photos prepared ahead, not looked up live.

Known gaps to revisit later (owner asked, not now): some airports have no airport or city photo (e.g. Timișoara TSR); some chosen photos look odd (satellite views, collages); Heathrow's only photo is GFDL (excluded); Dallas/Fort Worth has two cities so none is shown; on phones the flight table still scrolls sideways (planned for item 6).

Later, after the other scope items (owner, 2026-10-19): improve the weather panel and make weather clickable to open a detailed view (e.g. decoded TAF, more forecast hours, more fields). Owner was happy with the item 3 version for now.

In review (not merged yet):
- Item 3 (branch `feature/weather`): `/api/weather/<IATA>` Netlify Function (`netlify/functions/weather.mjs`, logic in `netlify/lib/weather.mjs`). METAR/TAF from aviationweather.gov (no key; HTTP 204 = no report), forecast from MET Norway (owner's choice over Open-Meteo: commercial use allowed, CC BY 4.0, needs identifying User-Agent). No METAR station -> say so and show forecast labelled as forecast, never borrow another station. CDN cache 5 min (1 min if a part failed), rate limit 60/min/IP. Demo weather removed.

Item 3 merged (PR #3).

Item 4 merged (PR #4, branch `feature/flights`), verified on the preview with the owner's real key (OTP board showed real flights). Owner chose **AeroDataBox via RapidAPI, free Basic plan** (400 units/month, FIDS call = 2 units, non-commercial, attribution required). Comparison in `docs/flight-providers.md`. `/api/flights/<IATA>` function; adapter in `netlify/lib/flights/aerodatabox.mjs`; budget/stale logic in `netlify/lib/flights/board.mjs` using Netlify Blobs (`@netlify/blobs`, the first runtime dependency). Key: Netlify env var `AERODATABOX_RAPIDAPI_KEY` (set by the owner in Netlify; works on the preview). Board aircraft photos are "representative" (may be a sister aircraft) and must be labelled so.

In review (2026-10-19), one PR each:
- `feature/flights-stale-status`: overdue flights (time passed >15 min, no departed/landed report) show "No recent update" instead of "Expected"; overview shows board age ("UPDATED 16:43 · 18 MIN AGO").
- `feature/photos-fix`: photo builder reads all non-deprecated Wikidata P18 photos (preferred first) and accepts the Commons "Attribution" licence. Airport photos 3,796 -> 3,824, city photos 4,331 -> 4,363; AMS fixed. Large airports without airport photo 205 -> 190, without city photo 256 -> 243.

In review (2026-10-19): `feature/photos-rule`: items sharing an airport's codes -> keep the open non-military one (closed = P576/P3999/P582, base = P31 Q695850); several served cities -> one >= 3x more populous; city's Wikivoyage banner (P948) as last photo; the city card says "THE AREA" for counties/districts/provinces/metro areas. Large airports without airport photo 190 -> 158, without city photo 243 -> 117 (AUS, AAL, BGO, TSR fixed). Merged as PR #11; fonts PR #12. Owner accepted the Free Art License (FAL / LAL) for photos (branch `feature/fal-licence`). Also in review: `feature/self-host-fonts` (Inter + JetBrains Mono in public/fonts, OFL, no Google Fonts).

Earlier note — remaining photo gaps had other causes: (a) two Wikidata items share the same IATA and ICAO (civil airport + air base or a closed airport: AUS, AAL, BGO, TSR), so matching skips them rather than guess; a possible rule is to drop items that are dissolved (P576) or military air bases, then match only if one item is left; (b) the only photo is GFDL (e.g. Antalya AYT, Heathrow), which we exclude.

In review (2026-10-19): `feature/redesign` — owner asked for FlightAware-level detail with a much nicer design that starts from the current one. New hero, quick switch bar, analytics from the board (insights.js, charts.js), FIDS rows / phone cards (fixes the sideways table), flight drawer with `?flight=` link, weather drawer (covers the "clickable weather panel" roadmap step). Fonts: Inter + JetBrains Mono from Google Fonts. No extra AeroDataBox units: only the existing aircraft lookup / Check this flight use units; other-airport weather uses the free weather function. The redesign came from a separate cloud session as a patch; applied on `feature/redesign` from main (2026-10-19). Open decision for the owner: fonts load from Google Fonts (keep, self-host, or system fonts).

Deleted (owner, 2026-10-19): `feature/aircraft-type-photos` (Wikimedia photo per aircraft type), replaced by real aircraft photos. The owner saw photos in another airline's livery (Lufthansa A321 for a Wizz Air flight, Southwest 737 for KLM) and found that misleading. Direction: show only the actual aircraft or a photo in the correct airline's livery, otherwise the grey panel. Its build script (`scripts/build-aircraft-photos.mjs`, `scripts/lib/wikimedia.mjs`) can be reused; its app.js changes conflict with the redesign drawer and must be redone there.

Merged (2026-10-19): `feature/real-aircraft-photos` (owner chose option A). Known gap to look at next: some domestic flights (e.g. OTP-IAS, OTP-TSR, mostly TAROM ATRs) are still not identified; ask the owner for the drawer's diagnostic text. Possible causes: short routes, low-flying turboprops outside receiver coverage, aircraft not transmitting at the gate. Owner's note:: Planespotters.net photo of the exact aircraft by registration + adsb.lol live ADS-B to find the registration from the callsign when the board has none (guessed ICAO callsigns need a matching aircraft type; provider callsigns are trusted; exactly one aircraft with exactly that callsign). New function `netlify/functions/aircraft-live.mjs`, Blobs store `aircraft-live`. No AeroDataBox units. Risks: adsb.lol says an API key will be required in future (for feeders); Planespotters may revoke API access if terms are broken (credit + plain link required). AeroDataBox details are ignored if their registration differs from the identified one. Learned on the preview: most airlines fly under alphanumeric callsigns (WMT1LH, ROT276H, KLM62R), not ICAO+flight number, and the board rarely has the callsign, so the first version found almost nothing. Now `/api/identify/<airlineICAO>/<from>/<to>/<lat>/<lon>`: adsb.lol aircraft within 250 nm of where the flight should be (estimated along the great circle from its own times), filtered to the airline's callsign prefix, each callsign's route from adsb.lol `/api/0/route/<cs>/<lat>/<lon>` (undocumented; HTTP 500 = route unknown; batch `routeset` returns nothing), accepted only if exactly one aircraft flies exactly this route and the type doesn't conflict. Measured near OTP: all 5 OTP-bound aircraft had known routes. Flights hours away stay "not known yet". UPDATE (owner chose option 1): adsb.lol's route endpoint proved unreliable (HTTP 500 for every callsign at times), so routes now come from the VRS standing data on GitHub (CC0, `routes/schema-01/<L>/<ICAO>-all.csv`, airline list `airlines/schema-01/airlines.csv` for IATA->ICAO, kept 1 day / 7 days in Blobs, older copy used if GitHub fails). Only one adsb.lol call per identification. Verified live: OTP-VLC -> HA-LXP (WMT1LH), OTP-CPH -> HA-LTJ (WMT8ZY), MAD-OTP -> YR-HAA (ROT416M), BAY-OTP -> YR-ATK (ROT618W).

In review (2026-10-19): `feature/live-status` (section A1). When the drawer identifies the aircraft in adsb.lol, `liveStatus()` (public/js/flights.js) gives "Landed / On the ground at X / Approaching X / In the air (live data)" from its position (15 km from an airport = at it; approaching = within 120 km and descending or below 10,000 ft). It wins over the provider status for 15 min (not over a cancellation), also on the board row, and the drawer's progress line uses the live position. Only works while the aircraft transmits.

In review (2026-10-19): `feature/aircraft-page` (A2, branched from `feature/live-status`). `/aircraft/<REG>` (netlify.toml rewrite to `public/aircraft.html`, script `public/js/aircraft-page.js`): Planespotters photo, AeroDataBox details (1 unit, 7 days), live position from adsb.lol `/v2/reg/<REG>` via `/api/aircraft-now/<REG>` (stored 2 min, daily cap shared), current route = the callsign's VRS route only if the live position is on that line or at one of its airports. Flight history (owner chose option 2): button "Load flight history (uses 2 units)" -> `/api/aircraft-flights/<REG>/<DATE>` (AeroDataBox `/flights/reg/{reg}/{date}`, Tier 2; today + 6 days back; today stored 10 min, past days 7 days). The range endpoint is Tier 3, avoided. Entry points: registration in the flight drawer is a link; airport search offers "Aircraft YR-ASA" for registration-like input. adsb.lol now rejects generic User-Agents ("include valid contact info"); our UA has the repo URL and works.

A1 and A2 merged (PR #15, #16), A2 verified in production.

In review (2026-10-19): `feature/wall-board` (A3, item 6). `/board/<IATA>` (netlify.toml rewrite to `public/board.html`, script `public/js/wall.js`, pure logic in `public/js/wall-model.js`): departures and arrivals side by side, rows that fit the screen, pages rotate every 12 s on screens >= 900 px, one scrolling column below that. Upcoming flights plus finished ones for 20 min (unfinished with a passed time for 60 min). Owner's choice for units: reloads flights once an hour, never 00:00-05:00 airport time, only while the page is visible (closed/hidden tab = no calls). Weather every 15 min (free function). Full screen button; "Keep screen on" (Wake Lock) only when pressed. Home airport: "Home" button in the hero (localStorage `airportLive.home`); `/` opens home, else the last airport; marked ⌂ in the quick bar. "Wall board" link next to the flight board heading.

Next: airline logos: owner chose Wikimedia Commons logos prepared ahead by a script (free licences only, many PD-textlogo), stored in the repo, coloured badge as fallback.

Owner's budget (2026-10-19): up to ~$10/month for data later (AeroDataBox Pro $8: 5,000 units). Target: works well for the top 50–100 airports; whole globe as far as data allows. Work from one Claude session at a time to avoid parallel edits.

Tools available for testing: Node 24, Chrome (headless) and netlify-cli 27 (installed globally, not a project dependency, to keep Netlify builds fast) on this machine. No Python (not needed). `npm run serve` also serves `/api/weather`. Headless Chrome `--window-size` cannot go below ~500 px wide: for phone screenshots use DevTools device emulation (Emulation.setDeviceMetricsOverride). Server code must not import files from `public/js/`: on this machine esbuild (used by `netlify dev`) gets "Access is denied" reading them, although Node reads them. Run `netlify dev` from the PowerShell tool, not Bash. Quirk: under `netlify dev`, a function 404 is retried as `<path>.html`, so unknown codes show 400 locally; production and `npm run serve` return 404. The Bash tool cannot read some repo files (permission denied); use the Read tool for those.
