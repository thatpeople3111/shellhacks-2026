import { z } from 'zod';

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();
export const locationSchema = z.union([
  z.object({ address: z.string().trim().min(2).max(300) }).strict(),
  z.object({ placeId: z.string().trim().min(3).max(300) }).strict(),
  coordinatesSchema,
]);
export const modeSchema = z.enum(['TRANSIT', 'DRIVE', 'WALK', 'BICYCLE']);
export const categorySchema = z.enum(['food', 'coffee', 'parking', 'gas', 'ev_charging', 'pharmacy', 'groceries', 'dessert']);
export const tripRequestSchema = z.object({
  origin: locationSchema,
  destination: locationSchema,
  arrivalTime: z.iso.datetime({ offset: true }).optional(),
  departureTime: z.iso.datetime({ offset: true }).optional(),
  allowTransit: z.boolean().default(true),
  allowWalking: z.boolean().default(true),
  notes: z.string().trim().max(1000).default(''),
  hasCar: z.boolean().default(false),
  hasBike: z.boolean().default(false),
  budgetUsd: z.number().min(0).max(1000).default(15),
  maxWalkingMinutes: z.number().int().min(0).max(180).default(10),
  avoidTolls: z.boolean().default(false),
  preference: z.enum(['balanced', 'cheapest', 'fastest', 'least_walking']).default('balanced'),
  nearbyCategories: z.array(categorySchema).max(3).default([]),
}).strict();
export const nearbyRequestSchema = z.object({
  location: coordinatesSchema,
  category: categorySchema,
  radiusMeters: z.number().int().min(100).max(5000).default(800),
  openNow: z.boolean().default(false),
}).strict();
export const searchRequestSchema = z.object({ query: z.string().trim().min(2).max(200) }).strict();
export const stepSchema = z.object({
  mode: modeSchema,
  instruction: z.string(),
  durationMinutes: z.number().nonnegative(),
  distanceMeters: z.number().nonnegative(),
  transit: z.object({
    line: z.string(), headsign: z.string().nullable(),
    departureStop: z.string().nullable(), arrivalStop: z.string().nullable(),
    departureTime: z.string().nullable(), arrivalTime: z.string().nullable(),
    agencies: z.array(z.object({ name: z.string(), url: z.string().nullable() })),
  }).nullable(),
});
export const routeSchema = z.object({
  id: z.string(), mode: modeSchema, label: z.string(),
  durationMinutes: z.number().nonnegative(), distanceMeters: z.number().nonnegative(),
  walkingMinutes: z.number().nonnegative().nullable(),
  cost: z.object({
    amount: z.number().nonnegative().nullable(), currency: z.string(),
    kind: z.enum(['provider_fare', 'no_fare', 'unknown', 'demo']),
    complete: z.boolean(), note: z.string(),
  }),
  steps: z.array(stepSchema), encodedPolyline: z.string().nullable(),
  destination: coordinatesSchema.nullable(), mapsUrl: z.string(),
  departureTime: z.string().nullable(), arrivalTime: z.string().nullable(),
  timing: z.enum(['scheduled', 'estimated_now', 'demo']),
  constraints: z.object({
    budget: z.enum(['met', 'exceeded', 'unknown']),
    walking: z.enum(['met', 'exceeded', 'unknown']),
    arrival: z.enum(['met', 'missed', 'unknown', 'not_requested']),
    eligible: z.boolean(),
  }),
  warnings: z.array(z.string()),
});
export const placeSchema = z.object({
  id: z.string(), name: z.string(), address: z.string(),
  location: coordinatesSchema.nullable(), mapsUrl: z.string().nullable(),
  openNow: z.boolean().nullable(), priceLevel: z.string().nullable(),
  rating: z.number().optional(),
  types: z.array(z.string()).optional(),
  businessStatus: z.string().optional(),
  utcOffsetMinutes: z.number().optional(),
  priceRange: z.object({ low: z.number().nonnegative(), high: z.number().nonnegative(), currency: z.string() }).optional(),
  openingPeriods: z.array(z.object({
    open: z.object({ day: z.number().optional(), hour: z.number().optional(), minute: z.number().optional(), date: z.object({ year: z.number(), month: z.number(), day: z.number() }).optional() }),
    close: z.object({ day: z.number().optional(), hour: z.number().optional(), minute: z.number().optional(), date: z.object({ year: z.number(), month: z.number(), day: z.number() }).optional() }).optional(),
  })).optional(),
  attributions: z.array(z.object({ provider: z.string(), providerUri: z.string().nullable() })),
});
export const nearbyResponseSchema = z.object({
  dataMode: z.enum(['demo', 'live']), places: z.array(placeSchema), warnings: z.array(z.string()),
});
export const tripResponseSchema = z.object({
  id: z.string(), generatedAt: z.string(), dataMode: z.enum(['demo', 'live']),
  routes: z.array(routeSchema),
  best: z.string().nullable(), cheapest: z.string().nullable(), fastest: z.string().nullable(),
  recommendation: z.object({ source: z.enum(['rules', 'gemini']), reason: z.string() }),
  nearby: z.array(z.object({ category: categorySchema, places: z.array(placeSchema) })),
  groundedGuidance: z.object({ text: z.string(), groundingMetadata: z.object({}).catchall(z.unknown()) }).nullable(),
  warnings: z.array(z.string()),
  attribution: z.string(),
});
export type TripRequest = z.input<typeof tripRequestSchema>;
export type TripInput = z.output<typeof tripRequestSchema>;
export type NearbyRequest = z.input<typeof nearbyRequestSchema>;
export type NearbyInput = z.output<typeof nearbyRequestSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Coordinates = z.infer<typeof coordinatesSchema>;
export type Mode = z.infer<typeof modeSchema>;
export type Route = z.infer<typeof routeSchema>;
export type Place = z.infer<typeof placeSchema>;
export type TripResponse = z.infer<typeof tripResponseSchema>;
export type NearbyResponse = z.infer<typeof nearbyResponseSchema>;
