import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

function backendSettings() {
  let local: Record<string, string> = {};
  try { local = parse(readFileSync(resolve(process.cwd(), 'backend/.env'))); } catch { /* Hosted deployments use environment variables. */ }
  return { url: process.env.ROUTEWISE_API_URL ?? 'http://127.0.0.1:3001', token: process.env.API_ACCESS_TOKEN ?? local.API_ACCESS_TOKEN ?? '' };
}
const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
export async function proxyRequest(request: Request, endpoint: '/api/suggest-stops' | '/api/plan-trip', fetcher: typeof fetch = fetch): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return failure(403, 'ORIGIN_NOT_ALLOWED', 'Use the app from its own origin.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return failure(415, 'JSON_REQUIRED', 'Send application/json.');
  const reader = request.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  if (reader) { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 16384) { await reader.cancel(); return failure(413, 'PAYLOAD_TOO_LARGE', 'Request exceeds 16 KB.'); } chunks.push(value); } }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return failure(400, 'INVALID_JSON', 'Send a valid JSON body.'); }
  const settings = backendSettings();
  try {
    const response = await fetcher(`${settings.url.replace(/\/$/, '')}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) },
      body: JSON.stringify(payload), cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(110000)]),
    });
    const data: unknown = await response.json();
    return Response.json(data, { status: response.status, headers: { 'Cache-Control': 'no-store', ...(response.headers.get('retry-after') ? { 'Retry-After': response.headers.get('retry-after')! } : {}) } });
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    return failure(timeout ? 504 : 503, timeout ? 'BACKEND_TIMEOUT' : 'BACKEND_UNAVAILABLE', timeout ? 'Planning took too long. Retry or skip the stop.' : 'The RouteWise backend is not running. Start the project with Start-RouteWise.cmd.');
  }
}
