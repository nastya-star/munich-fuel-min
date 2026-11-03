// End-to-end test of the real Worker + Durable Object in workerd (wrangler dev), against a
// local mock of list.php, so no real API requests are made.
// Run: node tests/integration.mjs   (takes ~2.5 minutes because it waits out the 60 s limit)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const MOCK_PORT = 8799;
const WORKER_PORT = 8788;
const TEST_KEY = 'test-key-not-real-0000';
const ALLOWED = 'http://localhost:8000';
const workerDir = new URL('../worker/', import.meta.url);

let upstreamCalls = 0;
let mode = 'ok';
const seenKeys = new Set();
const mock = createServer(async (req, res) => {
  upstreamCalls++;
  const u = new URL(req.url, 'http://x');
  seenKeys.add(u.searchParams.get('apikey'));
  assert.equal(u.searchParams.get('type'), 'all');
  assert.equal(u.searchParams.get('rad'), '17.5');
  await sleep(400); // slow upstream widens the window for duplicate requests
  res.setHeader('Content-Type', 'application/json');
  if (mode === 'fail') return res.end(JSON.stringify({ ok: false, message: `Key ${TEST_KEY} existiert nicht oder ist deaktiviert` }));
  res.end(JSON.stringify({
    ok: true, license: 'CC BY 4.0 -  https://creativecommons.tankerkoenig.de', data: 'MTS-K', status: 'ok',
    stations: [
      { id: 'a', name: 'A', brand: 'X', street: 'S', houseNumber: '1', postCode: 80331, place: 'München', lat: 48.13, lng: 11.57, dist: 1.1, isOpen: true, e5: 1.859, e10: 1.799, diesel: 1.699 },
      { id: 'b', name: 'B', brand: 'Y', street: 'S', houseNumber: '2', postCode: 80333, place: 'München', lat: 48.14, lng: 11.58, dist: 2.2, isOpen: true, e5: 1.859, e10: false, diesel: 0 },
      { id: 'c', name: 'C', brand: 'Z', street: 'S', houseNumber: '3', postCode: 80335, place: 'München', lat: 48.15, lng: 11.59, dist: 0.4, isOpen: false, e5: 1.699, e10: 1.649, diesel: 1.599 },
    ],
  }));
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// Local-only secret file for wrangler dev (git-ignored, deleted afterwards).
const devVars = new URL('.dev.vars', workerDir);
writeFileSync(devVars, `TANKERKOENIG_API_KEY=${TEST_KEY}\n`);
rmSync(new URL('.wrangler/state', workerDir), { recursive: true, force: true });

const wranglerBin = new URL('node_modules/wrangler/bin/wrangler.js', workerDir);
const proc = spawn(process.execPath, [wranglerBin.pathname.replace(/^\/([A-Z]:)/, '$1'), 'dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1',
  '--var', `UPSTREAM_URL:http://127.0.0.1:${MOCK_PORT}/list.php`, '--var', `ALLOWED_ORIGINS:${ALLOWED}`], { cwd: workerDir, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));

const api = `http://127.0.0.1:${WORKER_PORT}/api/prices`;
const get = (headers = {}) => fetch(api, { headers }).then(async (r) => ({ status: r.status, headers: r.headers, text: await r.text() }));

function done(code) {
  proc.kill();
  mock.close();
  if (existsSync(devVars)) unlinkSync(devVars);
  process.exit(code);
}

try {
  for (let i = 0; ; i++) {
    try { await fetch(api); break; } catch { if (i > 120) throw new Error(`wrangler dev did not start:\n${log}`); await sleep(500); }
  }
  // The readiness probe above may itself have triggered the first upstream call; reset state by waiting it out.
  const probeCalls = upstreamCalls;
  console.log('worker ready; probe upstream calls:', probeCalls);
  if (probeCalls) { console.log('waiting 61 s so the test starts with an expired cache…'); await sleep(61_000); }
  const base = upstreamCalls;

  // 1. 40 concurrent visitors -> exactly one upstream request.
  const burst = await Promise.all(Array.from({ length: 40 }, () => get({ Origin: ALLOWED })));
  assert.ok(burst.every((r) => r.status === 200), 'all 200');
  assert.equal(upstreamCalls - base, 1, 'one upstream call for 40 concurrent requests');
  const body = JSON.parse(burst[0].text);
  assert.equal(body.ok, true);
  assert.deepEqual(body.stations.find((s) => s.id === 'b').prices, { e5: 1859, e10: null, diesel: null });
  assert.equal(burst[0].headers.get('access-control-allow-origin'), ALLOWED);
  assert.ok(burst.every((r) => !r.text.includes(TEST_KEY)), 'key never in response');
  console.log('PASS 40 concurrent requests -> 1 upstream call; sources:', [...new Set(burst.map((r) => JSON.parse(r.text).source))].join(','));

  // 2. Repeat within a minute -> cache, no new upstream call.
  const again = JSON.parse((await get()).text);
  assert.equal(again.source, 'cache');
  assert.equal(upstreamCalls - base, 1);
  console.log('PASS repeat within 60 s served from cache, age', again.ageSeconds, 's');

  // 3. Foreign websites are refused.
  assert.equal((await get({ Origin: 'https://example.com' })).status, 403);
  console.log('PASS foreign Origin -> 403');

  // 3b. Another origin inside the cached area -> answered from cache, distances from the new centre.
  const inner = await fetch(`${api}?lat=48.14&lng=11.58&rad=3`).then((r) => r.json());
  assert.equal(inner.coverage, 'full');
  assert.equal(inner.source, 'cache');
  assert.equal(upstreamCalls - base, 1);
  assert.ok(inner.stations.every((s) => s.dist <= 3));
  console.log('PASS origin inside cached area -> full coverage from cache, no upstream call');

  // 3c. An uncovered origin within the minute -> global limit applies across origins.
  const berlin = await fetch(`${api}?lat=52.52&lng=13.4&rad=5`);
  assert.equal(berlin.status, 429);
  assert.equal((await berlin.json()).error, 'rate_limited');
  assert.equal(upstreamCalls - base, 1);
  console.log('PASS uncovered origin within 60 s -> 429, no upstream call');

  // 3d. Invalid areas are rejected before reaching the Durable Object.
  for (const q of ['lat=99&lng=11&rad=5', 'lat=48.1&lng=11.5&rad=30', 'lat=abc&lng=11&rad=5']) assert.equal((await fetch(`${api}?${q}`)).status, 400, q);
  console.log('PASS invalid lat/lng/radius -> 400');

  // 4. After a minute, upstream fails -> stale cache labelled, key redacted.
  mode = 'fail';
  await sleep(61_000);
  const r4 = await get();
  const b4 = JSON.parse(r4.text);
  assert.equal(r4.status, 200);
  assert.equal(b4.stale, true);
  assert.equal(b4.error, 'upstream_key_rejected');
  assert.ok(!r4.text.includes(TEST_KEY), 'key redacted from upstream message');
  assert.equal(upstreamCalls - base, 2);
  console.log('PASS failed refresh -> stale cache labelled (', b4.error, '), key redacted:', b4.upstreamMessage);

  // 5. Immediately again -> no upstream call (limit counts failed requests too).
  const b5 = JSON.parse((await get()).text);
  assert.equal(b5.error, 'refresh_rate_limited');
  assert.equal(upstreamCalls - base, 2);
  console.log('PASS retry within 60 s after failure -> no upstream call, retryAfter', b5.retryAfterSeconds, 's');

  assert.ok(![...seenKeys].some((k) => k !== TEST_KEY), 'worker sent the configured key');
  assert.ok(!log.includes(TEST_KEY), 'key never logged by the worker');
  console.log('PASS key absent from worker logs');
  console.log(`ALL INTEGRATION CHECKS PASSED (upstream calls during test: ${upstreamCalls - base})`);
  done(0);
} catch (e) {
  console.error('FAIL', e.message);
  console.error(log.slice(-3000));
  done(1);
}
