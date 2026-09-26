# RouteWise backend

TypeScript + Fastify API for the RouteWise student trip planner. Runs independently of React, Next.js, or another frontend.

## Start

Use `./Start-RouteWise.cmd` from the repository root to start both frontend and backend. Open http://localhost:3000/backend-check for the complete flow. See [FLOW_GUIDE.md](../FLOW_GUIDE.md) for instructions and the current frontend contract. No system-wide runtime installation is needed on this computer.

Running `.\Start-RouteWise.cmd` from this backend folder starts only the API. It compiles the source and reuses an already-running compatible RouteWise service without changing PowerShell execution policy. After editing backend code or keys, stop the existing server with Ctrl+C before restarting so the new changes load.

On another computer, install Node.js 24 and pnpm 11, then:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Windows uses `Copy-Item .env.example .env` instead of `cp` if needed.

- API documentation and interactive requests: http://localhost:3001/docs/
- Health: http://localhost:3001/health
- Default mode: `demo`; fixtures are fictional and make no paid requests.
- Production build: `pnpm build && pnpm start`.
- Stop with Ctrl+C.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Mode and key-presence status; does not verify keys |
| POST | `/api/suggest-stops` | Flat frontend request: base plan, categories, verified optional stops |
| POST | `/api/plan-trip` | Skip or add a stop and recalculate Best/Fastest/Cheapest cards |
| GET | `/api/v1/config` | Campus presets and form defaults |
| POST | `/api/v1/trips/plan` | Routes, Best/Cheapest/Fastest IDs, constraints, optional nearby places |
| POST | `/api/v1/places/search` | Destination lookup with a Miami location bias |
| POST | `/api/v1/places/nearby` | Food, coffee, parking, gas, EV charging, or pharmacy |

Legacy `/api/v1/trips/plan` request (the new frontend flow uses string addresses; see FLOW_GUIDE):

```json
{
  "origin": { "address": "FIU Modesto A. Maidique Campus, Miami, FL" },
  "destination": { "address": "Wynwood Walls, Miami, FL" },
  "hasCar": true,
  "hasBike": false,
  "budgetUsd": 15,
  "maxWalkingMinutes": 10,
  "avoidTolls": true,
  "preference": "balanced",
  "nearbyCategories": ["food", "parking"]
}
```

Locations accept exactly one of `{ "address": "..." }`, `{ "placeId": "..." }`, or `{ "latitude": 25.8, "longitude": -80.2 }`. An optional `arrivalTime` is an ISO timestamp with a timezone, in the future and within seven days. Do not send a timezone-free `datetime-local` value.

`best`, `cheapest`, and `fastest` are IDs into `routes`, or `null`. They may identify the same route. Confirmed routes take priority over provisional routes for every card. If no confirmed route exists, a provisional route may be selected with explicit unknown constraints. Cheapest is never selected using an unknown or non-USD cost. All returned routes remain available for explanation, including those that exceed a constraint.

Full request/response types are in `shared/contracts.ts`; generated OpenAPI is in `openapi.json`. Regenerate with `pnpm export:openapi` after editing schemas.

## Connect live services

1. Create a server API key in [Google AI Studio](https://aistudio.google.com/apikey) for Gemini.
2. Create/select a [Google Cloud project](https://console.cloud.google.com/), configure billing, and enable **Routes API** and **Places API (New)**. Create a server key restricted to those APIs. Use server IP restrictions when a stable deployment IP is available.
3. Put the keys in the local, git-ignored `backend/.env`:

```dotenv
DATA_MODE=live
GOOGLE_MAPS_API_KEY=your_server_maps_key
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.8-flash
```

4. Restart the server. Use `/health` to check configuration, then make a real trip request in `/docs/`. Key presence does not prove API access or billing is enabled.
5. If your account has different model availability, set `GEMINI_MODEL` to a compatible model available to you. Gemini failure leaves deterministic routing available.
6. Optionally set `ENABLE_MAPS_GROUNDING=true`. Requests with nearby categories then make an additional Gemini Maps-grounding call and return cited guidance. Keep it off until the frontend can display grounding citations correctly.

The backend uses Google Routes for measurable route facts and Places for structured place cards. Gemini chooses categories and ranks only validated route/stop IDs; it cannot rewrite fares, route geometry, or timing. Maps-grounded guidance is a separate legacy option. Transient Gemini failures try `GEMINI_FALLBACK_MODEL` (default `gemini-2.5-flash`) before falling back to deterministic ranking. Live Google route, Places, and Gemini calls were verified locally on September 26, 2026; another developer needs their own keys.

Never put these server keys in a `VITE_` or `NEXT_PUBLIC_` variable. Your teammate's browser map uses a **separate** browser key restricted to the frontend's domains and Maps JavaScript API.

## Frontend connection

See [`docs/FRONTEND.md`](docs/FRONTEND.md). Local browser calls from port 5173 or 3000 are allowed. Set `FRONTEND_ORIGINS` to a comma-separated list of exact origins for different hosts. To connect across computers, bind `HOST=0.0.0.0`, use this computer's LAN address, and allow that origin. The default is loopback-only.

For a public live deployment, set `NODE_ENV=production`, `HOST=0.0.0.0`, and a random `API_ACCESS_TOKEN` of at least 32 characters. The frontend must call this API through its server proxy, which adds `Authorization: Bearer ...`. Do not ship that token to the browser. CORS is not authentication. This MVP uses per-process IP rate limits; multi-instance hosting needs a shared limiter and real user/session authentication at the proxy. Configure provider quotas and billing limits in your own account.

## What the results mean

- Demo routes and place names are fixtures for frontend development, independent of the requested locations. Do not display them as real directions. No fake route polyline is drawn.
- Live fares may be missing. Driving fuel, toll, and parking totals are currently unknown. Unknown does not mean free.
- Car travel time ends at the destination and excludes parking search and the walk from parking. Parking places have no availability or price guarantee.
- The new flow schedules forward from departure and checks the arrival deadline against the full itinerary. Driving arrival is an estimate, not a guarantee. Legacy transit requests can still use arrive-by routing without a departure.
- Transit departure and arrival times include access/egress walking when provider steps supply enough timing data. Already departed routes are rejected.
- Avoiding tolls is a routing preference. The provider may still return a toll route.
- Legacy `nearby` results are destination suggestions without detours. New flow stops are rebuilt as timed legs including visits and additional walking. `DESTINATION` means arrive first, walk to the nearby stop, then walk back; `ON_ROUTE` inserts a stop between origin and destination.
- Open-now filtering includes only places explicitly reported open, not places with unknown hours.
- Google Maps and transit-agency attribution must remain visible. Preserve returned Places attributions and Gemini grounding metadata. Consult the official display policies before public release.
- No location history, accounts, or trips are persisted. Requests and provider bodies are not logged. Each request fetches fresh live data; there is no cross-user location cache.

## Scope

Implemented: the four-part MVP from the concept, nearby places, parking lookup, and the API connections your teammate needs.

Future features: park-and-ride route composition, live rideshare quotes/bookings, transit-pass fare eligibility, saved trips, accessibility verification, emissions, and an “I'm stranded” workflow. This version does not call any place “safe,” fabricate rideshare prices, or claim sponsor eligibility. These features need additional data and product decisions.

## Validation and deployment

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm export:openapi
```

Tests cover request validation, route constraints, missing fares, timestamps, outages, Gemini output validation, Maps request contracts, CORS, access tokens, and rate limiting. A GitHub Actions template is included at `docs/backend-ci.yml`. To activate it, a repository maintainer with workflow permissions can copy it to `.github/workflows/backend.yml` at the repository root. It repeats typecheck, tests, and build on pushes and pull requests. The connected GitHub credential could not upload an active workflow, so CI is not enabled yet.

An optional Dockerfile builds a standalone API image. It has not been run on this computer. From this folder: `docker build -t routewise-backend .`, then `docker run --rm -p 3001:3001 --env-file .env -e HOST=0.0.0.0 routewise-backend`. Production live mode requires the access token described above. Nothing has been deployed to a cloud service.

## Official implementation references

- [Google Routes requests](https://developers.google.com/maps/documentation/routes/compute_route_directions)
- [Transit routing and supported timestamps](https://developers.google.com/maps/documentation/routes/transit-route)
- [Places Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Gemini GenerateContent structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Gemini GenerateContent Maps grounding](https://ai.google.dev/gemini-api/docs/generate-content/maps-grounding)
