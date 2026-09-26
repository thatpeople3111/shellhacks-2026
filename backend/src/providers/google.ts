import { z } from 'zod';
import type { Config } from '../config.js';
import type { Coordinates, Location, Mode, NearbyInput, Place, Route, TripInput } from '../../shared/contracts.js';
import { coordinatesSchema, placeSchema } from '../../shared/contracts.js';
import { getJson, postJson, ProviderError, type Fetch } from './http.js';

const duration = z.string().regex(/^\d+(?:\.\d+)?s$/);
// Google can return transitFare: {} when no fare is available.
const money = z.object({ currencyCode: z.string().optional(), units: z.string().optional(), nanos: z.number().optional() });
const point = z.object({ latLng: coordinatesSchema.optional() });
const stop = z.object({ name: z.string().optional() });
const transit = z.object({
  headsign: z.string().optional(),
  stopDetails: z.object({ departureStop: stop.optional(), arrivalStop: stop.optional(), departureTime: z.string().optional(), arrivalTime: z.string().optional() }).optional(),
  transitLine: z.object({ name: z.string().optional(), nameShort: z.string().optional(), agencies: z.array(z.object({ name: z.string(), uri: z.string().optional() })).optional() }).optional(),
});
const googleStep = z.object({
  travelMode: z.enum(['TRANSIT', 'DRIVE', 'WALK', 'BICYCLE']).optional(),
  staticDuration: duration.optional(), distanceMeters: z.number().nonnegative().optional(),
  navigationInstruction: z.object({ instructions: z.string().optional() }).optional(), transitDetails: transit.optional(),
});
const googleRoute = z.object({
  duration, distanceMeters: z.number().nonnegative().default(0), description: z.string().optional(),
  polyline: z.object({ encodedPolyline: z.string().optional() }).optional(),
  travelAdvisory: z.object({ transitFare: money.optional() }).optional(),
  legs: z.array(z.object({ endLocation: point.optional(), steps: z.array(googleStep).optional() })).min(1),
});
const routesResponse = z.object({ routes: z.array(googleRoute).default([]) });
const googlePlace = z.object({
  id: z.string(), displayName: z.object({ text: z.string() }), formattedAddress: z.string().optional(),
  location: coordinatesSchema.optional(), googleMapsUri: z.string().optional(),
  currentOpeningHours: z.object({ openNow: z.boolean().optional(), periods: placeSchema.shape.openingPeriods }).optional(), priceLevel: z.string().optional(),
  types: z.array(z.string()).optional(), rating: z.number().optional(), businessStatus: z.string().optional(), utcOffsetMinutes: z.number().optional(),
  priceRange: z.object({ startPrice: money.optional(), endPrice: money.optional() }).optional(),
  attributions: z.array(z.object({ provider: z.string().optional(), providerUri: z.string().optional() })).optional(),
});
const placesResponse = z.object({ places: z.array(googlePlace).default([]) });
const minutes = (s?: string) => s ? Number(s.slice(0, -1)) / 60 : 0;
const round = (n: number) => Math.round(n * 10) / 10;
export const placeTypes = { food: ['restaurant'], coffee: ['cafe', 'coffee_shop'], parking: ['parking'], gas: ['gas_station'], ev_charging: ['electric_vehicle_charging_station'], pharmacy: ['pharmacy'], groceries: ['grocery_store', 'supermarket'], dessert: ['bakery', 'ice_cream_shop', 'dessert_shop'] };
const placeFields = ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'currentOpeningHours', 'priceLevel', 'priceRange', 'types', 'businessStatus', 'utcOffsetMinutes', 'attributions'];
function normalizePlace(p: z.infer<typeof googlePlace>): Place {
  const low = p.priceRange?.startPrice, high = p.priceRange?.endPrice;
  const amount = (m: z.infer<typeof money>) => m.units === undefined && m.nanos === undefined ? NaN : Number(m.units ?? 0) + (m.nanos ?? 0) / 1e9;
  const range = low?.currencyCode && high?.currencyCode === low.currencyCode && Number.isFinite(amount(low)) && Number.isFinite(amount(high)) && amount(low) >= 0 && amount(high) >= amount(low)
    ? { low: amount(low), high: amount(high), currency: low.currencyCode } : undefined;
  return { id: p.id, name: p.displayName.text, address: p.formattedAddress ?? '', location: p.location ?? null, mapsUrl: p.googleMapsUri ?? null,
    openNow: p.currentOpeningHours?.openNow ?? null, priceLevel: p.priceLevel ?? null,
    types: p.types, rating: p.rating, businessStatus: p.businessStatus, utcOffsetMinutes: p.utcOffsetMinutes,
    priceRange: range, openingPeriods: p.currentOpeningHours?.periods,
    attributions: (p.attributions ?? []).map(a => ({ provider: a.provider ?? 'Google Maps', providerUri: a.providerUri ?? null })),
  };
}
export function waypoint(location: Location): object {
  if ('address' in location) return { address: location.address };
  if ('placeId' in location) return { placeId: location.placeId };
  return { location: { latLng: location } };
}
export function mapsLink(origin: Location, destination: Location, mode: Mode): string {
  const label = (l: Location) => 'address' in l ? l.address : 'placeId' in l ? l.placeId : `${l.latitude},${l.longitude}`;
  const params = new URLSearchParams({ api: '1', origin: label(origin), destination: label(destination), travelmode: { DRIVE: 'driving', TRANSIT: 'transit', WALK: 'walking', BICYCLE: 'bicycling' }[mode] });
  if ('placeId' in origin) params.set('origin_place_id', origin.placeId);
  if ('placeId' in destination) params.set('destination_place_id', destination.placeId);
  return `https://www.google.com/maps/dir/?${params}`;
}
export function normalizeRoute(raw: z.infer<typeof googleRoute>, mode: Mode, input: TripInput, index: number): Route {
  const rawSteps = raw.legs.flatMap(l => l.steps ?? []);
  const steps: Route['steps'] = rawSteps.map(s => ({
    mode: s.travelMode ?? mode,
    instruction: s.navigationInstruction?.instructions ?? (s.transitDetails ? `Take ${s.transitDetails.transitLine?.nameShort ?? s.transitDetails.transitLine?.name ?? 'transit'}` : `Continue by ${mode.toLowerCase()}`),
    durationMinutes: round(minutes(s.staticDuration)), distanceMeters: s.distanceMeters ?? 0,
    transit: s.transitDetails ? {
      line: s.transitDetails.transitLine?.nameShort ?? s.transitDetails.transitLine?.name ?? 'Transit',
      headsign: s.transitDetails.headsign ?? null,
      departureStop: s.transitDetails.stopDetails?.departureStop?.name ?? null,
      arrivalStop: s.transitDetails.stopDetails?.arrivalStop?.name ?? null,
      departureTime: s.transitDetails.stopDetails?.departureTime ?? null,
      arrivalTime: s.transitDetails.stopDetails?.arrivalTime ?? null,
      agencies: (s.transitDetails.transitLine?.agencies ?? []).map(a => ({ name: a.name, url: a.uri ?? null })),
    } : null,
  }));
  const walkingKnown = rawSteps.length > 0 && rawSteps.every(s => s.travelMode && (s.travelMode !== 'WALK' || s.staticDuration !== undefined));
  const walking = mode === 'WALK' ? minutes(raw.duration) : mode === 'DRIVE' || mode === 'BICYCLE' ? 0 : walkingKnown ? rawSteps.filter(s => s.travelMode === 'WALK').reduce((a, s) => a + minutes(s.staticDuration), 0) : null;
  const fare = raw.travelAdvisory?.transitFare;
  const fareAmount = fare && (fare.units !== undefined || fare.nanos !== undefined) ? Number(fare.units ?? 0) + (fare.nanos ?? 0) / 1e9 : null;
  const free = mode === 'WALK' || mode === 'BICYCLE';
  const cost: Route['cost'] = free ? { amount: 0, currency: 'USD', kind: 'no_fare', complete: true, note: 'No ticket cost; assumes your own bicycle when cycling.' } : fare?.currencyCode && fareAmount !== null && Number.isFinite(fareAmount) && fareAmount >= 0 ? {
    amount: Math.round(fareAmount * 100) / 100, currency: fare.currencyCode, kind: 'provider_fare', complete: true, note: 'Fare returned by Google Routes; confirm with the operator.',
  } : { amount: null, currency: 'USD', kind: 'unknown', complete: false, note: mode === 'DRIVE' ? 'Fuel, tolls, and parking costs are not available.' : 'The provider did not return a transit fare.' };
  let departureTime: string | null = null;
  let arrivalTime: string | null = null;
  const first = rawSteps.findIndex(s => s.transitDetails);
  const last = rawSteps.findLastIndex(s => s.transitDetails);
  const before = rawSteps.slice(0, first);
  const after = rawSteps.slice(last + 1);
  const firstDeparture = first >= 0 ? rawSteps[first].transitDetails?.stopDetails?.departureTime : undefined;
  const lastArrival = last >= 0 ? rawSteps[last].transitDetails?.stopDetails?.arrivalTime : undefined;
  if (firstDeparture && Number.isFinite(Date.parse(firstDeparture)) && before.every(s => s.staticDuration !== undefined))
    departureTime = new Date(Date.parse(firstDeparture) - before.reduce((a, s) => a + minutes(s.staticDuration) * 60000, 0)).toISOString();
  if (lastArrival && Number.isFinite(Date.parse(lastArrival)) && after.every(s => s.staticDuration !== undefined))
    arrivalTime = new Date(Date.parse(lastArrival) + after.reduce((a, s) => a + minutes(s.staticDuration) * 60000, 0)).toISOString();
  if (mode !== 'TRANSIT' && input.departureTime) {
    departureTime = input.departureTime;
    arrivalTime = new Date(Date.parse(departureTime) + minutes(raw.duration) * 60000).toISOString();
  }
  const elapsed = mode === 'TRANSIT' && input.departureTime && arrivalTime ? Math.max(minutes(raw.duration), (Date.parse(arrivalTime) - Date.parse(input.departureTime)) / 60000) : minutes(raw.duration);
  const warnings: string[] = [];
  if (elapsed > minutes(raw.duration) + 1) warnings.push('Total time includes waiting for the first scheduled transit service.');
  if (mode === 'DRIVE') warnings.push('Driving time excludes finding parking and walking from parking to the destination.');
  if (input.arrivalTime && mode !== 'TRANSIT') warnings.push('Arrival is estimated from the departure time and route duration; it is not an arrival-time routing guarantee.');
  if (mode === 'WALK' || mode === 'BICYCLE') warnings.push('Walking and cycling routes may be missing clear sidewalks or paths. Use caution.');
  if (mode === 'DRIVE' && input.avoidTolls) warnings.push('Avoid tolls is a routing preference, not a guarantee. Check the directions.');
  return {
    id: `${mode.toLowerCase()}-${index + 1}`, mode, label: raw.description ?? { DRIVE: 'Direct drive', TRANSIT: 'Public transit', WALK: 'Walk', BICYCLE: 'Bicycle' }[mode],
    durationMinutes: round(elapsed), distanceMeters: raw.distanceMeters, walkingMinutes: walking === null ? null : round(walking),
    cost, steps, encodedPolyline: raw.polyline?.encodedPolyline ?? null,
    destination: raw.legs.at(-1)?.endLocation?.latLng ?? null,
    mapsUrl: mapsLink(input.origin, input.destination, mode), departureTime, arrivalTime,
    timing: mode === 'TRANSIT' && arrivalTime && departureTime ? 'scheduled' : 'estimated_now',
    constraints: { budget: 'unknown', walking: 'unknown', arrival: 'unknown', eligible: false }, warnings,
  };
}
export class GoogleProvider {
  constructor(private config: Config, private fetcher: Fetch = fetch) {}
  async routes(input: TripInput, mode: Mode): Promise<Route[]> {
    const body = {
      origin: waypoint(input.origin), destination: waypoint(input.destination), travelMode: mode,
      computeAlternativeRoutes: mode === 'TRANSIT' || mode === 'DRIVE', languageCode: 'en-US', units: 'IMPERIAL',
      ...(mode === 'TRANSIT' ? { transitPreferences: { routingPreference: 'LESS_WALKING' }, ...(input.arrivalTime && !input.departureTime ? { arrivalTime: input.arrivalTime } : {}) } : {}),
      ...(input.departureTime && Date.parse(input.departureTime) > Date.now() + 1000 ? { departureTime: input.departureTime } : {}),
      ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE', routeModifiers: { avoidTolls: input.avoidTolls } } : {}),
    };
    const raw = await postJson('Google Routes', 'https://routes.googleapis.com/directions/v2:computeRoutes', this.config.GOOGLE_MAPS_API_KEY, body, this.config.PROVIDER_TIMEOUT_MS, this.fetcher,
      'routes.duration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline,routes.legs.endLocation,routes.legs.steps,routes.travelAdvisory.transitFare');
    const parsed = routesResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError('Google Routes', 'invalid_response');
    return parsed.data.routes.map((r, i) => normalizeRoute(r, mode, input, i));
  }
  private async places(endpoint: string, body: object): Promise<Place[]> {
    const raw = await postJson('Google Places', `https://places.googleapis.com/v1/places:${endpoint}`, this.config.GOOGLE_MAPS_API_KEY, body, this.config.PROVIDER_TIMEOUT_MS, this.fetcher,
      placeFields.map(f => `places.${f}`).join(','));
    const parsed = placesResponse.safeParse(raw);
    if (!parsed.success) throw new ProviderError('Google Places', 'invalid_response');
    return parsed.data.places.map(normalizePlace);
  }
  async nearby(input: NearbyInput): Promise<Place[]> {
    const places = await this.places('searchNearby', { includedTypes: placeTypes[input.category], maxResultCount: 8, rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: input.location, radius: input.radiusMeters } },
    });
    return input.openNow ? places.filter(p => p.openNow === true) : places;
  }
  search(query: string): Promise<Place[]> {
    return this.places('searchText', { textQuery: query, pageSize: 6, locationBias: { circle: { center: { latitude: 25.7617, longitude: -80.1918 }, radius: 40000 } } });
  }
  async details(id: string): Promise<Place> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new ProviderError('Google Places', 'invalid_response');
    const raw = await getJson('Google Places', `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, this.config.GOOGLE_MAPS_API_KEY, this.config.PROVIDER_TIMEOUT_MS, this.fetcher, placeFields.join(','));
    const parsed = googlePlace.safeParse(raw);
    if (!parsed.success) throw new ProviderError('Google Places', 'invalid_response');
    return normalizePlace(parsed.data);
  }
}
