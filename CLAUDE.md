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
