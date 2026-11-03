// Focused tests for the hardening work: abuse controls, the 25 km snapping edge case,
// per-observation provenance, and suppression of upstream diagnostic messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gate, CLIENT_UPSTREAM_MAX, CLIENT_UPSTREAM_WINDOW_MS, MIN_INTERVAL_MS } from '../worker/src/gate.js';
import { parseArea, snapArea, MAX_RADIUS_KM } from '../worker/src/query.js';
import { handleRequest, clientKey } from '../worker/src/handler.js';
import { haversineKm, covers } from '../worker/src/geo.js';
import { serverArea, responseCovers } from '../docs/core.js';

// ---- helpers ---------------------------------------------------------------------------------------

const STATIONS = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, lat: 48.1374, lng: 11.40 + i * 0.01, isOpen: true, prices: { e5: 1900 + i, e10: null, diesel: 2000 } }));

function gateSetup({ result } = {}) {
  const store = new Map();
  const storage = { get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v), delete: async (k) => store.delete(k) };
  let t = 50_000_000;
  const calls = [];
  const fetchUpstream = async (area) => {
    calls.push(area);
    return result ?? { stations: STATIONS.filter((s) => haversineKm(area, s) <= area.rad) };
  };
  const gate = new Gate({ storage, fetchUpstream, now: () => t });
  return { gate, calls, advance: (ms) => (t += ms) };
}
const area = (lng, rad = 2) => ({ lat: 48.14, lng, rad });

// ---- (1) abuse controls: strict per-client budget for upstream-triggering requests ------------------

test('one client cannot exhaust the shared upstream budget: per-client cap on fresh requests', async () => {
  const g = gateSetup();
  for (let i = 0; i < CLIENT_UPSTREAM_MAX; i++) {
    const r = await g.gate.get(area(11.40 + i * 0.05), { client: 'attacker' });
    assert.equal(r.body.source, 'live', `request ${i + 1} within budget`);
    g.advance(MIN_INTERVAL_MS);
  }
  assert.equal(g.calls.length, CLIENT_UPSTREAM_MAX);
  // Budget used up: a further uncovered area must not reach Tankerkönig, although the global gate is free.
  const blocked = await g.gate.get(area(11.90), { client: 'attacker' });
  assert.equal(g.calls.length, CLIENT_UPSTREAM_MAX, 'no upstream call beyond the client budget');
  assert.notEqual(blocked.body.source, 'live');
  assert.equal(blocked.body.error === 'client_rate_limited' || blocked.body.error === 'rate_limited', true);
  assert.ok(blocked.body.retryAfterSeconds > 0);
  // Another client is still served fresh data.
  const other = await g.gate.get(area(11.95), { client: 'someone-else' });
  assert.equal(other.body.source, 'live');
  // After the window, the first client may fetch again.
  g.advance(CLIENT_UPSTREAM_WINDOW_MS);
  assert.equal((await g.gate.get(area(12.0), { client: 'attacker' })).body.source, 'live');
});

test('cache hits never count against the client budget', async () => {
  const g = gateSetup();
  await g.gate.get(area(11.5, 10), { client: 'c' });
  for (let i = 0; i < 20; i++) assert.equal((await g.gate.get(area(11.5, 3), { client: 'c' })).body.source, 'cache');
  assert.equal(g.calls.length, 1);
});

// ---- (1) abuse controls at the HTTP layer ----------------------------------------------------------------

function env({ limiterSuccess = true } = {}) {
  const seen = { gate: [], limiter: [] };
  return {
    seen,
    env: {
      TANKERKOENIG_API_KEY: 'test-key-123',
      ALLOWED_ORIGINS: 'https://nastya-star.github.io',
      RATE_LIMITER: { limit: async ({ key }) => (seen.limiter.push(key), { success: limiterSuccess }) },
      PRICE_GATE: {
        idFromName: (n) => n,
        get: () => ({ getPrices: async (a, opts) => (seen.gate.push({ a, opts }), { status: 200, body: { ok: true, source: 'cache', coverage: 'full', stale: false, query: a, stations: [] } }) }),
      },
    },
  };
}
const req = (path = '/api/prices', headers = {}) => new Request(`https://w.example${path}`, { headers });

test('HTTP: per-client rate limit is checked before the Durable Object; 429 with Retry-After', async () => {
  const { env: e, seen } = env({ limiterSuccess: false });
  const res = await handleRequest(req('/api/prices', { 'CF-Connecting-IP': '203.0.113.7' }), e);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  assert.deepEqual(await res.json(), { ok: false, error: 'too_many_requests', retryAfterSeconds: 60 });
  assert.equal(seen.gate.length, 0, 'blocked before reaching the gate');
  assert.equal(seen.limiter.length, 1);
  assert.ok(!seen.limiter[0].includes('203.0.113.7'), 'limiter key is a hash, not the raw IP');
});

test('HTTP: the client key is passed to the gate (hashed), never the IP', async () => {
  const { env: e, seen } = env();
  await handleRequest(req('/api/prices', { 'CF-Connecting-IP': '203.0.113.7' }), e);
  const k = seen.gate[0].opts.client;
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.equal(k, await clientKey('203.0.113.7'));
  assert.notEqual(await clientKey('203.0.113.8'), k);
});

test('HTTP: works without a rate-limit binding (binding is optional)', async () => {
  const { env: e } = env();
  delete e.RATE_LIMITER;
  assert.equal((await handleRequest(req(), e)).status, 200);
});

test('HTTP: Origin is not treated as authentication - foreign browsers refused, CORS only for allowed origin', async () => {
  const { env: e } = env();
  assert.equal((await handleRequest(req('/api/prices', { Origin: 'https://evil.example' }), e)).status, 403);
  const ok = await handleRequest(req('/api/prices', { Origin: 'https://nastya-star.github.io' }), e);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://nastya-star.github.io');
  const noOrigin = await handleRequest(req('/api/prices'), e);
  assert.equal(noOrigin.headers.get('Access-Control-Allow-Origin'), null);
  // Non-browser clients without Origin are still subject to the per-client limits (above), not trusted.
});

test('HTTP: unexpected query parameters and oversized URLs are rejected', async () => {
  const { env: e } = env();
  assert.equal((await handleRequest(req('/api/prices?lat=48.1&lng=11.5&rad=5&type=diesel'), e)).status, 400);
  assert.equal((await handleRequest(req('/api/prices?lat=' + '1'.repeat(300) + '&lng=11&rad=5'), e)).status, 400);
});

// ---- (2) 25 km snapping edge case ---------------------------------------------------------------

test('25 km at an off-grid point: the server reports the radius it actually covers', () => {
  const lat = 48.1374, lng = 11.5755; // ~0.44 km from the 0.01° grid point
  const a = snapArea(lat, lng, MAX_RADIUS_KM);
  assert.equal(a.rad, MAX_RADIUS_KM, 'API maximum respected');
  assert.equal(covers(a, { lat, lng, rad: MAX_RADIUS_KM }), false, 'the snapped 25 km circle cannot contain the requested one');
  const r = parseArea(new URLSearchParams({ lat: String(lat), lng: String(lng), rad: '25' }));
  assert.equal(r.ok, true);
  assert.equal(r.request.radiusKm, 25);
  assert.ok(r.request.coveredRadiusKm < 25 && r.request.coveredRadiusKm >= 24.5);
  assert.equal(r.request.complete, false);
  assert.ok(covers(r.area, { lat, lng, rad: r.request.coveredRadiusKm }), 'covered radius really is covered');
});

test('below the cap the request is fully covered', () => {
  const r = parseArea(new URLSearchParams({ lat: '48.1374', lng: '11.5755', rad: '17' }));
  assert.equal(r.request.complete, true);
  assert.equal(r.request.coveredRadiusKm, 17);
});

test('client never claims full coverage for a capped 25 km request', () => {
  const origin = { lat: 48.1374, lng: 11.5755 };
  const q = serverArea(origin, 25);
  assert.equal(q.rad, 25);
  assert.equal(responseCovers({ coverage: 'full', query: q }, origin, 25), false);
});

test('HTTP: request coverage is echoed in the response', async () => {
  const { env: e } = env();
  const res = await handleRequest(req('/api/prices?lat=48.1374&lng=11.5755&rad=25'), e);
  const body = await res.json();
  assert.equal(body.request.complete, false);
  assert.ok(body.request.coveredRadiusKm < 25);
});

// ---- (3) per-observation provenance -------------------------------------------------------------

test('partial results from overlapping caches carry per-station observation times and their sources', async () => {
  const g = gateSetup();
  await g.gate.get({ lat: 48.14, lng: 11.45, rad: 3 }, { client: 'a' }); // snapshot A at t0
  const tA = new Date(50_000_000).toISOString();
  g.advance(MIN_INTERVAL_MS + 5_000);
  await g.gate.get({ lat: 48.14, lng: 11.55, rad: 3 }, { client: 'b' }); // snapshot B at t0+65 s
  const tB = new Date(50_000_000 + MIN_INTERVAL_MS + 5_000).toISOString();
  g.advance(10_000);
  const r = await g.gate.get({ lat: 48.14, lng: 11.50, rad: 5 }, { client: 'c' }); // overlaps both, inside neither
  assert.equal(r.body.coverage, 'partial');
  const times = new Set(r.body.stations.map((s) => s.observedAt));
  assert.deepEqual([...times].sort(), [tA, tB].sort(), 'each station says when it was observed');
  assert.deepEqual(r.body.observations.map((o) => o.fetchedAt).sort(), [tA, tB].sort());
  for (const o of r.body.observations) assert.deepEqual(Object.keys(o).sort(), ['area', 'fetchedAt', 'stations']);
  assert.equal(r.body.fetchedAt, tA, 'overall time is the oldest observation (conservative)');
  for (const s of r.body.stations) {
    const src = r.body.observations.find((o) => o.fetchedAt === s.observedAt);
    assert.ok(haversineKm(src.area, s) <= src.area.rad + 0.05, 'station lies inside the search it is attributed to');
  }
});

test('full results also carry observedAt equal to fetchedAt', async () => {
  const g = gateSetup();
  const r = await g.gate.get({ lat: 48.14, lng: 11.5, rad: 5 }, { client: 'x' });
  assert.ok(r.body.stations.length > 0);
  assert.ok(r.body.stations.every((s) => s.observedAt === r.body.fetchedAt));
  assert.equal(r.body.observations.length, 1);
});

// ---- (4) upstream diagnostic messages are not exposed -----------------------------------------------

test('raw upstream messages never reach clients, only error codes', async () => {
  const leak = 'Key 3f2a… existiert nicht – internal detail';
  const g = gateSetup({ result: { error: 'upstream_key_rejected', message: leak } });
  const r = await g.gate.get(area(11.5), { client: 'x' });
  assert.equal(r.body.error, 'upstream_key_rejected');
  assert.equal(JSON.stringify(r.body).includes('existiert'), false);
  assert.equal('upstreamMessage' in r.body, false);
});

test('unknown upstream error codes are mapped to a generic code', async () => {
  const g = gateSetup({ result: { error: 'something <script>', message: 'x' } });
  const r = await g.gate.get(area(11.5), { client: 'x' });
  assert.equal(r.body.error, 'upstream_error');
});

test('when the global 1/min gate already blocks, the response reports the global limit, not the client budget', async () => {
  const g = gateSetup();
  for (let i = 0; i < CLIENT_UPSTREAM_MAX; i++) {
    await g.gate.get(area(11.40 + i * 0.05), { client: 'c' });
    if (i < CLIENT_UPSTREAM_MAX - 1) g.advance(MIN_INTERVAL_MS);
  }
  const r = await g.gate.get(area(11.90), { client: 'c' }); // global gate still closed (< 60 s)
  assert.equal(r.body.error, 'rate_limited');
});
