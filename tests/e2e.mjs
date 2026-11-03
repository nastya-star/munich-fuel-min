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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// 1×1 transparent PNG served for every map tile, so the test never touches the real tile server.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
let tileCalls = 0;
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
// GitHub-hosted Ubuntu runners restrict the user namespaces Chrome sandboxing needs.
const proc = spawn(CHROME, [...(process.env.CI ? ['--no-sandbox'] : []), '--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'e2e-'))}`, '--no-first-run', '--lang=en-US', '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
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
  else if (url.hostname === 'tile.openstreetmap.org') {
    tileCalls++;
    return send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: TILE.toString('base64') }, d.sessionId);
  }
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
  await send('Fetch.enable', { patterns: [{ urlPattern: '*workers.dev*' }, { urlPattern: '*nominatim.openstreetmap.org*' }, ...(process.env.REAL_TILES ? [] : [{ urlPattern: '*tile.openstreetmap.org*' }])] });

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

  await sleep(process.env.REAL_TILES ? 2500 : 0);
  await shot('desktop-en');
  // Theme and return link ---------------------------------------------------------------------------------
  const theme = await ev(`({bg:getComputedStyle(document.body).backgroundColor,fg:getComputedStyle(document.body).color,h1:getComputedStyle(document.querySelector('h1')).fontFamily,body:getComputedStyle(document.body).fontFamily,
    mq:[...document.styleSheets].some(ss=>{try{return [...ss.cssRules].some(r=>r.media&&/prefers-color-scheme/.test(r.media.mediaText))}catch(e){return false}}),back:document.querySelector('a.back').href,backText:document.querySelector('a.back').textContent})`);
  assert.equal(theme.bg, 'rgb(17, 17, 17)');
  assert.equal(theme.fg, 'rgb(245, 243, 238)');
  assert.match(theme.h1, /^Georgia/);
  assert.match(theme.body, /^system-ui/);
  assert.equal(theme.mq, false, 'no automatic light/dark switching');
  assert.equal(theme.back, 'https://nastya-star.github.io/anastasiia-stepanenko/');
  assert.equal(theme.backText, '← Back to my website');
  ok('dark identity (#111111, #F5F3EE, Georgia headings, system UI body), no colour-scheme switching; EN return link');

  // Map: markers, colours, no extra requests ----------------------------------------------------------------
  await waitFor(`document.querySelectorAll('.leaflet-marker-icon[data-id]').length>0`, 'map markers');
  const visibleIds = STATIONS.filter((s) => s.isOpen && haversineKm({ lat: 48.1374, lng: 11.5755 }, s) <= 17).map((s) => s.id).sort();
  const markers = async () => ev(`[...document.querySelectorAll('.leaflet-marker-icon[data-id]')].map(m=>({id:m.dataset.id,tier:m.dataset.tier,color:m.dataset.color}))`);
  let mk = await markers();
  assert.deepEqual(mk.map((m) => m.id).sort(), visibleIds, 'one marker per open station in the radius (open-only on)');
  const checkColours = (list, fuel, complete) => {
    const price = (id) => STATIONS.find((s) => s.id === id).prices[fuel];
    const valid = list.filter((m) => price(m.id) != null);
    const min = Math.min(...valid.map((m) => price(m.id)));
    for (const m of list) {
      const p = price(m.id);
      if (p == null) assert.equal(m.tier, 'none', 'no price -> neutral');
      else if (complete && p === min) assert.deepEqual([m.tier, m.color], ['min', '#22C55E'], 'every minimum tie is green');
      else {
        assert.equal(m.tier, 'above');
        assert.notEqual(m.color, '#22C55E', 'higher prices are never green');
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(m.color.slice(i, i + 2), 16));
        assert.ok(r >= 0xef && g <= 0xcc && b <= 0x44, `yellow→red only, got ${m.color}`);
      }
    }
    const byPrice = new Map();
    for (const m of valid) { const p = price(m.id); if (byPrice.has(p)) assert.equal(byPrice.get(p), m.color, 'equal prices, equal colours'); else byPrice.set(p, m.color); }
    return { greens: list.filter((m) => m.tier === 'min').length, min };
  };
  const e5 = checkColours(mk, 'e5', true);
  assert.equal(e5.greens, STATIONS.filter((s) => visibleIds.includes(s.id) && s.prices.e5 === e5.min).length);
  assert.ok(e5.greens > 1, 'mock data has an E5 tie');
  assert.ok(await ev(`!!document.querySelector('.leaflet-marker-icon[data-tier=min] .mk.min') && /✓/.test(document.querySelector('.leaflet-marker-icon[data-tier=min]').textContent)`), 'minimum markers carry a check mark');
  assert.match(await text('#legend'), /Cheapest 1\.900 €\/L.*Higher/);
  const view = () => ev(`document.querySelector('.leaflet-map-pane').style.transform + '|' + [...document.querySelectorAll('.leaflet-tile')].map(t=>t.src.split('/').slice(-3).join('/')).sort().join(',')`);
  const view0 = await view();
  const api0 = apiCalls.length;
  for (const f of ['e10', 'diesel', 'e5']) {
    await click(`.card[data-fuel=${f}]`);
    await sleep(150);
    const res = checkColours(await markers(), f, true);
    assert.ok(res.greens >= 1);
  }
  assert.equal(await view(), view0, 'switching fuel keeps zoom and position');
  assert.equal(apiCalls.length, api0, 'switching fuel makes no API request');
  assert.ok(process.env.REAL_TILES || tileCalls > 0, 'tiles requested from the configured provider (intercepted)');
  await waitFor(`document.querySelectorAll('.leaflet-tile-loaded').length>0`, 'tiles loaded');
  assert.equal(await ev(`[...document.querySelectorAll('.leaflet-tile-loaded')].every(t=>getComputedStyle(t).opacity==='1')`), true, 'loaded tiles are visible (no stuck fade at opacity 0)');
  assert.equal(await ev(`performance.getEntriesByType('resource').some(r=>/marker-(icon|shadow)\.png/.test(r.name))`), false, 'no default marker image requested');
  await click('.leaflet-control-zoom-in');
  await sleep(400);
  await ev(`document.querySelector('.leaflet-map-pane').dispatchEvent(new Event('mousedown'))`);
  assert.equal(apiCalls.length, api0, 'zooming the map makes no API request');
  ok(`map: ${mk.length} markers for open stations; green only for ${e5.greens} tied minimum stations; higher prices yellow→red, equal prices equal colours; fuel tabs restyle without moving the map or requesting data`);

  // Marker click -> details; list -> map
  const target = mk.find((m) => m.tier === 'above');
  await ev(`document.querySelector('.leaflet-marker-icon[data-id="${target.id}"]').click()`);
  await waitFor(`!!document.querySelector('.leaflet-popup .pop')`, 'popup');
  const st0 = STATIONS.find((s) => s.id === target.id);
  const pop = await text('.leaflet-popup .pop');
  assert.match(pop, new RegExp((st0.prices.e5 / 1000).toFixed(3).replace('.', '\\.') + ' €/L · Super E5'));
  assert.match(pop, /straight line/);
  assert.match(pop, /Price retrieved/);
  assert.equal(await text('#best-h'), 'Selected station');
  // Selected-station panel: fuel, price, gap in ct/L (thousandths / 10), address once, buttons.
  const minE5 = Math.min(...STATIONS.filter((s) => s.isOpen && haversineKm({ lat: 48.1374, lng: 11.5755 }, s) <= 17 && s.prices.e5).map((s) => s.prices.e5));
  const panel = await ev(`({fuel:document.querySelector('#best .fuel').textContent,price:document.querySelector('#best .price').textContent,gap:document.querySelector('#best .gap').textContent,
    addrCount:[...document.querySelectorAll('#best .meta')].filter(m=>m.textContent.includes('Teststraße')).length,
    route:document.querySelector('#best .acts a.btn.solid').textContent,cheap:(()=>{const b=document.getElementById('show-cheapest');return {tag:b.tagName,cls:b.className,visible:!!b.offsetParent,h:Math.round(b.getBoundingClientRect().height),text:b.textContent}})(),
    nullText:/\\bnull\\b|NaN|undefined/.test(document.getElementById('best').innerText)})`);
  assert.equal(panel.fuel, 'Super E5');
  assert.equal(panel.price, `${(st0.prices.e5 / 1000).toFixed(3)} €/L`);
  const cents = (st0.prices.e5 - minE5) / 10;
  assert.equal(panel.gap, `${cents.toLocaleString('en-GB', { maximumFractionDigits: 1 })} ct/L above the cheapest price`);
  assert.ok(cents < 100, `gap is in cents (${cents}), not tenths of a cent`);
  assert.equal(panel.addrCount, 1, 'address shown once');
  assert.equal(panel.route, 'Directions');
  assert.deepEqual([panel.cheap.tag, panel.cheap.cls, panel.cheap.visible, panel.cheap.h >= 40, panel.cheap.text], ['BUTTON', 'btn', true, true, 'Show cheapest station']);
  assert.equal(panel.nullText, false);
  await shot('selected-en');
  const selHref = new URL(await ev(`document.querySelector('#best .acts a').href`));
  assert.equal(selHref.searchParams.get('destination'), `${Number(st0.lat.toFixed(6))},${Number(st0.lng.toFixed(6))}`);
  assert.equal(selHref.searchParams.get('origin'), '48.1374,11.5755');
  // Keyboard: focus the button and press Enter -> selection cleared, cheapest shown, focus on heading.
  await ev(`document.getElementById('show-cheapest').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(200);
  assert.equal(await text('#best-h'), 'Best station');
  assert.equal(await ev(`document.activeElement.id`), 'best-h');
  assert.equal(await ev(`document.querySelectorAll('.leaflet-marker-icon .mk.sel').length`), 0, 'marker highlight cleared');
  assert.match(await text('#best .price'), new RegExp((minE5 / 1000).toFixed(3).replace('.', '\\.')));
  // A station tied at the minimum: "Lowest price" instead of a difference.
  const tiedId = (await markers()).find((m) => m.tier === 'min').id;
  await ev(`document.querySelector('.leaflet-marker-icon[data-id="${tiedId}"]').click()`);
  await sleep(200);
  assert.equal(await text('#best .gap'), 'Lowest price');
  await click('#show-cheapest');
  assert.equal(await text('#best-h'), 'Best station');
  ok(`selected-station panel: fuel, price, "${panel.gap}", address once, Directions + Show cheapest (keyboard works); tie shows "Lowest price"`);
  await ev(`document.getElementById('more').open=true`);
  const firstRow = await ev(`document.querySelector('#list .row').dataset.id`);
  await click('#list .row [data-show]');
  await waitFor(`!!document.querySelector('.leaflet-popup .pop')`, 'popup from list');
  assert.equal(await ev(`document.querySelector('.leaflet-marker-icon .mk.sel').closest('.leaflet-marker-icon').dataset.id`), firstRow);
  assert.equal(apiCalls.length, api0, 'selecting stations makes no API request');
  ok('marker click shows popup + detail card (price, fuel, distance, retrieval time, route to that station); list "Show on map" highlights the marker');
  await click('#show-cheapest');
  await ev(`document.getElementById('more').open=false`);

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
  const partialMarkers = await ev(`[...document.querySelectorAll('.leaflet-marker-icon[data-id]')].map(m=>m.dataset.tier)`);
  assert.ok(partialMarkers.length > 0 && !partialMarkers.includes('min'), 'no green markers with incomplete coverage');
  assert.match(await text('#legend'), /incomplete data, no confirmed cheapest/);
  // Selected station with incomplete data: "lowest observed", never "cheapest".
  await ev(`document.querySelector('.leaflet-marker-icon[data-id]').click()`);
  await sleep(200);
  const pgap = await text('#best .gap');
  assert.match(pgap, /lowest observed price/);
  assert.doesNotMatch(pgap, /^Lowest price$|above the cheapest price/);
  await click('#show-cheapest');
  ok('partial coverage labelled "Incomplete", outdated, refresh countdown; refresh disabled; no green markers; selection says "lowest observed"');

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
  assert.equal(await ev(`document.querySelector('a.back').href`), 'https://nastya-star.github.io/anastasiia-stepanenko/de/');
  assert.equal(await text('a.back'), '← Zurück zur Hauptwebsite');
  assert.match(await text('#legend'), /Günstigster 1,900 €\/L/);
  await ev(`document.querySelector('.leaflet-marker-icon[data-tier=above]').click()`);
  await sleep(200);
  assert.equal(await text('#best-h'), 'Ausgewählte Tankstelle');
  assert.match(await text('#best .gap'), /^\d+(,\d)? ct\/L über dem günstigsten Preis$/);
  assert.equal(await text('#show-cheapest'), 'Günstigste Tankstelle anzeigen');
  assert.equal(await text('#best .acts a'), 'Route planen');
  await click('#show-cheapest');
  assert.equal(await text('#best-h'), 'Beste Tankstelle');
  ok('DE page: location, radius and preference kept; German labels, legend and return link; decimal comma; German selected-station panel');
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
  await sleep(process.env.REAL_TILES ? 2500 : 0);
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
