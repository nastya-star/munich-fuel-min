#!/usr/bin/env node
// Developer-only data inspector. Runs locally (http://127.0.0.1:8790); it is not part of the
// public website (GitHub Pages only serves docs/). No dependencies, Node 18+.
//
//   node tools/inspect.mjs            # data from the deployed Worker (normalised, cached; no key needed)
//   node tools/inspect.mjs --raw      # raw Tankerkönig list.php / detail.php responses (needs the key)
//
// --raw reads TANKERKOENIG_API_KEY from the environment, never prints it, and redacts it from
// everything it shows. It uses the SAME key as the public site, whose limit is one request per
// minute for the key, so this tool allows at most one upstream request per 60 s (tracked in a
// lock file shared by all copies of the tool on this computer). Nothing is fetched until you
// click "Fetch". Nothing is written to disk except that timestamp; CSV export happens in the browser.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT) || 8790;
const RAW = process.argv.includes('--raw');
const WORKER = process.env.WORKER_URL || 'https://munich-fuel-min.stepanenkon010.workers.dev';
// Same search area as worker/src/index.js.
const AREA = { lat: 48.1374, lng: 11.5755, rad: 17 };
const KEY = (process.env.TANKERKOENIG_API_KEY || '').trim();
const LOCK = join(tmpdir(), 'munich-fuel-min-inspector-last-request');
const MIN_INTERVAL_MS = 60_000;

if (RAW && !KEY) {
  console.error('--raw needs TANKERKOENIG_API_KEY in the environment (it is never printed).');
  process.exit(1);
}

const redact = (s) => (KEY ? String(s).split(KEY).join('***') : String(s));

function lastRequestAt() {
  try { return Number(readFileSync(LOCK, 'utf8')) || 0; } catch { return 0; }
}

async function upstream(path, params) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt());
  if (wait > 0) return { status: 429, body: { ok: false, error: `local limit: wait ${Math.ceil(wait / 1000)} s (1 request/minute for this key)` } };
  writeFileSync(LOCK, String(Date.now()));
  const url = new URL(`https://creativecommons.tankerkoenig.de/json/${path}`);
  url.search = new URLSearchParams({ ...params, apikey: KEY }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = redact(await res.text());
    return { status: res.status, text, retrievedAt: new Date().toISOString(), request: redact(url.toString()) };
  } catch (e) {
    return { status: 502, body: { ok: false, error: redact(e.message) } };
  }
}

async function viaWorker() {
  try {
    const res = await fetch(`${WORKER}/api/prices`, { signal: AbortSignal.timeout(15_000) });
    return { status: res.status, text: await res.text(), retrievedAt: new Date().toISOString(), request: `${WORKER}/api/prices` };
  } catch (e) {
    return { status: 502, body: { ok: false, error: `${e.message} (if DNS fails on this network, try another network or set WORKER_URL)` } };
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
  if (req.method === 'POST' && u.pathname === '/fetch/list') {
    const r = RAW ? await upstream('list.php', { lat: AREA.lat, lng: AREA.lng, rad: AREA.rad, type: 'all' }) : await viaWorker();
    return send(res, 200, { mode: RAW ? 'raw' : 'worker', ...r });
  }
  if (req.method === 'POST' && u.pathname === '/fetch/detail') {
    if (!RAW) return send(res, 200, { status: 400, body: { ok: false, error: 'detail.php needs --raw mode' } });
    const id = u.searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 200, { status: 400, body: { ok: false, error: 'invalid station id' } });
    return send(res, 200, { mode: 'raw', ...(await upstream('detail.php', { id })) });
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Data inspector (${RAW ? 'raw Tankerkönig API' : 'deployed Worker'}) at http://127.0.0.1:${PORT}`);
  console.log('Nothing is fetched until you click "Fetch" in the page. Ctrl+C to stop.');
});

// Field meanings: from the Tankerkönig API documentation (creativecommons.tankerkoenig.de/?page=info)
// and, for Worker fields, from worker/src/normalize.js and gate.js.
const MEANINGS = {
  ok: 'true if the request succeeded', license: 'data licence (CC BY 4.0)', data: 'data origin ("MTS-K")', status: 'request status ("ok") / station status in prices.php',
  message: 'error description when ok is false', stations: 'stations in the search radius', station: 'one station (detail.php)',
  id: 'station UUID (stable MTS-K id)', name: 'station name as reported', brand: 'brand as reported (may be empty)', street: 'street', houseNumber: 'house number',
  postCode: 'postcode (integer in the raw API; zero-padded string in the Worker)', place: 'town', lat: 'latitude (WGS84)', lng: 'longitude (WGS84)',
  dist: 'distance from the search centre in km', isOpen: 'reported open at the time of the request',
  e5: 'Super E5 price €/L (raw float; Worker: integer thousandths, null if missing/invalid)', e10: 'Super E10 price (see e5)', diesel: 'Diesel price (see e5)',
  prices: 'Worker: { e5, e10, diesel } as integer thousandths of a euro or null',
  openingTimes: 'detail.php: opening hours as [{text,start,end}]', overrides: 'detail.php: temporary changes to opening hours', wholeDay: 'detail.php: open 24 h',
  state: 'detail.php: federal state (often null)', source: 'Worker: "live" (fetched now) or "cache" (reused)', stale: 'Worker: true if older than the 60 s cache because a refresh failed or was limited',
  fetchedAt: 'Worker: retrieval time (UTC ISO)', ageSeconds: 'Worker: age of the data in seconds', area: 'Worker: search centre and radius', error: 'Worker: error code', retryAfterSeconds: 'Worker: seconds until a new request is allowed',
};

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fuel data inspector (local)</title><style>
body{margin:0;font:14px/1.45 system-ui,sans-serif;color:#111;background:#fff}header,main{padding:12px 16px}header{border-bottom:1px solid #ddd}
h1{font-size:18px;margin:0 0 4px}.muted{color:#666}button,input,select{font:inherit;padding:6px 10px;border:1px solid #111;border-radius:5px;background:#fff}
button.on{background:#111;color:#fff}.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #eee;padding:4px 6px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#f6f6f6;cursor:pointer}
td.num{text-align:right;font-variant-numeric:tabular-nums}pre{background:#f6f6f6;padding:10px;overflow:auto;max-height:70vh;font-size:12px}.err{color:#a00}
</style></head><body><header><h1>Fuel data inspector <span class="muted">(local, developer only)</span></h1>
<div class="muted">Mode: <b>${RAW ? 'raw Tankerkönig list.php (key from environment, redacted)' : 'deployed Worker /api/prices (normalised)'}</b> · Area: ${AREA.rad} km around ${AREA.lat}, ${AREA.lng} · one request per click, at most one upstream request per minute</div>
<div class="bar"><button id="fetch">Fetch</button><span id="info" class="muted">Nothing fetched yet.</span></div>
<div class="bar"><button data-view="table" class="on">Table</button><button data-view="fields">Fields</button><button data-view="raw">Raw JSON</button>
<input id="q" type="search" placeholder="Search name, brand, street, place, id"><select id="fuel"><option value="">All fuels</option><option>e5</option><option>e10</option><option>diesel</option></select>
<select id="avail"><option value="">Any availability</option><option value="priced">Has price</option><option value="missing">No price</option><option value="open">Station open</option><option value="closed">Station closed</option></select>
<button id="csv">Export CSV (current rows)</button></div></header><main id="out"></main>
<script>
const RAW=${RAW}, MEANINGS=${JSON.stringify(MEANINGS)};
let resp=null, json=null, view='table', sort={k:'price',d:1};
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function stations(){return (json&&(json.stations||(json.station?[json.station]:[])))||[]}
function rows(){ // one row per station x fuel type
  const out=[];for(const s of stations()){for(const f of ['e5','e10','diesel']){
    const raw=RAW?s[f]:s.prices?.[f]; const price=RAW?(typeof raw==='number'?raw:null):(raw==null?null:raw/1000);
    out.push({id:s.id,name:s.name,brand:s.brand,street:[s.street,s.houseNumber].filter(Boolean).join(' '),postCode:s.postCode,place:s.place,lat:s.lat,lng:s.lng,dist:s.dist,
      fuel:f,price,rawValue:raw===undefined?'(absent)':JSON.stringify(raw),retrievedAt:json.fetchedAt||resp.retrievedAt,isOpen:s.isOpen})}}
  const q=$('q').value.trim().toLowerCase(),f=$('fuel').value,a=$('avail').value;
  return out.filter(r=>(!q||[r.name,r.brand,r.street,r.place,r.id,r.postCode].join(' ').toLowerCase().includes(q))&&(!f||r.fuel===f)&&
    (!a||(a==='priced'&&r.price!=null)||(a==='missing'&&r.price==null)||(a==='open'&&r.isOpen===true)||(a==='closed'&&r.isOpen!==true)))
   .sort((x,y)=>{const k=sort.k,u=x[k],v=y[k];if(u==null&&v==null)return 0;if(u==null)return 1;if(v==null)return -1;return (typeof u==='number'?u-v:String(u).localeCompare(String(v)))*sort.d})}
const COLS=[['id','Station ID'],['name','Name'],['brand','Brand'],['street','Street'],['postCode','Postcode'],['place','Place'],['lat','Lat'],['lng','Lng'],['dist','Dist km'],['fuel','Fuel'],['price','Price €/L'],['rawValue','Raw value'],['retrievedAt','Retrieved (UTC)'],['isOpen','Open']];
function render(){
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===view));
  if(!resp){$('out').innerHTML='';return}
  if(!json){$('out').innerHTML='<p class="err">Response is not JSON (HTTP '+resp.status+').</p><pre>'+esc(resp.text||JSON.stringify(resp.body))+'</pre>';return}
  if(view==='raw'){$('out').innerHTML='<pre>'+esc(JSON.stringify(json,null,2))+'</pre>';return}
  if(view==='fields'){const seen={};const walk=(o,p)=>{for(const[k,v]of Object.entries(o)){const path=p?p+'.'+k:k;const t=v===null?'null':Array.isArray(v)?'array':typeof v;(seen[path]??={types:new Set(),ex:v,k}).types.add(t);
      if(t==='object')walk(v,path);if(t==='array'&&v.length&&typeof v[0]==='object')v.forEach(x=>walk(x,path+'[]'))}};walk(json,'');
    $('out').innerHTML='<table><tr><th>Field</th><th>Observed types</th><th>Example</th><th>Meaning</th></tr>'+Object.entries(seen).map(([p,s])=>'<tr><td>'+esc(p)+'</td><td>'+esc([...s.types].join(' | '))+'</td><td>'+esc(typeof s.ex==='object'?(Array.isArray(s.ex)?'['+s.ex.length+' items]':'{…}'):JSON.stringify(s.ex))+'</td><td>'+esc(MEANINGS[s.k]||'')+'</td></tr>').join('')+'</table>';return}
  const r=rows();$('out').innerHTML='<p class="muted">'+r.length+' rows (station × fuel). Prices have no per-station timestamp in the live API; "Retrieved" is when this response was fetched.</p><table><tr>'+
    COLS.map(([k,l])=>'<th data-k="'+k+'">'+l+(sort.k===k?(sort.d>0?' ▲':' ▼'):'')+'</th>').join('')+(RAW?'<th>detail.php</th>':'')+'</tr>'+
    r.map(x=>'<tr>'+COLS.map(([k])=>'<td class="'+(typeof x[k]==='number'?'num':'')+'">'+esc(k==='price'&&x[k]!=null?x[k].toFixed(3):x[k])+'</td>').join('')+(RAW&&x.fuel==='e5'?'<td><button data-detail="'+esc(x.id)+'">detail</button></td>':RAW?'<td></td>':'')+'</tr>').join('')+'</table>';
  document.querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{sort={k:th.dataset.k,d:sort.k===th.dataset.k?-sort.d:1};render()});
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>load('/fetch/detail?id='+encodeURIComponent(b.dataset.detail)))}
async function load(path){$('info').textContent='Fetching…';
  try{resp=await (await fetch(path,{method:'POST'})).json();if(resp.body){json=resp.body}else{try{json=JSON.parse(resp.text)}catch{json=null}}
    const st=stations();$('info').innerHTML=esc((resp.request||'')+' → HTTP '+resp.status+' · '+st.length+' station(s)'+(json&&json.source?' · '+json.source+(json.stale?' (stale)':''):'')+(json&&json.error?' · error: '+json.error:'')+(json&&json.message?' · '+json.message:''))}
  catch(e){$('info').innerHTML='<span class="err">'+esc(e.message)+'</span>'}render()}
$('fetch').onclick=()=>load('/fetch/list');
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
['q','fuel','avail'].forEach(id=>$(id).addEventListener('input',render));
$('csv').onclick=()=>{const r=rows();if(!r.length)return;const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv=[COLS.map(c=>q(c[1])).join(',')].concat(r.map(x=>COLS.map(([k])=>q(k==='price'&&x[k]!=null?x[k].toFixed(3):x[k])).join(','))).join('\\r\\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\\ufeff'+csv],{type:'text/csv'}));a.download='fuel-data-'+new Date().toISOString().slice(0,19).replace(/:/g,'')+'.csv';a.click();URL.revokeObjectURL(a.href)};
</script></body></html>`;
