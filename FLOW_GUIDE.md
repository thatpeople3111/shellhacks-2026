# RouteWise: run and connect the complete flow

## 1. Open and start

Open this `shellhacks-2026` folder in VS Code. In its terminal run:

```powershell
.\Start-RouteWise.cmd
```

Keep that terminal open. Visit **http://localhost:3000/backend-check**. Backend documentation is at **http://localhost:3001/docs/**. The root launcher starts both services. The copy in `backend/` starts just the API. Neither needs a PowerShell execution-policy change.

If RouteWise is already running, the launcher reuses it. After changing backend code or `backend/.env`, press Ctrl+C in the terminal that owns it, then restart. If a different app occupies a port, the launcher tells you which port to resolve; it does not kill unrelated processes.

Your existing provider keys stay in the ignored `backend/.env`. `DATA_MODE=live` uses them. `DATA_MODE=demo` uses clearly labeled fictional routes and stops without calling providers. Restart after switching modes. Do not copy server secrets into browser variables.

On a teammate's fresh checkout, use Node 24 and run `npm ci` in the root, `npx --yes pnpm@11.25.0 --dir backend install --frozen-lockfile`, then `npm run dev:all`. The launcher creates `backend/.env` from the demo template if absent.

## 2. Exact screen sequence

1. Collect origin, destination, optional departure/arrival, transport budget, walking limit, car availability, and allowed modes.
2. Show **Planning your route** and call `POST /api/suggest-stops` with the basic trip.
3. Display its suggested category buttons and the optional-stop screen.
4. Collect category, **ON_ROUTE** or **DESTINATION**, maximum extra minutes and optional extra spending budget.
5. **Skip:** call `POST /api/plan-trip` with `stopPreferences: { skip: true }` and no selected stop.
6. **Find stop:** call `/api/suggest-stops` again with `stopPreferences`. Display its verified stops.
7. **Add stop:** call `/api/plan-trip` with the same preferences and `selectedStop: { id: stop.id }`. Show **Recalculating your trip** while waiting.
8. Render the returned **BEST**, **FASTEST**, and **CHEAPEST** route cards that are available.

`src/app/backend-check/page.tsx` implements this sequence as a working connection test. The frontend teammate can use the same helpers in their designed screens. The home page has not been replaced.

## 3. Connect the frontend

```ts
import { suggestStops, planTrip } from '@/lib/routewise';
import type { TripRequest, StopPreferences } from '@/lib/types';

const trip: TripRequest = {
  origin: 'FIU Modesto A. Maidique Campus, Miami',
  destination: 'Wynwood Walls, Miami',
  hasCar: true, allowTransit: true, allowWalking: true,
  budget: 30, maxWalkingMinutes: 20,
  timeZone: 'America/New_York',
};
const initial = await suggestStops(trip);
const stopPreferences: StopPreferences = {
  category: 'coffee', timing: 'ON_ROUTE',
  maxExtraMinutes: 30, maxExtraBudget: 10,
  visitMinutes: 5, skip: false,
};
const suggestions = await suggestStops({ ...trip, stopPreferences });
if (suggestions.stops.length) {
  const plan = await planTrip({ ...trip, stopPreferences,
    selectedStop: { id: suggestions.stops[0].id } });
  // Render plan.routes; the recommended card's ID is plan.recommendedRouteId.
}
const skipped = await planTrip({ ...trip, stopPreferences: { skip: true } });
```

Both endpoints exist in Next.js at port 3000 and in Fastify at 3001. Browser code should call the same-origin Next.js endpoints using the supplied helpers. The Next server adds the optional private backend access token. Production uses server environment variables `ROUTEWISE_API_URL` and `API_ACCESS_TOKEN`; local development can read the token from `backend/.env`.

Full runtime-validated shapes are in `backend/shared/flow-contracts.ts`, re-exported for frontend imports in `src/lib/types.ts`. The old `/api/v1` API and its client remain available, but use a different object-address contract.

## 4. Important result handling

- `status` is `ok`, `no_matching_routes`, or `no_matching_stops`; initial suggestions use `choose_category`. Empty stops/routes are a valid outcome. Offer changed limits or Skip; never silently remove the requested stop.
- `estimatedCost: null` and `walkingMinutes: null` mean unknown. Never render unknown cost as free. Stop `estimatedCost` may be absent.
- Best/Fastest can refer to the same underlying route; card IDs are unique. Cheapest is omitted if a complete eligible USD total is unavailable. Render an unavailable-state card if the design requires all three slots. Do not manufacture a fare.
- Show provisional constraints and warnings. Driving fuel, parking, and toll totals are not supplied by this integration. Transport budget is separate from stop spending; a published place price range is approximate and cannot guarantee the bill.
- Keep `dataMode` visible. Demo fixtures do not represent real locations, hours, or directions.
- Render `transitAgencies`, stop `attributions`, and the top-level Google Maps attribution. Display `navigationLinks` for each leg. `mapsUrl` alone is the original direct route; use leg links when a stop is present. Map geometry is nullable.
- Send timestamps as ISO with `Z` or an explicit offset. For a browser-local datetime input, use `new Date(value).toISOString()`. Label the local timezone. Departure must be within seven days; arrival must follow departure and be within seven days.
- `ON_ROUTE` rebuilds origin → stop → destination. `DESTINATION` rebuilds origin → destination → stop → destination, with the last two legs walking; walking must be enabled. The arrival deadline applies to the completed itinerary, including the visit and return.
- Default visit time is 5 minutes. Every suggested stop must be open for its scheduled visit, fit extra-time/walking limits, and have a suitable published price range when a spending cap is set. Unknown future hours are excluded. Queues, parking search, and service delays remain unverified.
- Selected place details, prices, and coordinates are fetched again server-side. Passing altered browser values cannot bypass checks. Transit stop routes use sequential requests because transit intermediate waypoints are unsupported; transfer fare totals remain provisional.
- Search examines up to four candidates across route sample points, with bounded concurrency and time. It is a useful shortlist, not an exhaustive inventory. Provider failures fall back to deterministic AI ranking when possible, or return actionable errors without fake live data.

## 5. Checks and remaining manual work

```sh
npm test
npm run lint
npm run build
cd backend
pnpm check
pnpm export:openapi
```

Automated tests cover the frontend proxy, full demo flow, input validation, selected-stop tampering, opening hours, stop budgets, sequential route timing, outages, provider parsing, access tokens and rate limits. Live smoke checks verify Google Routes, Places, Gemini ranking, and the Next proxy; provider availability can still change.

The teammate's remaining UI work is to connect their actual form and screens to the helpers above. At handoff, this machine is running demo mode: its Gemini key is present but `GOOGLE_MAPS_API_KEY` is empty. For live mode, enter a Maps key locally in `backend/.env`, set `DATA_MODE=live`, and restart. Never paste keys in chat or commit them. A fresh checkout needs both keys for the full live experience. Hosting, public authentication, shared rate limiting, and cloud deployment remain separate work; nothing was deployed publicly.
