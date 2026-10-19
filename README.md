# Airport Live — Prototype v0.2

Responsive airport dashboard prototype featuring:
- Airport and city photo panels
- Airport switcher (SEA, LHR, OTP, JFK)
- Airport local clock and sample weather
- Searchable/filterable arrivals and departures
- Clickable flight detail modal with aircraft photo and aircraft/route information
- Responsive desktop and mobile layout

## Run locally
Open `index.html` in a modern browser. No build step or dependencies required.

## Deploy to Netlify
Create a GitHub repository, upload `index.html` and this README, import the repository in Netlify, leave build command empty, and set publish directory to `.`.

## Important data and image notes
This is a prototype. Flight statuses, schedules, aircraft assignments and weather are illustrative demo values, not live data. The clock uses each airport's actual time zone. Photos are external Unsplash image URLs used for design preview; confirm usage rights and replace with verified airport/city/aircraft-specific licensed images for a public release. The aircraft photo is illustrative and is not guaranteed to depict the exact model in each sample flight.

A live release needs an aviation API whose license permits display and redistribution, plus server-side API credentials, caching, rate limiting, error handling, and source/last-updated labels. Aircraft registration, age, configuration, and other details should only be shown when the data provider supplies them.
