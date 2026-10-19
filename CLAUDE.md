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

**Next, as soon as the owner has checked the flights preview: ASK the owner whether to start the photo fix** (branch `feature/photos-fix`): the photo builder reads Wikidata with `wdt:P18`, which returns only the preferred image; when that one fails the rules (e.g. Schiphol 600 px, Amsterdam licence "Attribution"), valid other photos are never seen. Fix: read all non-deprecated P18 images (preferred first), accept the Commons "Attribution" licence, rebuild, report before/after counts. 205 of 1,173 large airports had no airport photo, 256 no city photo.

Tools available for testing: Node 24, Chrome (headless) and netlify-cli 27 (installed globally, not a project dependency, to keep Netlify builds fast) on this machine. No Python (not needed). `npm run serve` also serves `/api/weather`. Headless Chrome `--window-size` cannot go below ~500 px wide: for phone screenshots use DevTools device emulation (Emulation.setDeviceMetricsOverride). Server code must not import files from `public/js/`: on this machine esbuild (used by `netlify dev`) gets "Access is denied" reading them, although Node reads them. Run `netlify dev` from the PowerShell tool, not Bash. Quirk: under `netlify dev`, a function 404 is retried as `<path>.html`, so unknown codes show 400 locally; production and `npm run serve` return 404. The Bash tool cannot read some repo files (permission denied); use the Read tool for those.
