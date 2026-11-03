// Worker logic: normalisation, area validation, and the shared request gate
// (area-aware cache, one upstream request per minute across all areas, deduplication).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceToMilli, normalizeStations, classifyUpstreamError } from '../worker/src/normalize.js';
import { Gate, MIN_INTERVAL_MS, CACHE_TTL_MS, STALE_MAX_MS, MAX_SNAPSHOTS } from '../worker/src/gate.js';
import { parseArea, snapArea, DEFAULT_AREA } from '../worker/src/query.js';
import { haversineKm, covers } from '../worker/src/geo.js';

// ---- normalisation ----------------------------------------------------------------------------

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
  assert.equal(classifyUpstreamError(200, 'apikey nicht angegeben, falsch, oder im falschen Format'), 'upstream_key_rejected');
  assert.equal(classifyUpstreamError(429, ''), 'upstream_rate_limited');
  assert.equal(classifyUpstreamError(200, 'parameter error'), 'upstream_error');
});

// ---- area validation ----------------------------------------------------------------------------

const sp = (o) => new URLSearchParams(o);

test('no parameters -> default area snapped like the page does (shared cache entry)', () => {
  const r = parseArea(sp({}));
  assert.deepEqual(r.area, { lat: 48.14, lng: 11.58, rad: 17.5 });
  assert.deepEqual(r.request, { radiusKm: 17, coveredRadiusKm: 17, complete: true });
  assert.deepEqual(r, parseArea(sp({ lat: '48.1374', lng: '11.5755', rad: '17' })));
  assert.ok(covers(r.area, DEFAULT_AREA), 'still contains Marienplatz + 17 km');
});

test('coordinates are snapped to 0.01 deg and the radius enlarged so the request stays covered', () => {
  const r = parseArea(sp({ lat: '48.161234', lng: '11.586789', rad: '5' }));
  assert.equal(r.ok, true);
  assert.deepEqual([r.area.lat, r.area.lng], [48.16, 11.59]);
  assert.ok(r.area.rad >= 5 && r.area.rad <= 6);
  assert.ok(covers(r.area, { lat: 48.161234, lng: 11.586789, rad: 5 }), 'snapped circle contains the requested one');
  assert.equal(r.area.rad * 2, Math.round(r.area.rad * 2), 'radius in 0.5 km steps');
});

test('snapping is idempotent for already-snapped input', () => {
  const a = snapArea(48.14, 11.58, 17.5);
  assert.deepEqual(a, { lat: 48.14, lng: 11.58, rad: 17.5 });
});

test('invalid areas are rejected; radius capped at the API maximum', () => {
  assert.deepEqual(parseArea(sp({ lat: 'x', lng: '11', rad: '5' })), { ok: false, error: 'invalid_area' });
  assert.deepEqual(parseArea(sp({ lat: '48.1', rad: '5' })), { ok: false, error: 'invalid_area' });
  assert.deepEqual(parseArea(sp({ lat: '40.0', lng: '11.5', rad: '5' })), { ok: false, error: 'outside_coverage' });
  assert.deepEqual(parseArea(sp({ lat: '48.1', lng: '11.5', rad: '26' })), { ok: false, error: 'invalid_radius' });
  assert.deepEqual(parseArea(sp({ lat: '48.1', lng: '11.5', rad: '0.5' })), { ok: false, error: 'invalid_radius' });
  assert.equal(parseArea(sp({ lat: '48.1234', lng: '11.5678', rad: '25' })).area.rad, 25);
});

// ---- gate -----------------------------------------------------------------------------------------

// Stations on a line east of Marienplatz, ~0.75 km apart.
const STATIONS = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, lat: 48.1374, lng: 11.5755 + i * 0.01, isOpen: true, prices: { e5: 1900 + i, e10: null, diesel: 2000 } }));

function setup({ fail = false, delayMs = 0 } = {}) {
  const store = new Map();
  const storage = { get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v), delete: async (k) => store.delete(k) };
  let t = 10_000_000;
  const calls = [];
  const fetchUpstream = async (area) => {
    calls.push(area);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (fail) return { error: 'upstream_key_rejected', message: 'Key *** existiert nicht' };
    return { stations: STATIONS.filter((s) => haversineKm(area, s) <= area.rad) };
  };
  const gate = new Gate({ storage, fetchUpstream, now: () => t });
  return { gate, store, storage, calls, advance: (ms) => (t += ms) };
}

const MUC = { lat: 48.14, lng: 11.58, rad: 17.5 };

test('first request is live; a repeat within a minute is served from cache', async () => {
  const g = setup();
  const a = await g.gate.get(MUC);
  assert.equal(a.body.source, 'live');
  assert.equal(a.body.coverage, 'full');
  g.advance(30_000);
  const b = await g.gate.get(MUC);
  assert.equal(b.body.source, 'cache');
  assert.equal(b.body.stale, false);
  assert.equal(b.body.ageSeconds, 30);
  assert.equal(b.body.nextRequestInSeconds, 30);
  assert.equal(g.calls.length, 1);
});

test('a smaller circle inside a cached area is served from it, with distances from the new centre', async () => {
  const g = setup();
  await g.gate.get(MUC);
  const inner = { lat: 48.14, lng: 11.68, rad: 3 }; // ~7.4 km east, fully inside 17.5 km
  const r = await g.gate.get(inner);
  assert.equal(g.calls.length, 1, 'no new upstream request');
  assert.equal(r.body.coverage, 'full');
  assert.equal(r.body.source, 'cache');
  assert.ok(r.body.stations.length > 0);
  for (const s of r.body.stations) {
    assert.ok(s.dist <= 3, 'only stations inside the requested circle');
    assert.ok(Math.abs(s.dist - haversineKm(inner, s)) < 0.051, 'distance recomputed from the new centre');
  }
});

test('an area not covered by the cache: rate limit is global across origins; overlapping data is labelled partial', async () => {
  const g = setup();
  await g.gate.get(MUC);
  g.advance(10_000);
  const east = { lat: 48.14, lng: 11.9, rad: 10 }; // overlaps the cached circle but is not inside it
  const r = await g.gate.get(east);
  assert.equal(g.calls.length, 1, 'no second upstream request within a minute, even for another origin');
  assert.equal(r.status, 200);
  assert.equal(r.body.coverage, 'partial');
  assert.equal(r.body.stale, true);
  assert.equal(r.body.error, 'refresh_rate_limited');
  assert.equal(r.body.retryAfterSeconds, 50);
  assert.ok(r.body.stations.every((s) => s.dist <= 10));
});

test('an area with no overlapping data within the limit -> 429 with retry time, no stations', async () => {
  const g = setup();
  await g.gate.get(MUC);
  const berlin = { lat: 52.52, lng: 13.4, rad: 5 };
  const r = await g.gate.get(berlin);
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'rate_limited');
  assert.equal(r.body.retryAfterSeconds, 60);
  assert.equal(r.body.stations, undefined);
  g.advance(MIN_INTERVAL_MS);
  const r2 = await g.gate.get(berlin);
  assert.equal(r2.body.source, 'live');
  assert.equal(g.calls.length, 2);
});

test('after the cache lifetime the same area is fetched again', async () => {
  const g = setup();
  await g.gate.get(MUC);
  g.advance(CACHE_TTL_MS);
  assert.equal((await g.gate.get(MUC)).body.source, 'live');
  assert.equal(g.calls.length, 2);
});

test('50 concurrent visitors in the same area cause exactly one upstream request', async () => {
  const g = setup({ delayMs: 20 });
  const results = await Promise.all(Array.from({ length: 50 }, () => g.gate.get(MUC)));
  assert.equal(g.calls.length, 1);
  assert.ok(results.every((r) => r.status === 200 && r.body.coverage === 'full'));
});

test('concurrent visitors in different areas still cause only one upstream request', async () => {
  const g = setup({ delayMs: 20 });
  const areas = [MUC, { lat: 52.52, lng: 13.4, rad: 5 }, { lat: 48.78, lng: 9.18, rad: 10 }, { lat: 48.14, lng: 11.6, rad: 2 }];
  const results = await Promise.all(areas.flatMap((a) => [g.gate.get(a), g.gate.get(a)]));
  assert.equal(g.calls.length, 1);
  assert.equal(results.filter((r) => r.body.source === 'live').length, 1);
  // The small Munich circle is inside the fetched area, so it gets complete data from the cache.
  assert.equal(results[6].body.coverage, 'full');
  assert.equal(results[2].status, 429);
});

test('a failed request still counts toward the limit; stale full data is labelled', async () => {
  const g = setup();
  await g.gate.get(MUC);
  g.advance(5 * 60_000);
  g.gate.fetchUpstream = async (area) => (g.calls.push(area), { error: 'upstream_unreachable' });
  const r = await g.gate.get(MUC);
  assert.equal(r.status, 200);
  assert.equal(r.body.stale, true);
  assert.equal(r.body.coverage, 'full');
  assert.equal(r.body.error, 'upstream_unreachable');
  assert.equal(r.body.ageSeconds, 300);
  g.advance(10_000);
  const r2 = await g.gate.get(MUC);
  assert.equal(r2.body.error, 'refresh_rate_limited');
  assert.equal(g.calls.length, 2);
});

test('upstream error without any cache -> 502 with the error code', async () => {
  const g = setup({ fail: true });
  const r = await g.gate.get(MUC);
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'upstream_key_rejected');
});

test('the limit survives a restart because it is read from storage', async () => {
  const g = setup();
  await g.gate.get(MUC);
  const restarted = new Gate({ storage: g.storage, fetchUpstream: async () => assert.fail('must not call upstream'), now: () => 10_000_000 + 70_000 + 0 - 15_000 });
  const r = await restarted.get({ lat: 52.52, lng: 13.4, rad: 5 });
  assert.equal(r.status, 429);
});

test('data older than 30 minutes is deleted and never served', async () => {
  const g = setup();
  await g.gate.get(MUC);
  g.advance(STALE_MAX_MS + 1);
  g.gate.fetchUpstream = async (area) => (g.calls.push(area), { error: 'upstream_unreachable' });
  const r = await g.gate.get(MUC);
  assert.equal(r.status, 502);
  assert.equal(g.store.get('s:48.14,11.58,17.5'), undefined);
});

test(`at most ${MAX_SNAPSHOTS} areas are kept`, async () => {
  const g = setup();
  for (let i = 0; i < MAX_SNAPSHOTS + 3; i++) {
    await g.gate.get({ lat: 48 + i * 0.1, lng: 11, rad: 1 });
    g.advance(MIN_INTERVAL_MS);
  }
  assert.equal([...g.store.keys()].filter((k) => k.startsWith('s:')).length, MAX_SNAPSHOTS);
  assert.equal(g.store.get('snapshots').length, MAX_SNAPSHOTS);
});

test('empty station list is a valid, complete result', async () => {
  const g = setup();
  g.gate.fetchUpstream = async () => ({ stations: [] });
  const r = await g.gate.get(MUC);
  assert.equal(r.status, 200);
  assert.equal(r.body.coverage, 'full');
  assert.deepEqual(r.body.stations, []);
});

test('duplicate station ids across overlapping areas appear once (newest wins)', async () => {
  const g = setup();
  await g.gate.get({ lat: 48.14, lng: 11.58, rad: 5 });
  g.advance(MIN_INTERVAL_MS);
  await g.gate.get({ lat: 48.14, lng: 11.62, rad: 5 });
  g.advance(10_000);
  const r = await g.gate.get({ lat: 48.14, lng: 11.6, rad: 8 }); // overlaps both, covered by neither
  assert.equal(r.body.coverage, 'partial');
  const ids = r.body.stations.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});
