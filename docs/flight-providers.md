# Flight data providers: comparison and recommendation

Checked on 2026-10-19 against each provider's own pricing pages and API docs. Prices and free tiers change; recheck before signing up. Items marked *unverified* could not be confirmed on an official page.

## What Airport Live needs
- A departures and arrivals board for any airport: flight number, airline, other airport, scheduled / estimated / actual times, status, terminal, gate.
- For the flight detail view (item 5): aircraft type, manufacturer, registration, aircraft photo with credit, distance, duration.
- A free tier we can use without paying (project rule), called only from a Netlify Function with the key kept server-side.
- Permission to show the data on a public web page.

## Comparison

| Provider | Free tier | One airport board costs | Live times, status, gates | Aircraft details | Use allowed on free tier | Paid entry |
|---|---|---|---|---|---|---|
| **AeroDataBox** (via RapidAPI) | **400 units / month**, free forever | **2 units** (one call returns departures **and** arrivals for 12 h) → about **200 boards / month** | Yes where live-covered: scheduled, revised, predicted, runway times, status, terminal, gate, check-in desk, baggage belt | Registration, model, Mode-S, photo with author and licence (commercial-use licences only), great-circle distance | Non-commercial only, **attribution required** | $8 / month: 5,000 units (about 2,500 boards), commercial use allowed, no attribution needed |
| **FlightAware AeroAPI** (Personal) | Up to **$5 / month** of usage credit | $0.005 per 15 flights; a board with departures and arrivals is about 2–4 pages → about **250–500 boards / month** | Yes, strong in the US, good worldwide | Registration, ICAO type code (e.g. B738), route distance; **no photos** | "Personal or academic purposes only"; business use not included | Standard: $100 / month minimum |
| **aviationstack** | 100 requests / month | 1 request | Real-time flights only; **schedules not on free plan** | Registration often empty *(unverified)* | **Non-commercial** | $49.99 / month (10,000 requests) |
| **AirLabs** | Free key, monthly quota *unverified* | 1 request, **max 50 flights** on free keys | **No.** Free plan returns only airline, flight number, airports and scheduled times. No estimated or actual times, status, gates or terminals | No | *Unverified* | Paid prices not shown on the site without JavaScript *(unverified)* |
| **Flightradar24 API** | **None** | — | Live positions and flight summaries; airport board endpoint *unverified* | Registration, type | — | Explorer $9 / month (30,000 credits) |
| **OpenSky Network** | Free | — | **No schedules, gates or airlines.** ADS-B positions only; airport arrivals/departures only for past flights | Transponder data | Commercial use needs separate permission | Contact them |

### Live coverage (AeroDataBox's published table, updated 2026-06-03)
Live updates (estimated/actual times, status, gates) exist only where AeroDataBox has a live feed. Elsewhere flights stay "scheduled only" with status Unknown, and the app must say so.
- Strong: Netherlands 100%, Switzerland 100%, Germany 93%, Austria 96%, United States 86%, Canada 80%, **Romania 71%**, Japan 70%.
- Weak: Poland 39%, Brazil 35%, China 35%, Mexico 20%, much of Africa and the Caribbean 0% (schedules only).
- A free endpoint reports each airport's coverage, so the app can show "live" or "schedule only" per airport.

## Recommendation: AeroDataBox, free Basic plan on RapidAPI

**Why:**
1. It is the only option with a genuinely free tier that covers both items 4 and 5. One call gives the whole board, and each flight already includes registration, aircraft model and distance. A separate endpoint gives an aircraft photo with author and licence, which matches how we credit Wikimedia photos.
2. No credit card is involved *(unverified: check that the plan shows a hard limit with no overage when you subscribe)*. FlightAware's Personal tier keeps a card on file and charges above $5 *(unverified)*, which risks the project's no-charges rule.
3. If the app ever goes public, moving to the $8/month plan needs **no code changes**, only a different subscription. That decision is yours and not needed now.

**Honest limits of the free plan:**
- **About 200 board refreshes a month in total**, across all airports and visitors. That is enough to build and test the app and for your own occasional use. It is **not** enough for a board left open on a monitor: refreshing every 30 minutes would use the month's quota in about 4 days.
- **Non-commercial use only, with attribution.** Fine for the prototype; a public launch needs a paid plan or another provider (already on the "later: licensing review" list).
- Live times and gates exist only at live-covered airports, and the app will label the rest as schedule only.

**How the app will stay inside the quota:**
- Only the Netlify Function calls AeroDataBox. The key stays in a Netlify environment variable, never in the browser or git.
- Each airport's board is cached for 30 minutes on the CDN.
- A **hard monthly budget** (e.g. 180 of the 200 calls), counted in Netlify Blobs, which is free and built into Netlify. When it runs out, the board says "Free monthly flight data quota used up. Resets on <date>" instead of failing or calling again.
- Clearly labelled demo flights remain for when no key is set.

**Runner-up:** FlightAware AeroAPI Personal gives more boards for the money ($5 credit ≈ 250–500 boards) and strong US data. However, it has no aircraft photos, gives aircraft types only as codes, needs a card on file, and is restricted to personal or academic use.

### Aircraft photos in AeroDataBox (checked in the API spec)
- **On the board:** each flight's aircraft can include a photo at no extra cost. It is "either actual (if registration is provided) or approximate based on airline name and model", so it may show a sister aircraft. The app must label it "representative photo".
- **By registration:** `GET /aircrafts/reg/{reg}/image/beta` (Tier 2, 2 units), or `GET /aircrafts/reg/{reg}?withImage=true` (Tier 1, 1 unit). The second also returns age, seats, delivery date, engine type and model.
- **Licences:** only commercial-use licences are returned (CC BY, CC BY-SA, CC0, public domain, US government work). Each photo has author, title, source page and HTML attribution lines.
- **Caveat:** photos are matched automatically, so "false matches may be returned". The app should show "matched automatically" and fall back to the styled panel when there is no photo.
- **Quota:** look up aircraft only when a flight's details are opened; cache up to 7 days (the Basic plan's caching limit).

**Not suitable:** aviationstack (100 requests and no schedules on the free plan), AirLabs (free plan has no live times, gates or status), OpenSky (no schedules or airline data), Flightradar24 (no free tier).

## What you would do (if you choose AeroDataBox)
1. Create a free RapidAPI account at rapidapi.com and open the **AeroDataBox** API.
2. Subscribe to the **Basic** plan ($0, 400 units/month). Before confirming, check that it says hard limit and asks for no card.
3. Copy your **X-RapidAPI-Key**.
4. In Netlify: **live-airport → Site configuration → Environment variables → Add a variable**: name `AERODATABOX_RAPIDAPI_KEY`, scope **Functions**, value = the key. Do not paste the key into chat or code.
5. Tell me when it is done. I build the adapter and states without the key first, with tests on recorded sample responses, and switch to real data once the key is in place.

## Sources
- AeroDataBox pricing, units, licence terms: https://aerodatabox.com/pricing/
- AeroDataBox API spec (endpoint tiers, fields): https://doc.aerodatabox.com/ (openapi-rapidapi-v1.json)
- AeroDataBox data coverage: https://www.aerodatabox.com/data-coverage
- FlightAware AeroAPI tiers and prices: https://www.flightaware.com/commercial/aeroapi/
- aviationstack pricing: https://aviationstack.com/pricing
- AirLabs schedules API (free-plan fields, 50-result limit): https://airlabs.co/docs/schedules
- Flightradar24 API Explorer tier: https://www.flightradar24.com/blog/b2b/flightradar24-api/
- OpenSky Network API documentation (commercial use: contact them)
