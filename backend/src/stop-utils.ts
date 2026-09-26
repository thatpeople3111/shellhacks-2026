import type { Coordinates, Place } from '../shared/contracts.js';
import type { StopCategory } from '../shared/flow-contracts.js';

export function decodePolyline(encoded: string): Coordinates[] {
  const points: Coordinates[] = []; let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    const read = () => { let result = 0, shift = 0, b: number; do { if (index >= encoded.length || shift > 30) throw new Error('Invalid polyline'); b = encoded.charCodeAt(index++) - 63; if (b < 0 || b > 63) throw new Error('Invalid polyline'); result |= (b & 31) << shift; shift += 5; } while (b >= 32); return result & 1 ? ~(result >> 1) : result >> 1; };
    lat += read(); lng += read(); points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}
export function encodePolyline(points: Coordinates[]): string {
  let lat = 0, lng = 0, result = '';
  const write = (delta: number) => { let value = delta < 0 ? ~(delta << 1) : delta << 1, out = ''; while (value >= 32) { out += String.fromCharCode((32 | (value & 31)) + 63); value >>>= 5; } return out + String.fromCharCode(value + 63); };
  for (const point of points) { const a = Math.round(point.latitude * 1e5), b = Math.round(point.longitude * 1e5); result += write(a - lat) + write(b - lng); lat = a; lng = b; }
  return result;
}
export function distance(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180, dlat = (b.latitude - a.latitude) * rad, dlng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function fallbackCategories(hour: number): StopCategory[] {
  if (hour < 6 || hour >= 22) return ['food', 'gas', 'pharmacy', 'coffee', 'groceries', 'dessert'];
  if (hour < 11) return ['coffee', 'food', 'gas', 'groceries', 'pharmacy', 'dessert'];
  if (hour < 17) return ['food', 'coffee', 'groceries', 'gas', 'dessert', 'pharmacy'];
  return ['food', 'dessert', 'groceries', 'coffee', 'gas', 'pharmacy'];
}
// Validate opening hours at the actual stop arrival, not merely when the search runs.
export function openForVisit(place: Place, arrival: number, visitMinutes: number, now = Date.now()): boolean | null {
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') return false;
  const periods = place.openingPeriods;
  if (periods?.some(p => !p.close && !p.open.date && (p.open.day ?? 0) === 0 && (p.open.hour ?? 0) === 0 && (p.open.minute ?? 0) === 0)) return true;
  if (!periods || place.utcOffsetMinutes === undefined) return arrival <= now + 60000 && visitMinutes === 0 ? place.openNow : null;
  const end = arrival + visitMinutes * 60000;
  const timestamp = (p: NonNullable<Place['openingPeriods']>[number]['open']) => p.date
    ? Date.UTC(p.date.year, p.date.month - 1, p.date.day, p.hour ?? 0, p.minute ?? 0) - place.utcOffsetMinutes! * 60000 : null;
  let hasDatedPeriod = false;
  for (const period of periods) {
    const from = timestamp(period.open), to = period.close ? timestamp(period.close) : null;
    if (from !== null && to !== null) { hasDatedPeriod = true; if (arrival >= from && end <= to && arrival < to) return true; }
  }
  // Avoid guessing future hours outside Google's current seven-day window.
  return hasDatedPeriod && arrival < now + 6 * 86400000 ? false : null;
}
export async function mapLimited<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) { const i = index++; try { results[i] = { status: 'fulfilled', value: await mapper(values[i]) }; } catch (reason) { results[i] = { status: 'rejected', reason }; } }
  }));
  return results;
}
