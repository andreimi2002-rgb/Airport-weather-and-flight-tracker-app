# Airport Live — Prototype

Airport dashboard for desktop and phone browsers. Plain HTML, CSS and JavaScript, no build step, deployed on Netlify.

## What works now
- About 9,000 airports worldwide (every airport with an IATA code), searchable by code, name, city, region or country, with or without accents (e.g. `OTP`, `LROP`, `coanda`, `Tokyo`).
- A web address per airport: `/airport/OTP`. ICAO codes work too (`/airport/LROP` redirects to `/airport/OTP`). Browser Back/Forward work. Unknown codes show "Airport not found".
- Real airport details from OurAirports: name, city, region, country, ICAO code, number of open runways. Local clock in the airport's time zone when the time zone is known; otherwise "Not available".
- Saved airports (★), stored in this browser only. The app reopens the last airport you viewed.
- Keyboard: arrows + Enter in the airport search, Escape closes windows.
- Airport and city photos from Wikimedia Commons for about half of all airports (most large airports), each with author, licence and a link to the original. Airports without a freely licensed photo show a styled panel. A photo that fails to load also falls back to that panel.
- Live weather for every airport: the latest METAR (decoded into wind, visibility, ceiling, conditions and a plain-English reading) and TAF from aviationweather.gov, and a forecast for the next hours from MET Norway. Airports without a reporting METAR station say so and show only the forecast, labelled as a forecast. The weather refreshes every 10 minutes while the page is open; if a refresh fails, the last data stays visible with a warning and its time. METARs older than 90 minutes are flagged.

- Flight board from AeroDataBox (once the key is set): departures and arrivals from 2 hours ago to 10 hours ahead, with scheduled and estimated/actual times, status, terminal, gate or baggage belt, aircraft model and registration. Airports without live coverage are labelled "schedule only". Flight details show only what the provider supplies; everything else says "Not available". When the registration is known, opening a flight looks up that aircraft (exact model, manufacturer, age, seats, engines, delivery date, operator, and a photo of that aircraft labelled "matched automatically"). A "Check this flight" button asks for the current status of that one flight. Flights whose time passed without any provider update say "No recent update". "Last updated" shows when the board was fetched; old data is labelled.

- **Redesign (branch `feature/redesign`)**: photographic hero (airport photo as backdrop, giant code, live clock with seconds and UTC), sticky top bar with saved airports as one-click shortcuts (with their local time) and a search palette (`/` or Ctrl/⌘+K).
- **Airport analytics, computed only from the flights on the board (no extra provider calls):** departures/arrivals with on-time/delayed/cancelled meters, on-time %, average and longest delay, traffic by hour (departures above, arrivals below, delayed part in amber, "now" marker, hover details), top destinations/origins, airlines and aircraft types.
- **Flight board:** FIDS-style rows with a status stripe, struck-through scheduled time when it changed, delay chips (+23m), "NOW" divider, "Hide finished", search also by registration and gate. On phones the board is a card list (no more sideways scrolling).
- **Flight drawer (FlightAware-style), with its own link (`/airport/SEA?flight=AS1221-d`):** route with both airports, scheduled duration and distance, progress estimated from the provider's departure/arrival times (labelled as such, not a live position), departure and arrival time tables (scheduled, estimated/actual, runway, terminal, gate, check-in desk/baggage belt), aircraft card and photo, timeline, and the current weather at the other airport. "Not available" where the provider gives nothing.
- **Weather drawer** (click the weather card): decoded METAR field by field, 24-hour temperature/precipitation chart, hourly wind and rain, TAF split into its change groups (FM/TEMPO/BECMG/PROB) with readable times.

## Still demo data (clearly labelled in the app)
- Flights, only while no AeroDataBox key is set: sample board for SEA. Other airports say flight data is not connected yet.
- Aircraft photo in the flight detail: one illustrative Unsplash photo, labelled "not this aircraft".

## Run locally
```
npm run serve     # http://localhost:8080 (no install needed, Node 20+), includes /api/weather
netlify dev       # same site through the Netlify runtime (needs: npm install -g netlify-cli)
npm test          # automated tests
```
Opening `index.html` directly from disk does not work any more: the app loads its airport list and needs a web server.

## Refresh the airport list
```
npm run build:airports
```
Downloads OurAirports and mwgg/Airports, writes `public/data/airports.json`, and refuses to write if the result looks broken. Commit the new file afterwards.

## Refresh the photos
```
npm run build:photos
```
Takes 10–20 minutes. Asks Wikidata which photo and city belong to each airport, reads author and licence from Wikimedia Commons, keeps only public domain / CC0 / CC BY / CC BY-SA photos (no maps or logos, at least 800 px wide), checks that every photo link loads, and writes `public/data/photos/*.json`. Airports with ambiguous Wikidata matches are skipped instead of guessed.

## Project layout
- `public/` — the site Netlify publishes (`index.html`, `styles.css`, `js/`, `data/airports.json`, `data/photos/`)
- `public/js/airports.js` — airport search, lookup and URL handling
- `public/js/photos.js` — loads photos and builds the credit line
- `public/js/weather.js` — loads weather from `/api/weather/<IATA>` and formats it
- `public/js/flights.js` — loads flights from `/api/flights/<IATA>` and formats them
- `public/js/flight-model.js` — the normalized Flight/Aircraft model and status rules (shared with the tests)
- `public/js/demo-data.js` — demo flights (SEA), used only while no flight key is set
- `public/js/app.js` — page logic
- `public/js/insights.js` — board statistics, hourly traffic, top lists, flight progress and timeline (pure functions, tested)
- `public/js/charts.js` — the two hand-made SVG charts (traffic, forecast)
- `netlify/functions/weather.mjs` — the `/api/weather/<IATA>` function: input check, airport lookup, cache headers, rate limit
- `netlify/lib/weather.mjs` — calls the weather providers and decodes their answers
- `netlify/functions/flights.mjs` — the `/api/flights/<IATA>` function
- `netlify/functions/flight-details.mjs` — `/api/aircraft/<REG>` and `/api/flight-status/<NUMBER>/<DATE>/<IATA>`
- `netlify/lib/flights/details.mjs` — aircraft lookup (stored 7 days) and flight status (stored 5 min)
- `netlify/lib/flights/budget.mjs` — the shared monthly unit budget
- `netlify/lib/flights/aerodatabox.mjs` — AeroDataBox adapter (provider answer → Flight model)
- `netlify/lib/flights/board.mjs` — stored boards, monthly budget, stale and quota states
- `netlify/lib/airports.mjs` — airport lookup shared by the functions
- `docs/flight-providers.md` — provider comparison and why AeroDataBox
- `scripts/` — airport and photo data builders, local server
- `tests/` — tests (`node --test`)
- `netlify.toml` — publish folder, functions folder and the `/airport/*` address rule

## Data sources
| Source | Used for | Licence |
|---|---|---|
| [OurAirports](https://ourairports.com/data/) | Airports, codes, names, locations, runways, countries, regions | Public domain |
| [mwgg/Airports](https://github.com/mwgg/Airports) | Airport time zones | MIT, Copyright (c) 2014 mwgg |
| [Wikidata](https://www.wikidata.org) | Which photo and which city belong to each airport | CC0 |
| [Wikimedia Commons](https://commons.wikimedia.org) | Airport and city photos | Per photo, shown in the app: public domain, CC0, CC BY or CC BY-SA |
| [NOAA Aviation Weather Center](https://aviationweather.gov/data/api/) | METAR and TAF | US government data, public domain |
| [MET Norway](https://api.met.no/) | Forecast (Locationforecast 2.0) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), credited in the app |
| [AeroDataBox](https://aerodatabox.com/) via RapidAPI | Flights, aircraft model/registration, representative aircraft photos | Basic plan: non-commercial, attribution required (shown on the board) |
| [Unsplash](https://unsplash.com) | One illustrative aircraft photo (demo flight detail) | Unsplash licence |

### Weather function
`GET /api/weather/OTP` looks the airport up in `airports.json` (the browser never sends coordinates), then asks the three sources in parallel with an 8-second timeout. No API keys are needed. Requests identify the app with a User-Agent, as MET Norway's terms require.
- Caching: Netlify's CDN keeps a complete answer for 5 minutes (`durable`, then up to 10 more minutes stale while refreshing). An answer with a failed part is kept 1 minute. Warm function instances also remember provider answers (METAR 5 min, TAF 15 min, forecast until MET Norway's `Expires`).
- Rate limit: 60 requests per minute per visitor IP (`config.rateLimit`).
- Each part reports `ok`, `none` (e.g. no station) or `error`; a field the provider does not report stays empty and shows "Not reported".

### Flights function
`GET /api/flights/OTP` calls AeroDataBox (one call = departures + arrivals, 2 units). The key is read from the Netlify environment variable `AERODATABOX_RAPIDAPI_KEY` (scope: Functions) and never reaches the browser or git. Without it the function answers "unconfigured" and the page shows demo flights for SEA only.

The Basic plan has 400 units (about 200 boards) a month, so:
- each airport's board is stored in Netlify Blobs and reused for 25 minutes (and cached on the CDN);
- a monthly budget in provider units (board 2, aircraft 1, flight status 2; default 360 of the plan's 400, change with `FLIGHTS_MONTHLY_UNIT_CAP`) stops calls before the provider's limit; a "monthly quota" 429 from RapidAPI also stops them until next month. A per-second "Too many requests" 429 is treated as temporary;
- when no new call is possible, the last stored board is shown, marked as old.

Time zones are matched by ICAO/IATA code. When the two disagree or no match exists (mostly small airfields), the time zone is left empty rather than guessed.

## Deploy
Netlify reads `netlify.toml`: publish directory `public`, no build command, functions from `netlify/functions` (bundled by esbuild). In the Netlify UI the **Base directory** must be empty (the repository root).
