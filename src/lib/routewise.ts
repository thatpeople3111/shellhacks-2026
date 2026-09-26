import type { FinalTripRequest, SuggestStopsResponse, TripPlan } from './types';
export class RouteWiseError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
async function post<T>(path: string, request: FinalTripRequest, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
  const data = await response.json();
  if (!response.ok) throw new RouteWiseError(data.error?.message ?? 'Trip request failed.', data.error?.code ?? 'REQUEST_FAILED', response.status);
  return data as T;
}
export const suggestStops = (request: FinalTripRequest, signal?: AbortSignal) => post<SuggestStopsResponse>('/api/suggest-stops', request, signal);
export const planTrip = (request: FinalTripRequest, signal?: AbortSignal) => post<TripPlan>('/api/plan-trip', request, signal);
