# Airport Live

Real airport information app. Today it is a single-file visual prototype (`index.html`, ~34 KB, no build step, deployed on Netlify from GitHub).

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
