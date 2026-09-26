import { proxyRequest } from '../../../lib/server/routewise-proxy';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) { return proxyRequest(request, '/api/plan-trip'); }
