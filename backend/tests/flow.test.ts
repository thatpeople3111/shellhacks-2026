import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { DemoProvider } from '../src/providers/demo.js';
import { flowPlanSchema, suggestionsSchema } from '../shared/flow-contracts.js';
import { openForVisit } from '../src/stop-utils.js';
import type { Mode, TripInput } from '../shared/contracts.js';

const apps: FastifyInstance[] = [];
const trip = { origin: 'FIU Miami', destination: 'Wynwood Miami', hasCar: true, allowTransit: false, budget: 30, maxWalkingMinutes: 15, departureTime: new Date(Date.now() + 3600000).toISOString() };
const prefs = { category: 'coffee', timing: 'ON_ROUTE', maxExtraMinutes: 30, maxExtraBudget: 10, skip: false };
async function setup(mobility = new DemoProvider()) { const app = await buildApp(readConfig({}), { mobility, ai: null }); apps.push(app); return app; }
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });
describe('frontend flow', () => {
  it('supports initial suggestions, category selection, selected stop and skip', async () => {
    const app = await setup();
    const initial = await app.inject({ method: 'POST', url: '/api/suggest-stops', payload: trip });
    const categories = suggestionsSchema.parse(initial.json());
    expect(categories.status).toBe('choose_category'); expect(categories.categories).toHaveLength(6);
    const response = await app.inject({ method: 'POST', url: '/api/suggest-stops', payload: { ...trip, stopPreferences: prefs } });
    const suggestions = suggestionsSchema.parse(response.json());
    expect(suggestions.stops).toHaveLength(1);
    expect(suggestions.stops[0].estimatedExtraMinutes).toBe(7);
    const final = await app.inject({ method: 'POST', url: '/api/plan-trip', payload: { ...trip, stopPreferences: prefs, selectedStop: { ...suggestions.stops[0], name: 'FAKE NAME', estimatedCost: 0 } } });
    const plan = flowPlanSchema.parse(final.json());
    expect(plan.routes.map(r => r.label)).toEqual(['BEST', 'FASTEST', 'CHEAPEST']);
    expect(plan.routes[0].stop?.name).toBe('Demo coffee'); expect(plan.routes[0].estimatedCost).toBe(17);
    expect(plan.routes[0].durationMinutes).toBe(39);
    const skipped = await app.inject({ method: 'POST', url: '/api/plan-trip', payload: { ...trip, stopPreferences: { skip: true } } });
    expect(flowPlanSchema.parse(skipped.json()).routes.every(r => !r.stop && r.durationMinutes === 32)).toBe(true);
  });
  it.each([{ maxExtraMinutes: 0 }, { maxExtraBudget: 1 }])('does not ignore an impossible stop limit: %j', async limits => {
    const app = await setup(); const result = await app.inject({ method: 'POST', url: '/api/plan-trip', payload: { ...trip, stopPreferences: { ...prefs, ...limits } } });
    expect(result.json()).toMatchObject({ status: 'no_matching_stops', routes: [], recommendedRouteId: null });
  });
  it('arrives at destination first, then walks to the stop and back', async () => {
    const calls: { input: TripInput; mode: Mode }[] = [];
    class Recorded extends DemoProvider { override async routes(input: TripInput, mode: Mode) { calls.push({ input, mode }); return super.routes(input, mode); } }
    const app = await setup(new Recorded());
    const result = await app.inject({ method: 'POST', url: '/api/plan-trip', payload: { ...trip, stopPreferences: { ...prefs, timing: 'DESTINATION' } } });
    const plan = flowPlanSchema.parse(result.json()); expect(plan.routes[0].durationMinutes).toBe(45); expect(plan.routes[0].walkingMinutes).toBe(8);
    const outward = calls.find(c => 'placeId' in c.input.destination)!;
    const inward = calls.find(c => 'placeId' in c.input.origin)!;
    expect(outward.mode).toBe('WALK'); expect(outward.input.origin).toEqual({ address: trip.destination });
    expect(Date.parse(inward.input.departureTime!) - Date.parse(outward.input.departureTime!)).toBe(9 * 60000);
  });
  it('rejects contradictory choices and invalid timestamps', async () => {
    const app = await setup();
    for (const extra of [{ selectedStop: { id: 'demo-coffee' }, stopPreferences: { skip: true } }, { stopPreferences: { skip: false } }, { departureTime: 'tomorrow' }, { timeZone: 'invalid' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/plan-trip', payload: { ...trip, ...extra } })).statusCode).toBe(400);
    }
  });
  it('excludes closed places and unknown prices under an explicit spending cap', async () => {
    for (const change of [{ businessStatus: 'CLOSED_TEMPORARILY' }, { priceRange: undefined }]) {
      class Unavailable extends DemoProvider { override async details(id: string) { return { ...await super.details(id), ...change }; } }
      const app = await setup(new Unavailable());
      const result = await app.inject({ method: 'POST', url: '/api/suggest-stops', payload: { ...trip, stopPreferences: prefs } });
      expect(result.json().status).toBe('no_matching_stops');
    }
  });
  it('requires opening hours to cover the entire visit', async () => {
    const place = await new DemoProvider().details('demo-coffee');
    place.utcOffsetMinutes = 0; place.openingPeriods = [{ open: { date: { year: 2026, month: 9, day: 26 }, hour: 9 }, close: { date: { year: 2026, month: 9, day: 26 }, hour: 10 } }];
    const now = Date.parse('2026-09-26T09:55:00Z');
    expect(openForVisit(place, now, 5, now)).toBe(true); expect(openForVisit(place, now, 6, now)).toBe(false);
  });
});
