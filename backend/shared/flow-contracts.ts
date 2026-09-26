import { z } from 'zod';
import { coordinatesSchema, routeSchema } from './contracts.js';

export const stopCategorySchema = z.enum(['food', 'coffee', 'gas', 'groceries', 'dessert', 'pharmacy']);
export const stopPreferencesSchema = z.object({
  category: stopCategorySchema.optional(), timing: z.enum(['ON_ROUTE', 'DESTINATION']).default('ON_ROUTE'),
  maxExtraMinutes: z.number().min(0).max(180).optional(),
  maxExtraBudget: z.number().min(0).max(1000).optional(),
  visitMinutes: z.number().int().min(0).max(120).default(5),
  skip: z.boolean().default(false),
}).strict();
export const suggestedStopSchema = z.object({
  id: z.string(), name: z.string(), category: stopCategorySchema, address: z.string(),
  estimatedExtraMinutes: z.number().nonnegative(), estimatedCost: z.number().nonnegative().optional(),
  rating: z.number().optional(), timing: z.enum(['ON_ROUTE', 'DESTINATION']),
  location: coordinatesSchema.optional(), mapsUrl: z.string().nullable().optional(),
  visitMinutes: z.number().nonnegative().optional(), arrivalTime: z.string().optional(),
  priceRange: z.object({ low: z.number(), high: z.number(), currency: z.string() }).optional(),
  budgetStatus: z.enum(['not_requested', 'estimated_within_limit']).optional(),
  warnings: z.array(z.string()).optional(), routeMode: z.string().optional(),
  attributions: z.array(z.object({ provider: z.string(), providerUri: z.string().nullable() })).optional(),
});
export const flowTripRequestSchema = z.object({
  origin: z.string().trim().min(2).max(300), destination: z.string().trim().min(2).max(300),
  departureTime: z.iso.datetime({ offset: true }).optional(), arrivalTime: z.iso.datetime({ offset: true }).optional(),
  budget: z.number().min(0).max(1000).optional(), maxWalkingMinutes: z.number().int().min(0).max(180).optional(),
  hasCar: z.boolean().default(false), allowTransit: z.boolean().default(true), allowWalking: z.boolean().default(true),
  hasBike: z.boolean().default(false), avoidTolls: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional(),
  preference: z.enum(['balanced', 'cheapest', 'fastest', 'least_walking']).default('balanced'),
  timeZone: z.string().max(100).default('America/New_York'),
}).strict();
export const finalTripRequestSchema = flowTripRequestSchema.extend({
  stopPreferences: stopPreferencesSchema.optional(),
  // A selected stop is only an identifier hint. All details are fetched and recalculated server-side.
  selectedStop: suggestedStopSchema.partial().extend({ id: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).strict().optional(),
});
export const flowRouteSchema = z.object({
  id: z.string(), label: z.enum(['BEST', 'FASTEST', 'CHEAPEST']), title: z.string(), transportMode: z.string(),
  durationMinutes: z.number().nonnegative(), estimatedCost: z.number().nonnegative().nullable(), walkingMinutes: z.number().nonnegative().nullable(),
  extraStopMinutes: z.number().nonnegative().optional(), summary: z.string(), reason: z.string(), steps: z.array(z.string()),
  origin: z.string(), destination: z.string(), stop: suggestedStopSchema.optional(),
  encodedPolyline: z.string().nullable(), mapsUrl: z.string(), navigationLinks: z.array(z.string()),
  departureTime: z.string().nullable(), arrivalTime: z.string().nullable(),
  constraints: routeSchema.shape.constraints, cost: routeSchema.shape.cost,
  warnings: z.array(z.string()),
  transitAgencies: z.array(z.object({ name: z.string(), url: z.string().nullable() })),
});
export const flowPlanSchema = z.object({
  recommendedRouteId: z.string().nullable(), routes: z.array(flowRouteSchema),
  dataMode: z.enum(['demo', 'live']), status: z.enum(['ok', 'no_matching_routes', 'no_matching_stops']),
  warnings: z.array(z.string()), rankingSource: z.enum(['rules', 'gemini']),
  attribution: z.string(), requestId: z.string(), generatedAt: z.string(),
});
export const suggestionsSchema = z.object({
  categories: z.array(stopCategorySchema), stops: z.array(suggestedStopSchema),
  dataMode: z.enum(['demo', 'live']), status: z.enum(['choose_category', 'ok', 'no_matching_routes', 'no_matching_stops']),
  warnings: z.array(z.string()), categorySource: z.enum(['rules', 'gemini']), rankingSource: z.enum(['rules', 'gemini']),
  basePlan: flowPlanSchema, requestId: z.string(),
});
export type TripRequest = z.input<typeof flowTripRequestSchema>;
export type FinalTripRequest = z.input<typeof finalTripRequestSchema>;
export type FlowInput = z.output<typeof finalTripRequestSchema>;
export type StopCategory = z.infer<typeof stopCategorySchema>;
export type StopPreferences = z.input<typeof stopPreferencesSchema>;
export type StopInput = z.output<typeof stopPreferencesSchema>;
export type SuggestedStop = z.infer<typeof suggestedStopSchema>;
export type RouteOption = z.infer<typeof flowRouteSchema>;
export type TripPlan = z.infer<typeof flowPlanSchema>;
export type SuggestStopsResponse = z.infer<typeof suggestionsSchema>;
