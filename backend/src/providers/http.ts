export class ProviderError extends Error {
  constructor(public provider: string, public code: 'unavailable' | 'timeout' | 'invalid_response', public upstreamStatus?: number) {
    super(`${provider}: ${code}`);
  }
}
export type Fetch = typeof fetch;
export async function getJson(provider: string, url: string, key: string, timeout: number, fetcher: Fetch = fetch, fieldMask?: string): Promise<unknown> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeout), headers: { 'X-Goog-Api-Key': key, ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) } });
    if (!response.ok) throw new ProviderError(provider, 'unavailable', response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(provider, error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'invalid_response');
  }
}
export async function postJson(provider: string, url: string, key: string, body: unknown, timeout: number, fetcher: Fetch = fetch, fieldMask?: string): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      method: 'POST', signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new ProviderError(provider, 'unavailable', response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new ProviderError(provider, 'timeout');
    throw new ProviderError(provider, 'invalid_response');
  }
}
