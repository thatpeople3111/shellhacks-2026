# Frontend handoff

**For the current optional-stop flow, use [FLOW_GUIDE.md](../../FLOW_GUIDE.md).** It documents the exact `/api/suggest-stops` → category/timing/limits → Skip/Add → `/api/plan-trip` integration. Import `suggestStops` and `planTrip` from `src/lib/routewise.ts` and types from `src/lib/types.ts`.

The remaining examples below describe the retained legacy `/api/v1` API, whose request and response shapes differ. Do not mix them with the new frontend flow.

Run the backend on `http://localhost:3001`. Use `GET /api/v1/config` to load campus presets. Interactive request schemas are at `/docs/`.

## React / Vite example

Import the provided client and types using a relative path appropriate to your frontend's location. For `frontend/src/`, this might be:

```ts
import { createRouteWiseClient } from '../../backend/client/routewise';
const api = createRouteWiseClient(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001');

const plan = await api.planTrip({
  origin: { address: 'FIU Modesto A. Maidique Campus, Miami, FL' },
  destination: { address: 'Wynwood Walls, Miami, FL' },
  budgetUsd: 15,
  maxWalkingMinutes: 10,
  hasCar: true,
  preference: 'balanced',
  nearbyCategories: ['food'],
});

const best = plan.routes.find(route => route.id === plan.best);
const cheapest = plan.routes.find(route => route.id === plan.cheapest);
const fastest = plan.routes.find(route => route.id === plan.fastest);
```

The client uses only `fetch` at runtime. Its contract imports are type-only. Copy `client/` and `shared/` together if you move them outside this repository. Use an AbortController to cancel superseded searches/trips. Debounce destination searches to reduce Places requests.

For browser geolocation, obtain user permission in the UI and send coordinates. For selected search results, use the returned Google Place ID in live mode. In demo mode, IDs are fictional: send an address or coordinates instead.

For arrival time, `new Date(valueFromDatetimeLocal).toISOString()` interprets the input in the browser's local timezone. Label that timezone in the UI. If the form explicitly promises Miami time to users outside Miami, use a timezone-aware date library or send an ISO timestamp with the correct Miami offset.

## Rendering requirements

1. Show a persistent **Demo data** label whenever `dataMode === 'demo'`.
2. Build cards from `routes` using the three returned IDs. Handle `null` and duplicate card IDs.
3. Show `cost.amount === null` as **Cost unavailable**, never `$0`. Display `cost.note`. Compare currencies only when they match; budget matching currently uses USD.
4. Surface `constraints`, `warnings`, and provisional recommendations. `eligible: false` means some limit failed or could not be verified.
5. Render `steps` as the timeline. `encodedPolyline` is a Google encoded polyline for the map; it is `null` in demo mode. Preserve agency names/URLs and the Google Maps attribution.
6. Use `mapsUrl` for an “Open directions” link. It is a fresh Google Maps query, not a booking or a guarantee of the same departure/route.
7. Put `nearby` cards below the route. They are not included in the travel-time/cost totals. Unknown `openNow` is **Hours unavailable**.
8. `groundedGuidance` is optional and off by default. Display its Google Maps citations using `groundingMetadata.groundingChunks`, `groundingSupports`, and any provider widget metadata. Do not discard the attributions. Render text safely, never inject raw model text or URLs as HTML.
9. Display API errors from `RouteWiseError.message` and provide retry where appropriate. Keep a loading state while planning.

For Google-backed map content, follow the [Routes display policies](https://developers.google.com/maps/documentation/routes/policies) and [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies). Use a separately restricted browser Maps key; backend keys stay on the server.

## Public hosting / Next.js

Keep `API_ACCESS_TOKEN` in the frontend server environment. A Next.js route handler, for example, validates the user's session, forwards the JSON to `ROUTEWISE_API_URL/api/v1/trips/plan`, and adds the bearer token. The browser calls your own `/api/routewise/plan` route. Do not expose the token through `NEXT_PUBLIC_` or Vite variables. Set `createRouteWiseClient`'s base URL to the server proxy location only if the proxy preserves the `/api/v1/...` paths.

The current API stores no trips or user accounts. Add authentication and a database together when saved trips are in scope.
