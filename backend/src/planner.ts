import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Mode, NearbyInput, Place, Route, TripInput, TripResponse } from '../shared/contracts.js';
import { DemoProvider, demoWarning } from './providers/demo.js';
import { GoogleProvider } from './providers/google.js';
import { GeminiProvider } from './providers/gemini.js';

export interface MobilityProvider {
  routes(input: TripInput, mode: Mode): Promise<Route[]>;
  nearby(input: NearbyInput): Promise<Place[]>;
  search(query: string): Promise<Place[]>;
  details?(id: string): Promise<Place>;
}
export interface AiProvider {
  choose: GeminiProvider['choose'];
  groundedPlaces: GeminiProvider['groundedPlaces'];
  categories?: GeminiProvider['categories'];
  rankStops?: GeminiProvider['rankStops'];
}
export class AppError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export function evaluate(route: Route, input: TripInput, now = Date.now()): Route {
  const budget = route.cost.complete && route.cost.amount !== null && route.cost.currency === 'USD' ? route.cost.amount <= input.budgetUsd ? 'met' : 'exceeded' : 'unknown';
  const walking = route.walkingMinutes === null ? 'unknown' : route.walkingMinutes <= input.maxWalkingMinutes ? 'met' : 'exceeded';
  let arrival: Route['constraints']['arrival'] = 'not_requested';
  // A transit itinerary that already departed cannot be recommended, even without an arrival deadline.
  if (route.mode === 'TRANSIT' && route.departureTime && Date.parse(route.departureTime) < now) arrival = 'missed';
  else if (input.arrivalTime) arrival = route.arrivalTime && route.departureTime
    ? Date.parse(route.arrivalTime) <= Date.parse(input.arrivalTime) ? 'met' : 'missed' : 'unknown';
  return { ...route, constraints: { budget, walking, arrival, eligible: budget === 'met' && walking === 'met' && (arrival === 'met' || arrival === 'not_requested') } };
}
export function viable(r: Route) { return r.constraints.budget !== 'exceeded' && r.constraints.walking !== 'exceeded' && r.constraints.arrival !== 'missed'; }
function score(r: Route, preference: TripInput['preference']) {
  const cost = r.cost.complete && r.cost.currency === 'USD' ? r.cost.amount ?? 1000 : 1000;
  if (preference === 'cheapest') return cost * 1000 + r.durationMinutes;
  if (preference === 'fastest') return r.durationMinutes;
  if (preference === 'least_walking') return (r.walkingMinutes ?? 1000) * 1000 + r.durationMinutes;
  return r.durationMinutes + (r.walkingMinutes ?? 100) * 2 + Math.min(cost, 100) * 3;
}
function reason(route: Route, preference: TripInput['preference']) {
  const lead = { balanced: 'Balances travel time, walking, and known cost.', cheapest: 'Prioritizes the lowest available cost.', fastest: 'Prioritizes travel time.', least_walking: 'Prioritizes less walking.' }[preference];
  return `${lead} ${route.constraints.eligible ? 'Meets the checked budget, walking, and timing limits.' : 'Provisional option: one or more limits could not be verified; check its constraints and warnings.'}`;
}
export class Planner {
  readonly mobility: MobilityProvider;
  private ai: AiProvider | null;
  constructor(readonly config: Config, deps: { mobility?: MobilityProvider; ai?: AiProvider | null } = {}) {
    this.mobility = deps.mobility ?? (config.DATA_MODE === 'demo' ? new DemoProvider() : new GoogleProvider(config));
    this.ai = deps.ai !== undefined ? deps.ai : config.DATA_MODE === 'live' && config.GEMINI_API_KEY ? new GeminiProvider(config) : null;
  }
  async plan(input: TripInput, options: { skipAi?: boolean } = {}): Promise<TripResponse> {
    const now = Date.now();
    if (input.arrivalTime) {
      const arrival = Date.parse(input.arrivalTime);
      if (arrival <= now || arrival > now + 7 * 86400000) throw new AppError(400, 'INVALID_ARRIVAL_TIME', 'Arrival time must be in the future and within seven days. Include a timezone offset or Z.');
    }
    const warnings: string[] = this.config.DATA_MODE === 'demo' ? [demoWarning] : [];
    if (input.departureTime && (Date.parse(input.departureTime) < now - 60000 || Date.parse(input.departureTime) > now + 7 * 86400000))
      throw new AppError(400, 'INVALID_DEPARTURE_TIME', 'Departure must be now or within seven days.');
    const modes: Mode[] = [...(input.allowTransit ? ['TRANSIT' as const] : []), ...(input.allowWalking ? ['WALK' as const] : []), ...(input.hasCar ? ['DRIVE' as const] : []), ...(input.hasBike ? ['BICYCLE' as const] : [])];
    if (!modes.length) throw new AppError(400, 'NO_TRANSPORT_MODES', 'Enable transit, walking, a car, or a bicycle.');
    const results = await Promise.allSettled(modes.map(m => this.mobility.routes(input, m)));
    const routes = results.flatMap((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      warnings.push(`${modes[i]} provider request failed; this transport mode is unavailable.`);
      return [];
    }).map(r => evaluate(r, input, now));
    if (results.every(r => r.status === 'rejected')) throw new AppError(502, 'ROUTES_UNAVAILABLE', 'Route providers are unavailable. Try again shortly.');
    const possible = routes.filter(viable);
    const confirmed = possible.filter(r => r.constraints.eligible);
    const candidates = (confirmed.length ? confirmed : possible).sort((a, b) => score(a, input.preference) - score(b, input.preference));
    let best = candidates[0] ?? null;
    let source: 'rules' | 'gemini' = 'rules';
    if (best && this.ai && !options.skipAi) {
      try {
        const chosen = await this.ai.choose(input, candidates);
        const match = candidates.find(r => r.id === chosen.routeId);
        if (!match) throw new Error('Invalid route choice');
        // Preserve explicit numeric preferences; AI may balance only a balanced request.
        if (input.preference === 'balanced' || score(match, input.preference) === score(candidates[0], input.preference)) { best = match; source = 'gemini'; }
        else warnings.push('AI choice did not match the requested ranking; used rule-based ranking.');
      } catch { warnings.push('AI recommendation unavailable; used rule-based ranking.'); }
    } else if (this.config.DATA_MODE === 'live' && !this.ai && !options.skipAi) warnings.push('Gemini is not configured; used rule-based ranking.');
    if (!possible.length) warnings.push('No returned route meets the known limits. Adjust budget, walking limit, or arrival time.');
    if (!confirmed.length && possible.length) warnings.push('No route has all limits verified. The recommendation is provisional.');
    const pool = confirmed.length ? confirmed : possible;
    const cheapest = [...pool].filter(r => r.cost.complete && r.cost.amount !== null && r.cost.currency === 'USD').sort((a, b) => a.cost.amount! - b.cost.amount! || a.durationMinutes - b.durationMinutes)[0] ?? null;
    const fastest = [...pool].sort((a, b) => a.durationMinutes - b.durationMinutes)[0] ?? null;
    const destination = best?.destination ?? routes.find(r => r.destination)?.destination ?? ('latitude' in input.destination ? input.destination : null);
    const nearby: TripResponse['nearby'] = [];
    let groundedGuidance: TripResponse['groundedGuidance'] = null;
    if (input.nearbyCategories.length && destination) {
      const places = await Promise.allSettled([...new Set(input.nearbyCategories)].map(async category => ({ category, places: await this.mobility.nearby({ location: destination, category, radiusMeters: 800, openNow: false }) })));
      for (const result of places) {
        if (result.status === 'fulfilled') nearby.push(result.value);
        else warnings.push('A nearby-place category was unavailable.');
      }
      warnings.push('Nearby places are near the destination, not a planned detour. Route totals exclude visits and walking to these places.');
      if (this.ai && this.config.DATA_MODE === 'live' && this.config.ENABLE_MAPS_GROUNDING === 'true') {
        try { groundedGuidance = await this.ai.groundedPlaces(destination, input.nearbyCategories); }
        catch { warnings.push('Maps-grounded guidance unavailable; structured place results are still shown.'); }
      }
    } else if (input.nearbyCategories.length) warnings.push('Destination coordinates unavailable; nearby places could not be searched.');
    return {
      id: randomUUID(), generatedAt: new Date().toISOString(), dataMode: this.config.DATA_MODE, routes,
      best: best?.id ?? null, cheapest: cheapest?.id ?? null, fastest: fastest?.id ?? null,
      recommendation: { source, reason: best ? reason(best, input.preference) : 'No matching route was found.' },
      nearby, groundedGuidance, warnings,
      attribution: this.config.DATA_MODE === 'demo' ? 'Fictional demo fixtures' : 'Google Maps. Transit agency attribution is included in route steps.',
    };
  }
}
