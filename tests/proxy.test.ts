import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyRequest } from '../src/lib/server/routewise-proxy.ts';

function request(body = '{}', headers: Record<string, string> = {}) { return new Request('http://localhost:3000/api/plan-trip', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }); }
test('proxy forwards JSON and server credentials, preserving upstream status', async () => {
  const previous = process.env.API_ACCESS_TOKEN; process.env.API_ACCESS_TOKEN = 'test-server-token';
  try {
    const fake: typeof fetch = async (url, options) => {
      assert.ok(String(url).endsWith('/api/plan-trip'));
      assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-server-token');
      assert.deepEqual(JSON.parse(String(options?.body)), { origin: 'FIU' });
      return Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429, headers: { 'Retry-After': '10' } });
    };
    const response = await proxyRequest(request('{"origin":"FIU"}'), '/api/plan-trip', fake);
    assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '10'); assert.ok(!(await response.text()).includes('test-server-token'));
  } finally { if (previous === undefined) delete process.env.API_ACCESS_TOKEN; else process.env.API_ACCESS_TOKEN = previous; }
});
test('proxy rejects foreign origins, malformed JSON and oversized payloads before forwarding', async () => {
  const noFetch: typeof fetch = async () => { throw new Error('Should not forward'); };
  assert.equal((await proxyRequest(request('{}', { origin: 'https://example.org' }), '/api/plan-trip', noFetch)).status, 403);
  assert.equal((await proxyRequest(request('oops'), '/api/plan-trip', noFetch)).status, 400);
  assert.equal((await proxyRequest(request(JSON.stringify('x'.repeat(17000))), '/api/plan-trip', noFetch)).status, 413);
  assert.equal((await proxyRequest(request('{}', { 'Content-Type': 'text/plain' }), '/api/plan-trip', noFetch)).status, 415);
});
test('proxy returns actionable errors without leaking upstream exception details', async () => {
  const response = await proxyRequest(request(), '/api/suggest-stops', async () => { throw new Error('private-key-or-address'); });
  assert.equal(response.status, 503); const body = await response.text(); assert.ok(body.includes('Start-RouteWise.cmd')); assert.ok(!body.includes('private-key'));
});
