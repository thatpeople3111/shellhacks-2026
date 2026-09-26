import { randomUUID } from 'node:crypto';
import { tripRequestSchema, type Place, type Route, type TripInput, type TripResponse } from '../shared/contracts.js';
import { finalTripRequestSchema, type FlowInput, type SuggestedStop, type StopInput, type TripPlan, type SuggestStopsResponse, type StopCategory } from '../shared/flow-contracts.js';
import type { Config } from './config.js';
import { AppError, evaluate, Planner, viable, type MobilityProvider, type AiProvider } from './planner.js';
import { GeminiProvider } from './providers/gemini.js';
import { placeTypes } from './providers/google.js';
import { decodePolyline, distance, encodePolyline, fallbackCategories, mapLimited, openForVisit } from './stop-utils.js';

type StopRoute = { route: Route; stop: SuggestedStop; links: string[] };
const roundUp = (value: number) => Math.ceil(value * 10) / 10;
function publicPlan(input: FlowInput, result: TripResponse, attached = new Map<string, StopRoute>()): TripPlan {
  const labels = [['BEST', result.best], ['FASTEST', result.fastest], ['CHEAPEST', result.cheapest]] as const;
  return {
    requestId: result.id, generatedAt: result.generatedAt, recommendedRouteId: result.best ? `best-${result.best}` : null,
    dataMode: result.dataMode, status: result.best ? 'ok' : 'no_matching_routes', warnings: result.warnings, rankingSource: result.recommendation.source, attribution: result.attribution,
    routes: labels.flatMap(([label, id]) => {
      const route = result.routes.find(r => r.id === id); if (!route) return [];
      const stop = attached.get(route.id);
      const travelCost = route.cost.currency === 'USD' ? route.cost.amount : null;
      const total = stop ? travelCost !== null && stop.stop.estimatedCost !== undefined ? travelCost + stop.stop.estimatedCost : null : travelCost;
      return [{ id: `${label.toLowerCase()}-${route.id}`, label, title: `${route.label}${stop ? ` + ${stop.stop.name}` : ''}`,
        transportMode: route.mode === 'DRIVE' ? 'DRIVING' : route.mode === 'WALK' ? 'WALKING' : route.mode,
        durationMinutes: route.durationMinutes, estimatedCost: total, walkingMinutes: route.walkingMinutes,
        ...(stop ? { stop: stop.stop, extraStopMinutes: stop.stop.estimatedExtraMinutes } : {}),
        summary: `${route.durationMinutes} minutes${stop ? ', including the stop and visit time' : ''}.`,
        reason: label === 'BEST' ? result.recommendation.reason : label === 'FASTEST' ? 'Shortest duration among the eligible available options.' : 'Lowest known complete cost among the eligible available options.',
        steps: route.steps.map(s => s.instruction), origin: input.origin, destination: input.destination,
        encodedPolyline: route.encodedPolyline, mapsUrl: route.mapsUrl, navigationLinks: stop?.links ?? [route.mapsUrl],
        departureTime: route.departureTime, arrivalTime: route.arrivalTime, constraints: route.constraints, cost: route.cost, warnings: route.warnings,
        transitAgencies: [...new Map(route.steps.flatMap(s => s.transit?.agencies ?? []).map(a => [`${a.name}-${a.url}`, a])).values()],
      }];
    }),
  };
}
export class FlowPlanner {
  readonly planner: Planner;
  private mobility: MobilityProvider;
  private ai: AiProvider | null;
  constructor(private config: Config, deps: { mobility?: MobilityProvider; ai?: AiProvider | null } = {}) {
    this.planner = new Planner(config, deps); this.mobility = this.planner.mobility;
    this.ai = deps.ai !== undefined ? deps.ai : config.DATA_MODE === 'live' && config.GEMINI_API_KEY ? new GeminiProvider(config) : null;
  }
  private input(raw: unknown): { request: FlowInput; trip: TripInput } {
    const request = finalTripRequestSchema.parse(raw);
    try { new Intl.DateTimeFormat('en', { timeZone: request.timeZone }).format(); } catch { throw new AppError(400, 'INVALID_TIMEZONE', 'Use an IANA timezone such as America/New_York.'); }
    const now = Date.now();
    if (request.departureTime && (Date.parse(request.departureTime) < now - 60000 || Date.parse(request.departureTime) > now + 7 * 86400000)) throw new AppError(400, 'INVALID_DEPARTURE_TIME', 'Departure must be now or within seven days.');
    if (request.departureTime && request.arrivalTime && Date.parse(request.arrivalTime) <= Date.parse(request.departureTime)) throw new AppError(400, 'INVALID_TIMES', 'Arrival must be later than departure.');
    if (request.selectedStop && request.stopPreferences?.skip) throw new AppError(400, 'INVALID_STOP', 'Skip and selectedStop cannot be combined.');
    const trip = tripRequestSchema.parse({ origin: { address: request.origin }, destination: { address: request.destination },
      // Forward scheduling permits comparing all modes at the same departure and rebuilding stops.
      departureTime: request.departureTime ?? new Date(now + 1000).toISOString(), arrivalTime: request.arrivalTime,
      budgetUsd: request.budget ?? 15, maxWalkingMinutes: request.maxWalkingMinutes ?? 10,
      hasCar: request.hasCar, hasBike: request.hasBike, allowTransit: request.allowTransit, allowWalking: request.allowWalking,
      avoidTolls: request.avoidTolls, preference: request.preference, notes: request.notes ?? '',
    });
    return { request, trip };
  }
  private preferences(request: FlowInput): StopInput | null {
    if (request.stopPreferences?.skip) return null;
    const category = request.stopPreferences?.category ?? request.selectedStop?.category;
    if (!category) {
      if (request.selectedStop || request.stopPreferences) throw new AppError(400, 'STOP_CATEGORY_REQUIRED', 'Choose a stop category or set skip to true.');
      return null;
    }
    return { category, timing: request.stopPreferences?.timing ?? request.selectedStop?.timing ?? 'ON_ROUTE',
      maxExtraMinutes: request.stopPreferences?.maxExtraMinutes, maxExtraBudget: request.stopPreferences?.maxExtraBudget,
      visitMinutes: request.stopPreferences?.visitMinutes ?? 5, skip: false };
  }
  private async candidatePlaces(request: FlowInput, base: TripResponse, prefs: StopInput): Promise<Place[]> {
    if (request.selectedStop) {
      if (!this.mobility.details) throw new AppError(503, 'PLACE_DETAILS_UNAVAILABLE', 'Place validation is unavailable.');
      return [await this.mobility.details(request.selectedStop.id)];
    }
    const route = base.routes.find(r => r.id === base.best) ?? base.routes.find(viable);
    if (!route?.destination) return [];
    let centers = [route.destination];
    if (prefs.timing === 'ON_ROUTE' && route.encodedPolyline) {
      try { const points = decodePolyline(route.encodedPolyline); if (points.length) centers = [0.25, 0.6, 0.9].map(f => points[Math.min(points.length - 1, Math.floor(points.length * f))]); } catch { /* No geometry: search destination and still calculate the full detour. */ }
    }
    const responses = await Promise.allSettled(centers.map(location => this.mobility.nearby({ location, category: prefs.category!, radiusMeters: prefs.timing === 'DESTINATION' ? 1200 : 1500, openNow: false })));
    if (responses.every(r => r.status === 'rejected')) throw new AppError(502, 'PLACES_UNAVAILABLE', 'Place search is unavailable. Retry or skip the stop.');
    const groups = responses.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    const interleaved = Array.from({ length: Math.max(0, ...groups.map(g => g.length)) }, (_, i) => groups.flatMap(g => g[i] ? [g[i]] : [])).flat();
    const found = [...new Map(interleaved.map(p => [p.id, p])).values()].slice(0, 4);
    // Demo fixtures are deliberately enriched locally, never through external services.
    return this.config.DATA_MODE === 'demo' && this.mobility.details ? Promise.all(found.map(p => this.mobility.details!(p.id))) : found;
  }
  private async viaStop(trip: TripInput, base: Route, place: Place, prefs: StopInput): Promise<StopRoute | null> {
    if (!place.location || !place.types?.some(t => placeTypes[prefs.category!].includes(t))) return null;
    if (prefs.timing === 'DESTINATION' && base.destination && distance(place.location, base.destination) > 1200) return null;
    if (prefs.maxExtraBudget !== undefined && (!place.priceRange || place.priceRange.currency !== 'USD' || place.priceRange.high > prefs.maxExtraBudget)) return null;
    const atDestination = prefs.timing === 'DESTINATION';
    if (atDestination && (!trip.allowWalking || !base.arrivalTime)) return null;
    const firstRoutes = await this.mobility.routes({ ...trip, origin: atDestination ? trip.destination : trip.origin, destination: { placeId: place.id }, departureTime: atDestination ? base.arrivalTime! : trip.departureTime, arrivalTime: undefined }, atDestination ? 'WALK' : base.mode);
    let first = firstRoutes.filter(r => r.arrivalTime && r.departureTime && Date.parse(r.departureTime) >= Date.parse(atDestination ? base.arrivalTime! : trip.departureTime!) - 1000).sort((a, b) => Date.parse(a.arrivalTime!) - Date.parse(b.arrivalTime!))[0];
    if (!first?.arrivalTime) return null;
    if (atDestination) {
      let geometry: string | null = null;
      if (base.encodedPolyline && first.encodedPolyline) { try { geometry = encodePolyline([...decodePolyline(base.encodedPolyline), ...decodePolyline(first.encodedPolyline)]); } catch {} }
      first = { ...first, departureTime: base.departureTime, cost: base.cost, distanceMeters: base.distanceMeters + first.distanceMeters,
        walkingMinutes: base.walkingMinutes === null || first.walkingMinutes === null ? null : base.walkingMinutes + first.walkingMinutes,
        encodedPolyline: geometry, steps: [...base.steps, ...first.steps], warnings: [...base.warnings, ...first.warnings] };
    }
    const visitAt = Date.parse(first.arrivalTime!);
    if (openForVisit(place, visitAt, prefs.visitMinutes) !== true) return null;
    const onward = new Date(visitAt + prefs.visitMinutes * 60000).toISOString();
    const secondRoutes = await this.mobility.routes({ ...trip, origin: { placeId: place.id }, departureTime: onward, arrivalTime: undefined }, atDestination ? 'WALK' : base.mode);
    const second = secondRoutes.filter(r => r.arrivalTime && r.departureTime && Date.parse(r.departureTime) >= Date.parse(onward) - 1000).sort((a, b) => Date.parse(a.arrivalTime!) - Date.parse(b.arrivalTime!))[0];
    if (!second?.arrivalTime) return null;
    const totalMinutes = (Date.parse(second.arrivalTime) - Date.parse(trip.departureTime!)) / 60000;
    const extra = Math.max(0, totalMinutes - base.durationMinutes);
    if (extra > (prefs.maxExtraMinutes ?? 30)) return null;
    const costKnown = first.cost.amount !== null && second.cost.amount !== null && first.cost.currency === 'USD' && second.cost.currency === 'USD';
    const cost = costKnown ? { ...first.cost, amount: Math.round((first.cost.amount! + second.cost.amount!) * 100) / 100,
      complete: first.cost.complete && second.cost.complete && (base.mode !== 'TRANSIT' || atDestination),
      note: base.mode === 'TRANSIT' && !atDestination ? 'Sum of separately quoted fares; transfer eligibility and the final fare are unverified.' : first.cost.note,
    } : { ...first.cost, amount: null, complete: false, kind: 'unknown' as const, note: 'Full travel cost through the stop is unavailable.' };
    let encodedPolyline: string | null = null;
    if (first.encodedPolyline && second.encodedPolyline) { try { encodedPolyline = encodePolyline([...decodePolyline(first.encodedPolyline), ...decodePolyline(second.encodedPolyline)]); } catch { /* Keep geometry unavailable rather than inventing it. */ } }
    const route = evaluate({ ...base, id: `${base.mode.toLowerCase()}-via-${place.id}`, durationMinutes: roundUp(totalMinutes),
      distanceMeters: first.distanceMeters + second.distanceMeters,
      walkingMinutes: first.walkingMinutes === null || second.walkingMinutes === null ? null : roundUp(first.walkingMinutes + second.walkingMinutes),
      cost, encodedPolyline, departureTime: first.departureTime, arrivalTime: second.arrivalTime,
      steps: [...first.steps, { mode: 'WALK', instruction: `Visit ${place.name} (${prefs.visitMinutes} minutes planned)`, durationMinutes: prefs.visitMinutes, distanceMeters: 0, transit: null }, ...second.steps],
      warnings: [...new Set([...first.warnings, ...second.warnings, 'Visit time is user-selected; queues and service time can vary.'])],
    }, trip, Date.parse(trip.departureTime!) - 1000);
    if (!viable(route) || route.walkingMinutes === null) return null;
    const warnings = ['Stop spending is separate from the transport budget.'];
    if (place.priceRange) warnings.push('Place price range is a typical-spend estimate, not a menu quote or spending guarantee.');
    else warnings.push('Stop spending is unknown.');
    return { route, links: [...(atDestination ? [base.mapsUrl] : []), first.mapsUrl, second.mapsUrl], stop: {
      id: place.id, name: place.name, category: prefs.category!, address: place.address, timing: prefs.timing,
      estimatedExtraMinutes: roundUp(extra), ...(place.priceRange?.currency === 'USD' ? { estimatedCost: place.priceRange.high, priceRange: place.priceRange } : {}),
      rating: place.rating, location: place.location, mapsUrl: place.mapsUrl, visitMinutes: prefs.visitMinutes,
      arrivalTime: first.arrivalTime!, budgetStatus: prefs.maxExtraBudget === undefined ? 'not_requested' : 'estimated_within_limit',
      warnings, routeMode: base.mode, attributions: place.attributions,
    } };
  }
  private async stopOptions(request: FlowInput, trip: TripInput, base: TripResponse, prefs: StopInput): Promise<{ options: StopRoute[]; warnings: string[] }> {
    const byMode = new Map<string, Route>();
    for (const route of base.routes.filter(viable).sort((a, b) => a.durationMinutes - b.durationMinutes)) if (!byMode.has(route.mode)) byMode.set(route.mode, route);
    if (!byMode.size) return { options: [], warnings: ['No base route meets the known trip restrictions.'] };
    const places = await this.candidatePlaces(request, base, prefs);
    const work = places.flatMap(place => [...byMode.values()].map(route => ({ place, route })));
    const deadline = Date.now() + 35000;
    const results = await mapLimited(work, 4, ({ place, route }) => {
      if (Date.now() > deadline) throw new Error('Stop evaluation time budget exhausted');
      return this.viaStop(trip, route, place, prefs);
    });
    const options = results.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []);
    const warnings = results.some(r => r.status === 'rejected') ? ['Some stop routes could not be verified and were excluded.'] : [];
    if (!options.length) warnings.push('No stop was verified within all limits and opening hours. Try another category, increase the limit, remove the spending cap, or skip.');
    return { options, warnings };
  }
  async suggest(raw: unknown): Promise<SuggestStopsResponse> {
    const { request, trip } = this.input(raw);
    const base = await this.planner.plan(trip, { skipAi: true });
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: request.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(request.arrivalTime ?? trip.departureTime!)));
    let categories = fallbackCategories(hour), categorySource: 'rules' | 'gemini' = 'rules', rankingSource: 'rules' | 'gemini' = 'rules';
    const warnings = [...base.warnings];
    const prefs = this.preferences(request);
    // Initial call prepares the base trip and time-aware buttons; selected-category calls prepare candidates.
    if (!prefs && this.ai?.categories) { try { categories = await this.ai.categories(hour, request.notes ?? ''); categorySource = 'gemini'; } catch { warnings.push('AI categories unavailable; used time-aware fallback categories.'); } }
    let stops: SuggestedStop[] = [];
    if (prefs) {
      const evaluated = await this.stopOptions(request, trip, base, prefs); warnings.push(...evaluated.warnings);
      const options = evaluated.options.sort((a, b) => a.stop.estimatedExtraMinutes - b.stop.estimatedExtraMinutes);
      stops = [...new Map(options.map(o => o.stop.id).map(id => [id, options.find(o => o.stop.id === id)!.stop])).values()];
      if (stops.length && this.ai?.rankStops) { try { const ids = await this.ai.rankStops(stops, request.notes ?? ''); if (ids.length !== stops.length || new Set(ids).size !== stops.length || ids.some(id => !stops.some(s => s.id === id))) throw new Error('Invalid IDs'); stops.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); rankingSource = 'gemini'; } catch { warnings.push('AI stop ranking unavailable; used extra-time ranking.'); } }
    }
    return { categories, stops, dataMode: base.dataMode, status: !base.best ? 'no_matching_routes' : !prefs ? 'choose_category' : stops.length ? 'ok' : 'no_matching_stops',
      warnings, categorySource, rankingSource, basePlan: publicPlan(request, base), requestId: randomUUID() };
  }
  async plan(raw: unknown): Promise<TripPlan> {
    const { request, trip } = this.input(raw);
    const prefs = this.preferences(request);
    if (!prefs) return publicPlan(request, await this.planner.plan(trip));
    const base = await this.planner.plan(trip, { skipAi: true });
    const { options, warnings } = await this.stopOptions(request, trip, base, prefs);
    if (!options.length) return { ...publicPlan(request, { ...base, routes: [], best: null, cheapest: null, fastest: null }), status: 'no_matching_stops', warnings: [...base.warnings, ...warnings] };
    // Reuse the proven ranking logic with provider-backed rebuilt candidates; never return direct routes when a stop is required.
    const mobility: MobilityProvider = { routes: async (_, mode) => options.filter(o => o.route.mode === mode).map(o => o.route), nearby: this.mobility.nearby.bind(this.mobility), search: this.mobility.search.bind(this.mobility) };
    const result = await new Planner(this.config, { mobility, ai: this.ai }).plan(trip);
    result.warnings.push(...warnings, 'Routes include the selected visit time; transport budget and extra-stop spending are checked separately.');
    // Cheapest must compare known complete trip totals, including the stop, not travel-only fares.
    const known = options.filter(o => o.route.constraints.eligible && o.route.cost.complete && o.route.cost.amount !== null && o.stop.estimatedCost !== undefined).sort((a, b) => a.route.cost.amount! + a.stop.estimatedCost! - b.route.cost.amount! - b.stop.estimatedCost!);
    result.cheapest = known[0]?.route.id ?? null;
    return publicPlan(request, result, new Map(options.map(o => [o.route.id, o])));
  }
}
