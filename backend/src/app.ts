import { timingSafeEqual } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { z } from 'zod';
import { type Config, readConfig } from './config.js';
import { AppError, Planner, type AiProvider, type MobilityProvider } from './planner.js';
import { campusPresets, demoWarning } from './providers/demo.js';
import { ProviderError } from './providers/http.js';
import { nearbyRequestSchema, nearbyResponseSchema, searchRequestSchema, tripRequestSchema, tripResponseSchema } from '../shared/contracts.js';
import { finalTripRequestSchema, flowPlanSchema, suggestionsSchema } from '../shared/flow-contracts.js';
import { FlowPlanner } from './flow.js';

function json(schema: z.ZodType, io: 'input' | 'output' = 'input') { return z.toJSONSchema(schema, { target: 'draft-7', io }); }
function output<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(500, 'INVALID_PROVIDER_RESULT', 'The itinerary could not be validated. Retry or change the trip.');
  return parsed.data;
}
export async function buildApp(config: Config = readConfig(), deps: { mobility?: MobilityProvider; ai?: AiProvider | null; logger?: boolean } = {}) {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 16384, logController: new LogController({ disableRequestLogging: true }),
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } },
    // Never trust an arbitrary forwarded IP. Configure a known proxy explicitly when deploying.
    trustProxy: false,
  });
  // Location requests and provider errors are deliberately not logged.
  await app.register(cors, { origin: config.FRONTEND_ORIGINS.split(',').map(s => s.trim()), methods: ['GET', 'POST', 'OPTIONS'] });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: '1 minute' });
  await app.register(swagger, { openapi: { info: { title: 'RouteWise API', version: '0.1.0', description: 'Student mobility planning. Demo responses are fictional. Route IDs connect cards to route objects.' },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  } });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!config.API_ACCESS_TOKEN || !request.url.startsWith('/api/') || request.method === 'OPTIONS') return;
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${config.API_ACCESS_TOKEN}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AppError(401, 'UNAUTHORIZED', 'A valid server access token is required.');
  });
  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, request, reply) => {
    let status = 500, code = 'INTERNAL_ERROR', message = 'An unexpected error occurred.';
    if (error instanceof AppError) { status = error.statusCode; code = error.code; message = error.message; }
    else if (error instanceof ProviderError) { status = error.code === 'timeout' ? 504 : 502; code = 'PROVIDER_UNAVAILABLE'; message = `${error.provider} is unavailable. Try again shortly.`; }
    else if (error instanceof z.ZodError || error.validation || error.statusCode === 400) { status = 400; code = 'INVALID_REQUEST'; message = 'Request fields are invalid. Check the API schema at /docs.'; }
    else if (error.statusCode === 429) { status = 429; code = 'RATE_LIMITED'; message = 'Too many requests. Try again in a minute.'; }
    else if (error.statusCode === 413) { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request exceeds 16 KB.'; }
    reply.status(status).send({ error: { code, message, requestId: request.id } });
  });
  const planner = new Planner(config, deps);
  const flow = new FlowPlanner(config, deps);
  const security = config.API_ACCESS_TOKEN ? [{ bearerAuth: [] }] : [];
  app.post('/api/suggest-stops', { schema: { tags: ['Frontend flow'], summary: 'Prepare trip, time-aware categories, and optional verified stops', security, body: json(finalTripRequestSchema), response: { 200: json(suggestionsSchema, 'output') } } }, async request => output(suggestionsSchema, await flow.suggest(request.body)));
  app.post('/api/plan-trip', { schema: { tags: ['Frontend flow'], summary: 'Skip or add a stop, then return Best/Fastest/Cheapest cards', security, body: json(finalTripRequestSchema), response: { 200: json(flowPlanSchema, 'output') } } }, async request => output(flowPlanSchema, await flow.plan(request.body)));
  app.get('/', async (_, reply) => reply.redirect('/docs'));
  app.get('/health', { schema: { tags: ['System'], summary: 'Service and configuration status; does not call providers' } }, async () => ({
    status: 'ok', service: 'routewise', flowVersion: 1, dataMode: config.DATA_MODE, integrations: {
      googleMaps: config.GOOGLE_MAPS_API_KEY ? 'configured_not_verified' : 'not_configured',
      gemini: config.GEMINI_API_KEY ? 'configured_not_verified' : 'not_configured',
    },
  }));
  app.get('/api/v1/config', { schema: { tags: ['Frontend'], security } }, async () => ({ dataMode: config.DATA_MODE, campusPresets, currency: 'USD', timezone: 'America/New_York', arrivalHorizonDays: 7 }));
  app.post('/api/v1/trips/plan', { schema: { tags: ['Trips'], summary: 'Plan a trip and rank available routes', security, body: json(tripRequestSchema), response: { 200: json(tripResponseSchema, 'output') } } }, async request => {
    return tripResponseSchema.parse(await planner.plan(tripRequestSchema.parse(request.body)));
  });
  app.post('/api/v1/places/nearby', { schema: { tags: ['Places'], summary: 'Find nearby places, including parking', security, body: json(nearbyRequestSchema), response: { 200: json(nearbyResponseSchema, 'output') } } }, async request => ({
    dataMode: config.DATA_MODE, places: await planner.mobility.nearby(nearbyRequestSchema.parse(request.body)),
    warnings: config.DATA_MODE === 'demo' ? [demoWarning] : ['Opening status can change. Unknown opening hours are never treated as open. Distance radius is straight-line distance, not walking distance.'],
  }));
  app.post('/api/v1/places/search', { schema: { tags: ['Places'], summary: 'Resolve typed destinations with a Miami location bias', security, body: json(searchRequestSchema), response: { 200: json(nearbyResponseSchema, 'output') } } }, async request => ({
    dataMode: config.DATA_MODE, places: await planner.mobility.search(searchRequestSchema.parse(request.body).query), warnings: config.DATA_MODE === 'demo' ? [demoWarning] : [],
  }));
  await app.ready();
  return app;
}
