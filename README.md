# Airport Live — Prototype

Airport dashboard for desktop and phone browsers. Plain HTML, CSS and JavaScript, no build step, deployed on Netlify.

## What works now
- About 9,000 airports worldwide (every airport with an IATA code), searchable by code, name, city, region or country, with or without accents (e.g. `OTP`, `LROP`, `coanda`, `Tokyo`).
- A web address per airport: `/airport/OTP`. ICAO codes work too (`/airport/LROP` redirects to `/airport/OTP`). Browser Back/Forward work. Unknown codes show "Airport not found".
- Real airport details from OurAirports: name, city, region, country, ICAO code, number of open runways. Local clock in the airport's time zone when the time zone is known; otherwise "Not available".
- Saved airports (★), stored in this browser only. The app reopens the last airport you viewed.
- Keyboard: arrows + Enter in the airport search, Escape closes windows.
- Airport and city photos from Wikimedia Commons for about half of all airports (most large airports), each with author, licence and a link to the original. Airports without a freely licensed photo show a styled panel. A photo that fails to load also falls back to that panel.

## Still demo data (clearly labelled in the app)
- Weather: sample values for SEA, LHR, OTP and JFK only. Other airports show "not connected yet".
- Flights: sample board for SEA only. Other airports show "No flight data yet".
- Aircraft photo in the flight detail: one illustrative Unsplash photo, labelled "not this aircraft".

## Run locally
```
npm run serve     # http://localhost:8080 (no install needed, Node 20+)
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
- `public/js/demo-data.js` — all demo values in one place
- `public/js/app.js` — page logic
- `scripts/` — airport and photo data builders, local server
- `tests/` — tests (`node --test`)
- `netlify.toml` — publish folder and the `/airport/*` address rule

## Data sources
| Source | Used for | Licence |
|---|---|---|
| [OurAirports](https://ourairports.com/data/) | Airports, codes, names, locations, runways, countries, regions | Public domain |
| [mwgg/Airports](https://github.com/mwgg/Airports) | Airport time zones | MIT, Copyright (c) 2014 mwgg |
| [Wikidata](https://www.wikidata.org) | Which photo and which city belong to each airport | CC0 |
| [Wikimedia Commons](https://commons.wikimedia.org) | Airport and city photos | Per photo, shown in the app: public domain, CC0, CC BY or CC BY-SA |
| [Unsplash](https://unsplash.com) | One illustrative aircraft photo (demo flight detail) | Unsplash licence |

Time zones are matched by ICAO/IATA code. When the two disagree or no match exists (mostly small airfields), the time zone is left empty rather than guessed.

## Deploy
Netlify reads `netlify.toml`: publish directory `public`, no build command. In the Netlify UI the **Base directory** must be empty (the repository root).
