// Browser end-to-end test of the page (docs/) in headless Chrome via the DevTools protocol.
// The price API and the geocoder are intercepted with deterministic mocks, so no real requests
// are made. Run: node tests/e2e.mjs   (needs Google Chrome; set CHROME_PATH to override)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { haversineKm } from '../docs/core.js';

const CHROME = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!CHROME) { console.log('SKIP: Chrome not found (set CHROME_PATH)'); process.exit(0); }

// ---- static server for docs/ ----------------------------------------------------------------------
const DOCS = new URL('../docs/', import.meta.url);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(DOCS.pathname.replace(/^\/([A-Z]:)/, '$1'), p));
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(8792, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:8792';

// ---- mock data --------------------------------------------------------------------------------------
// 40 stations on a grid around central Munich, with: a closed cheapest station, an E10 gap,
// an E5 tie, a legal company name with a brand, and a station without name and brand.
const STATIONS = Array.from({ length: 40 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name: i === 3 ? 'Muster Mineralöl GmbH & Co. KG' : i === 4 ? '' : `Station ${i}`,
  brand: i === 3 ? 'Muster Tank' : i === 4 ? '' : ['ARAL', 'Shell', 'ESSO', 'JET'][i % 4],
  street: 'Teststraße', houseNumber: String(i + 1), postCode: '80331', place: 'München',
  lat: 48.1374 + ((i % 8) - 4) * 0.012, lng: 11.5755 + (Math.floor(i / 8) - 2) * 0.018,
  isOpen: i !== 0,
  prices: { e5: i === 0 ? 1799 : 1900 + (i % 10) * 10, e10: i % 7 === 0 ? null : 1850 + (i % 9) * 10, diesel: 2000 + (i % 6) * 10 },
}));
let mode = 'ok';
const apiCalls = [];
let geoCalls = 0;
function mockApi(url) {
  const q = { lat: Number(url.searchParams.get('lat')), lng: Number(url.searchParams.get('lng')), rad: Number(url.searchParams.get('rad')) };
  apiCalls.push(url.search);
  const stations = STATIONS.map((s) => ({ ...s, dist: Math.round(haversineKm(q, s) * 10) / 10 })).filter((s) => s.dist <= q.rad);
  const base = { ok: true, query: q, fetchedAt: '2026-11-03T17:00:00.000Z', ageSeconds: 0, stations };
  if (mode === 'ok') return [200, { ...base, source: 'live', coverage: 'full', stale: false, nextRequestInSeconds: 0 }];
  if (mode === 'partial') return [200, { ...base, source: 'cache', coverage: 'partial', stale: true, error: 'refresh_rate_limited', retryAfterSeconds: 42, nextRequestInSeconds: 42, stations: stations.slice(0, 5) }];
  return [429, { ok: false, error: 'rate_limited', retryAfterSeconds: 37, query: q }];
}
const GEO = [
  { display_name: 'Görresstraße 29, Maßmannbergl, Maxvorstadt, München, Bayern, 80798, Deutschland', lat: '48.1554264', lon: '11.5634866' },
  { display_name: 'Görresstraße, Hof, Bayern, Deutschland', lat: '50.31', lon: '11.91' },
];

// ---- Chrome via CDP ----------------------------------------------------------------------------------
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'e2e-'))}`, '--no-first-run', '--lang=en-US', '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
let ws; let id = 0; const pending = new Map(); let session;
const send = (method, params = {}, sessionId = session) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error'); return r.result?.value; };
const waitFor = async (expr, what, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(100); } throw new Error(`timeout waiting for ${what}`); };
const go = async (url) => { await send('Page.navigate', { url }); await sleep(300); await waitFor(`document.readyState==='complete' && !!document.querySelector('.card')`, 'page load'); };
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
let passed = 0;
const ok = (name) => { passed++; console.log('PASS', name); };
const shot = async (name) => { if (!process.env.SHOT_DIR) return; const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); (await import('node:fs')).writeFileSync(join(process.env.SHOT_DIR, name + '.png'), Buffer.from(r.data, 'base64')); };

async function onEvent(d) {
  if (d.method !== 'Fetch.requestPaused') return;
  const url = new URL(d.params.request.url);
  let status = 200; let body = '[]';
  if (url.hostname.endsWith('workers.dev')) { const [s, b] = mockApi(url); status = s; body = JSON.stringify(b); }
  else if (url.hostname === 'nominatim.openstreetmap.org') { geoCalls++; body = JSON.stringify(url.searchParams.get('q').toLowerCase().includes('görres') ? GEO : []); }
  await send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(body).toString('base64') }, d.sessionId);
}

try {
  let v; for (let i = 0; i < 60; i++) { try { v = await (await fetch('http://127.0.0.1:9335/json/version')).json(); break; } catch { await sleep(250); } }
  ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d); pending.delete(d.id); } else onEvent(d); };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  session = (await send('Target.attachToTarget', { targetId, flatten: true }, undefined)).sessionId;
  await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*workers.dev*' }, { urlPattern: '*nominatim.openstreetmap.org*' }] });

  // 1. Default location -------------------------------------------------------------------------------
  await go(`${SITE}/`);
  await ev(`localStorage.clear()`);
  await sleep(300);
  apiCalls.length = 0;
  await go(`${SITE}/`);
  await waitFor(`document.querySelector('.card .p').textContent.includes('.')`, 'prices');
  assert.equal(await ev(`document.getElementById('loc-input').value`), 'Marienplatz, München');
  assert.equal(apiCalls.at(-1), '?lat=48.14&lng=11.58&rad=17.5', 'default area sent snapped');
  assert.equal(apiCalls.length, 1, 'one API request on open');
  ok('default starting point Marienplatz, one request with snapped area');

  // 8. minima + null bug + ties + closed --------------------------------------------------------------
  const cards = await ev(`[...document.querySelectorAll('.card')].map(c=>c.querySelector('.p').textContent)`);
  const minOf = (f) => Math.min(...STATIONS.filter((s) => s.isOpen && s.prices[f] && haversineKm({ lat: 48.1374, lng: 11.5755 }, s) <= 17).map((s) => s.prices[f]));
  assert.deepEqual(cards, ['e5', 'e10', 'diesel'].map((f) => `${(minOf(f) / 1000).toFixed(3)} €/L`));
  assert.equal(await ev(`/\\bnull\\b|undefined|NaN/.test(document.body.innerText)`), false, 'no literal null/undefined/NaN on the page');
  const bestCount = await ev(`document.querySelectorAll('#best .stns li').length`);
  const tieCount = STATIONS.filter((s) => s.isOpen && s.prices.e5 === minOf('e5')).length;
  assert.equal(bestCount, tieCount);
  if (tieCount > 1) assert.match(await text('#best .tie'), /share the lowest price/);
  assert.equal(await ev(`document.querySelector('.card[data-fuel=e5]').getAttribute('aria-pressed')`), 'true');
  ok(`cards show E5/E10/Diesel minima of open stations (${cards.join(', ')}); ${tieCount} tied best stations; no "null" text`);

  await shot('desktop-en');
  // 5. Directions from the selected origin --------------------------------------------------------------
  const href = await ev(`document.querySelector('#best a').href`);
  const u = new URL(href);
  assert.equal(u.searchParams.get('origin'), '48.1374,11.5755');
  assert.equal(u.searchParams.get('travelmode'), 'driving');
  assert.ok(/^\d+\.\d+,\d+\.\d+$/.test(u.searchParams.get('destination')));
  ok('Route planen opens Google Maps with origin = Marienplatz, destination = station, driving');

  // Fuel switch is local -------------------------------------------------------------------------------
  const before = apiCalls.length;
  await click('.card[data-fuel=e10]');
  assert.equal(await ev(`document.querySelector('.card[data-fuel=e10]').getAttribute('aria-pressed')`), 'true');
  assert.match(await text('#best .price'), /Super E10/);
  assert.equal(apiCalls.length, before);
  ok('switching fuel updates results without a new request');

  // Station naming --------------------------------------------------------------------------------------
  await click('.card[data-fuel=e5]');
  await ev(`document.getElementById('more').open=true`);
  await ev(`(()=>{const s=document.getElementById('list-status');s.value='all';s.dispatchEvent(new Event('change'))})()`);
  const titles = await ev(`[...document.querySelectorAll('#list .row b')].map(b=>b.textContent)`);
  assert.ok(titles.includes('Muster Tank') && !titles.some((t) => /GmbH/.test(t)), 'brand, not legal name, as title');
  assert.ok(titles.includes('Petrol station'), 'fallback title for missing name and brand');
  ok('titles use brand over legal names; missing names get a fallback');

  // List: count, show more, sort, search, status ----------------------------------------------------------
  const count = await text('#list-count');
  assert.equal(await ev(`document.querySelectorAll('#list .row').length`), 20);
  assert.equal(await ev(`document.getElementById('show-more').hidden`), false);
  await click('#show-more');
  const all = await ev(`document.querySelectorAll('#list .row').length`);
  assert.equal(`${all} stations`, count);
  await ev(`(()=>{const s=document.getElementById('list-sort');s.value='dist';s.dispatchEvent(new Event('change'))})()`);
  const dists = await ev(`[...document.querySelectorAll('#list .row .meta:last-child')].map(m=>parseFloat(m.textContent))`);
  assert.ok(dists.every((d, i) => i === 0 || dists[i - 1] <= d), 'sorted by distance');
  await ev(`(()=>{const q=document.getElementById('list-q');q.value='muster';q.dispatchEvent(new Event('input'))})()`);
  assert.equal(await text('#list-count'), '1 station');
  await ev(`(()=>{const q=document.getElementById('list-q');q.value='';q.dispatchEvent(new Event('input'));const s=document.getElementById('list-status');s.value='closed';s.dispatchEvent(new Event('change'))})()`);
  assert.equal(await text('#list-count'), '1 station');
  ok(`list: ${count}, first 20 then "Show more", sort by distance, search, closed filter`);

  // 6. Smaller radius inside loaded data is local --------------------------------------------------------
  const b2 = apiCalls.length;
  await click('input[name=radius][value="5"]');
  await sleep(150);
  assert.equal(apiCalls.length, b2, 'no request for a smaller radius');
  const maxDist = await ev(`(()=>{const s=document.getElementById('list-status');s.value='all';s.dispatchEvent(new Event('change'));document.getElementById('list-sort').value='dist';document.getElementById('list-sort').dispatchEvent(new Event('change'));return Math.max(...[...document.querySelectorAll('#list .row .meta:last-child')].map(m=>parseFloat(m.textContent)))})()`);
  assert.ok(maxDist <= 5);
  ok('radius 5 km answered from loaded data; all distances ≤ 5 km');

  // 2. Custom address ---------------------------------------------------------------------------------
  await ev(`(()=>{const i=document.getElementById('loc-input');i.value='Görresstraße 29';i.dispatchEvent(new Event('input'))})()`);
  await sleep(100);
  assert.equal(geoCalls, 0, 'typing does not call the geocoder');
  await ev(`document.getElementById('loc-form').requestSubmit()`);
  await waitFor(`!document.getElementById('loc-results').hidden`, 'suggestions');
  assert.equal(geoCalls, 1);
  assert.equal(await ev(`document.querySelectorAll('#loc-results button').length`), 2);
  await click('#loc-results button');
  await waitFor(`document.getElementById('loc-input').value.startsWith('Görresstraße 29')`, 'selection');
  await waitFor(`${JSON.stringify(apiCalls.length)} < 0 || true`, 'noop');
  await sleep(300);
  assert.equal(apiCalls.at(-1), '?lat=48.16&lng=11.56&rad=6', 'request centred on the chosen place, snapped');
  const o2 = new URL(await ev(`document.querySelector('#best a').href`)).searchParams.get('origin');
  assert.equal(o2, '48.155426,11.563487');
  const d2 = await ev(`[...document.querySelectorAll('#list .row a')].every(a=>new URL(a.href).searchParams.get('origin')==='48.155426,11.563487')`);
  assert.equal(d2, true, 'all list links use the new origin');
  ok('address search → choose result → automatic request, distances and all directions links from the new origin');

  // 3a. Geolocation success ------------------------------------------------------------------------------
  await send('Browser.grantPermissions', { origin: SITE, permissions: ['geolocation'] }, undefined);
  await send('Emulation.setGeolocationOverride', { latitude: 48.2001234, longitude: 11.6012345, accuracy: 20 });
  const b3 = apiCalls.length;
  await click('#geo');
  await waitFor(`document.getElementById('loc-input').value==='My location'`, 'geolocation');
  await sleep(300);
  assert.equal(apiCalls.length, b3 + 1);
  assert.equal(apiCalls.at(-1), '?lat=48.2&lng=11.6&rad=5.5', 'server receives only the ~1 km grid point');
  assert.equal(new URL(await ev(`document.querySelector('#best a').href`)).searchParams.get('origin'), '48.200123,11.601235');
  ok('Use my location: permission on click, precise origin for directions, only snapped area sent');

  // 3b. Geolocation denied --------------------------------------------------------------------------------
  await send('Browser.setPermission', { origin: SITE, permission: { name: 'geolocation' }, setting: 'denied' }, undefined);
  const b4 = apiCalls.length;
  await click('#geo');
  await waitFor(`/not allowed/.test(document.getElementById('loc-msg').textContent)`, 'denied message');
  assert.equal(await ev(`document.getElementById('loc-input').value`), 'My location', 'location unchanged');
  assert.equal(apiCalls.length, b4);
  ok('denied geolocation: friendly message, starting point kept, no request');

  // 7. Partial coverage / rate limit ---------------------------------------------------------------------
  mode = 'partial';
  await click('#refresh');
  await waitFor(`/Incomplete/.test(document.getElementById('note').textContent)`, 'partial note');
  assert.match(await text('#status'), /Data may be outdated .*Refresh available in \d+ s/);
  assert.equal(await ev(`document.getElementById('refresh').disabled`), true);
  assert.match(await text('.card[data-fuel=e5] .h'), /incomplete/);
  ok('partial coverage labelled "Incomplete", outdated, refresh countdown; refresh disabled');

  mode = 'ratelimit';
  await click('input[name=radius][value="17"]'); // larger radius → needs a new request
  await waitFor(`/requested again in \\d+ s/.test(document.getElementById('note').textContent)`, 'rate limit note');
  assert.equal(await ev(`document.querySelectorAll('#best .stns li').length`), 0, 'no prices for an uncovered area');
  assert.deepEqual(await ev(`[...document.querySelectorAll('.card .p')].map(p=>p.textContent)`), ['–', '–', '–']);
  ok('rate-limited new area: clear message, no invented prices');

  // 10. Language switch keeps the location ---------------------------------------------------------------
  mode = 'ok';
  await click('.lang a[data-lang=de]');
  await sleep(400);
  await waitFor(`document.documentElement.lang==='de' && document.querySelector('.card .p').textContent.includes(',')`, 'German page with prices');
  assert.equal(await ev(`document.getElementById('loc-input').value`), 'Mein Standort');
  assert.equal(await ev(`document.querySelector('input[name=radius]:checked').value`), '17');
  assert.match(await text('#status'), /Aktualisiert/);
  assert.match(await text('#best a'), /Route planen/);
  assert.match(await text('.card .h'), /niedrigster Preis/);
  assert.equal(new URL(await ev(`document.querySelector('#best a').href`)).searchParams.get('origin'), '48.200123,11.601235');
  assert.equal(await ev(`/\\bnull\\b|undefined|NaN/.test(document.body.innerText)`), false);
  await shot('desktop-de');
  ok('DE page: location, radius and preference kept; German labels; decimal comma');
  await click('.lang a[data-lang=en]');
  await sleep(400);
  await waitFor(`document.documentElement.lang==='en'`, 'English page');
  assert.equal(await ev(`document.getElementById('loc-input').value`), 'My location');
  ok('EN page again: location kept');

  // Mobile layout ----------------------------------------------------------------------------------------
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await go(`${SITE}/`);
  await waitFor(`document.querySelector('.card .p').textContent.includes('.')`, 'mobile prices');
  const overflow = await ev(`document.documentElement.scrollWidth - window.innerWidth`);
  assert.ok(overflow <= 0, `no horizontal overflow (got ${overflow}px)`);
  // Checkboxes/radios are measured by their clickable <label>.
  const small = await ev(`[...document.querySelectorAll('button,a.btn,input,select,.lang a')].filter(e=>e.offsetParent).map(e=>{const t=(e.type==='checkbox'||e.type==='radio')?e.closest('label'):e;return [e.id||e.className||e.tagName,Math.round(t.getBoundingClientRect().height)]}).filter(([,h])=>h<40)`);
  assert.deepEqual(small, [], 'touch targets at least 40px high');
  await shot('mobile-en');
  ok('mobile 360 px: no horizontal overflow, touch targets ≥ 40 px');

  console.log(`ALL ${passed} E2E CHECKS PASSED (API requests: ${apiCalls.length}, geocoder requests: ${geoCalls})`);
  process.exitCode = 0;
} catch (e) {
  console.error('FAIL', e.stack || e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
  server.close();
}
