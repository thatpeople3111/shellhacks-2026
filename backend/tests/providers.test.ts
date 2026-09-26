import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config.js';
import { GoogleProvider } from '../src/providers/google.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { postJson } from '../src/providers/http.js';
import { DemoProvider } from '../src/providers/demo.js';
import { tripRequestSchema } from '../shared/contracts.js';

const config = readConfig({ DATA_MODE: 'live', GOOGLE_MAPS_API_KEY: 'private-maps-key', GEMINI_API_KEY: 'private-gemini-key' });
const input = tripRequestSchema.parse({ origin: { address: 'FIU MMC' }, destination: { latitude: 25.8, longitude: -80.2 }, arrivalTime: new Date(Date.now() + 3 * 3600000).toISOString(), avoidTolls: true });
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const transitFixture = {
  routes: [{ duration: '3480s', distanceMeters: 18000, polyline: { encodedPolyline: 'example-polyline' }, travelAdvisory: { transitFare: { currencyCode: 'USD', units: '5', nanos: 500000000 } },
    legs: [{ endLocation: { latLng: { latitude: 25.8, longitude: -80.2 } }, steps: [
      { travelMode: 'WALK', staticDuration: '240s', distanceMeters: 300 },
      { travelMode: 'TRANSIT', staticDuration: '3000s', distanceMeters: 17400, transitDetails: { transitLine: { nameShort: '11', agencies: [{ name: 'Example Transit', uri: 'https://example.com/transit' }] }, stopDetails: { departureStop: { name: 'Campus' }, arrivalStop: { name: 'Downtown' }, departureTime: '2026-09-26T22:00:00Z', arrivalTime: '2026-09-26T22:50:00Z' } } },
      { travelMode: 'WALK', staticDuration: '240s', distanceMeters: 300 },
    ] }],
  }],
};
describe('provider protocol and normalization', () => {
  it('uses correct transit payload, fare units, walking totals and access/egress times', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(transitFixture));
    const routes = await new GoogleProvider(config, fetcher).routes(input, 'TRANSIT');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const body = JSON.parse(init!.body as string);
    expect(body.arrivalTime).toBe(input.arrivalTime); expect(body).not.toHaveProperty('routeModifiers'); expect(body).not.toHaveProperty('departureTime');
    expect(routes[0]).toMatchObject({ durationMinutes: 58, walkingMinutes: 8, cost: { amount: 5.5 }, departureTime: '2026-09-26T21:56:00.000Z', arrivalTime: '2026-09-26T22:54:00.000Z', encodedPolyline: 'example-polyline' });
    expect(routes[0].steps[1].transit?.agencies[0].name).toBe('Example Transit');
  });
  it('does not send unsupported arrival time on driving requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ routes: [] }));
    await new GoogleProvider(config, fetcher).routes(input, 'DRIVE');
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty('arrivalTime'); expect(body.routeModifiers.avoidTolls).toBe(true);
    expect(body.routingPreference).toBe('TRAFFIC_AWARE');
  });
  it('preserves absent fares and absent transit steps as unknown', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ routes: [{ duration: '600s', legs: [{}] }] }));
    const routes = await new GoogleProvider(config, fetcher).routes(input, 'TRANSIT');
    expect(routes[0].cost.amount).toBeNull(); expect(routes[0].walkingMinutes).toBeNull();
  });
  it.each([{}, { currencyCode: 'USD' }, { units: '2' }])('keeps transit routes with an empty or incomplete fare without assuming they are free', async transitFare => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ routes: [{ duration: '600s', legs: [{}], travelAdvisory: { transitFare } }] }));
    const routes = await new GoogleProvider(config, fetcher).routes(input, 'TRANSIT');
    expect(routes).toHaveLength(1);
    expect(routes[0].cost).toMatchObject({ amount: null, kind: 'unknown', complete: false });
  });
  it('filters closed and unknown-hours places when openNow is requested', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ places: [
      { id: 'open', displayName: { text: 'Open cafe' }, currentOpeningHours: { openNow: true } },
      { id: 'closed', displayName: { text: 'Closed cafe' }, currentOpeningHours: { openNow: false } },
      { id: 'unknown', displayName: { text: 'Unknown cafe' } },
    ] }));
    const places = await new GoogleProvider(config, fetcher).nearby({ location: { latitude: 25.8, longitude: -80.2 }, category: 'coffee', radiusMeters: 800, openNow: true });
    expect(places.map(p => p.id)).toEqual(['open']);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).includedTypes).toEqual(['cafe']);
  });
  it('rejects malformed provider data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ routes: [{ duration: 'not-a-duration' }] }));
    await expect(new GoogleProvider(config, fetcher).routes(input, 'TRANSIT')).rejects.toThrow('invalid_response');
  });
  it('sanitizes errors and bounds requests with an abort signal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-debug-body', { status: 403 }));
    await expect(postJson('Test', 'https://example.com', 'secret', {}, 1000, fetcher)).rejects.toMatchObject({ message: 'Test: unavailable', upstreamStatus: 403 });
    expect(fetcher.mock.calls[0][1]!.signal).toBeInstanceOf(AbortSignal);
    fetcher.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(postJson('Test', 'https://example.com', 'secret', {}, 1000, fetcher)).rejects.toMatchObject({ code: 'timeout' });
  });
  it('validates Gemini IDs and ignores thought text', async () => {
    const route = (await new DemoProvider().routes(input, 'TRANSIT'))[0];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ candidates: [{ content: { parts: [{ thought: true, text: 'thinking' }, { text: JSON.stringify({ routeId: route.id, reasonCode: 'balanced' }) }] } }] }));
    expect((await new GeminiProvider(config, fetcher).choose(input, [route])).routeId).toBe(route.id);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).not.toContain('FIU MMC');
    fetcher.mockResolvedValue(response({ candidates: [{ content: { parts: [{ text: '{"routeId":"fake","reasonCode":"balanced"}' }] } }] }));
    await expect(new GeminiProvider(config, fetcher).choose(input, [route])).rejects.toThrow('invalid_response');
  });
  it('preserves Maps grounding citations without mixing them into route facts', async () => {
    const metadata = { groundingChunks: [{ maps: { uri: 'https://maps.google.com/example', title: 'Example place' } }], groundingSupports: [] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ candidates: [{ content: { parts: [{ text: 'Grounded suggestion' }] }, groundingMetadata: metadata }] }));
    const result = await new GeminiProvider(config, fetcher).groundedPlaces({ latitude: 25.8, longitude: -80.2 }, ['food']);
    expect(result.groundingMetadata).toEqual(metadata);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.tools).toEqual([{ googleMaps: {} }]); expect(body).not.toHaveProperty('generationConfig');
  });
});
