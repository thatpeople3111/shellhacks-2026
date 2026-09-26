import { z } from 'zod';

const envSchema = z.object({
  DATA_MODE: z.enum(['demo', 'live']).default('demo'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  FRONTEND_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  GOOGLE_MAPS_API_KEY: z.string().default(''), GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).default('gemini-3.8-flash'),
  GEMINI_FALLBACK_MODEL: z.string().regex(/^[a-zA-Z0-9._-]*$/).default('gemini-2.5-flash'),
  ENABLE_MAPS_GROUNDING: z.enum(['true', 'false']).default('false'),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(12000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(30),
  API_ACCESS_TOKEN: z.string().default(''), NODE_ENV: z.string().default('development'),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error('Invalid configuration fields: ' + result.error.issues.map(i => i.path.join('.')).join(', '));
  const c = result.data;
  if (c.DATA_MODE === 'live' && !c.GOOGLE_MAPS_API_KEY) throw new Error('Live mode requires GOOGLE_MAPS_API_KEY.');
  if (c.DATA_MODE === 'live' && c.NODE_ENV === 'production' && c.API_ACCESS_TOKEN.length < 32)
    throw new Error('Production live mode requires API_ACCESS_TOKEN of at least 32 characters.');
  return c;
}
