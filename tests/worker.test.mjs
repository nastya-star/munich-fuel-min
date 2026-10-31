// Normalisation and the shared request gate (cache, 1-per-minute limit, deduplication).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceToMilli, normalizeStations, classifyUpstreamError } from '../worker/src/normalize.js';
import { Gate, MIN_INTERVAL_MS, CACHE_TTL_MS } from '../worker/src/gate.js';

test('priceToMilli keeps valid prices as integer thousandths', () => {
  assert.equal(priceToMilli(1.789), 1789);
  assert.equal(priceToMilli(1.7889999999), 1789);
  assert.equal(priceToMilli(2), 2000);
});

test('priceToMilli rejects missing, false, zero and invalid prices', () => {
  for (const v of [false, null, undefined, 0, -1.5, NaN, Infinity, '1.789', 0.2, 9.99]) assert.equal(priceToMilli(v), null, String(v));
});

test('normalizeStations drops bad rows and duplicate ids', () => {
  const raw = [
    { id: 'a', name: ' ARAL ', brand: 'ARAL', street: 'Hauptstr.', houseNumber: '1', postCode: 8331, place: 'München', lat: 48.1, lng: 11.5, dist: 1.2, isOpen: true, e5: 1.859, e10: false, diesel: 0 },
    { id: 'a', name: 'dup', lat: 48, lng: 11 },
    { id: 'b', name: 'no coords', lat: 'x', lng: 11 },
    { name: 'no id', lat: 48, lng: 11 },
    null,
  ];
  const out = normalizeStations(raw);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].prices, { e5: 1859, e10: null, diesel: null });
  assert.equal(out[0].postCode, '08331');
  assert.equal(out[0].name, 'ARAL');
  assert.equal(normalizeStations(undefined).length, 0);
});

test('classifyUpstreamError', () => {
  assert.equal(classifyUpstreamError(200, 'Key existiert nicht oder ist deaktiviert'), 'upstream_key_rejected');
  assert.equal(classifyUpstreamError(429, ''), 'upstream_rate_limited');
  assert.equal(classifyUpstreamError(200, 'parameter error'), 'upstream_error');
});

function setup({ fail = false, delayMs = 0 } = {}) {
  const store = new Map();
  const storage = { get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v) };
  let t = 1_000_000;
  let calls = 0;
  const fetchUpstream = async () => {
    calls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return fail ? { error: 'upstream_key_rejected', message: 'Key existiert nicht' } : { stations: [{ id: `s${calls}` }] };
  };
  const gate = new Gate({ storage, fetchUpstream, now: () => t, area: { radiusKm: 17 } });
  return { gate, store, advance: (ms) => (t += ms), calls: () => calls };
}

test('first request is live, a repeat within the cache lifetime is served from cache', async () => {
  const g = setup();
  const a = await g.gate.get();
  assert.equal(a.body.source, 'live');
  g.advance(30_000);
  const b = await g.gate.get();
  assert.equal(b.body.source, 'cache');
  assert.equal(b.body.stale, false);
  assert.equal(b.body.ageSeconds, 30);
  assert.equal(g.calls(), 1);
});

test('after the cache lifetime a new upstream request is made', async () => {
  const g = setup();
  await g.gate.get();
  g.advance(CACHE_TTL_MS);
  const r = await g.gate.get();
  assert.equal(r.body.source, 'live');
  assert.equal(r.body.stations[0].id, 's2');
  assert.equal(g.calls(), 2);
});

test('50 concurrent visitors cause exactly one upstream request', async () => {
  const g = setup({ delayMs: 20 });
  const results = await Promise.all(Array.from({ length: 50 }, () => g.gate.get()));
  assert.equal(g.calls(), 1);
  assert.ok(results.every((r) => r.status === 200 && r.body.stations[0].id === 's1'));
});

test('failed request still counts toward the 1-per-minute limit', async () => {
  const g = setup({ fail: true });
  const a = await g.gate.get();
  assert.equal(a.status, 502);
  assert.equal(a.body.error, 'upstream_key_rejected');
  g.advance(10_000);
  const b = await g.gate.get();
  assert.equal(b.status, 429);
  assert.equal(b.body.retryAfterSeconds, 50);
  assert.equal(g.calls(), 1);
  g.advance(MIN_INTERVAL_MS);
  await g.gate.get();
  assert.equal(g.calls(), 2);
});

test('limit survives a restart because it is read from storage', async () => {
  const g = setup({ fail: true });
  await g.gate.get();
  const restarted = new Gate({ storage: { get: async (k) => g.store.get(k), put: async () => {} }, fetchUpstream: async () => assert.fail('must not call upstream'), now: () => 1_000_000 + 5_000, area: {} });
  assert.equal((await restarted.get()).status, 429);
});

test('stale cache is labelled when a refresh fails', async () => {
  const store = new Map();
  const storage = { get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v) };
  let t = 0;
  let ok = true;
  const gate = new Gate({ storage, now: () => t, area: {}, fetchUpstream: async () => (ok ? { stations: [{ id: 'old' }] } : { error: 'upstream_unreachable' }) });
  await gate.get();
  ok = false;
  t += 5 * 60_000;
  const r = await gate.get();
  assert.equal(r.status, 200);
  assert.equal(r.body.stale, true);
  assert.equal(r.body.source, 'cache');
  assert.equal(r.body.error, 'upstream_unreachable');
  assert.equal(r.body.ageSeconds, 300);
});

test('empty station list is a valid result, not an error', async () => {
  const gate = new Gate({ storage: { get: async () => undefined, put: async () => {} }, now: () => 0, area: {}, fetchUpstream: async () => ({ stations: [] }) });
  const r = await gate.get();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.stations, []);
});
