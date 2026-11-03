// Cloudflare Worker: the only component that knows the Tankerkönig API key.
//
//   GET /api/prices?lat=&lng=&rad=  -> current prices for a search circle, served through the
//                                      single global PriceGate Durable Object. Without parameters
//                                      the default area (Marienplatz, 17 km) is used.
//
// The key comes from the Worker secret TANKERKOENIG_API_KEY (`wrangler secret put`). It is
// never returned, logged or included in error messages. Visitor coordinates are snapped to a
// ~1 km grid before they reach the Durable Object (see query.js) and are never logged.

import { DurableObject } from 'cloudflare:workers';
import { Gate } from './gate.js';
import { parseArea } from './query.js';
import { normalizeStations, classifyUpstreamError } from './normalize.js';

const UPSTREAM = 'https://creativecommons.tankerkoenig.de/json/list.php';

async function fetchTankerkoenig(env, area) {
  const key = (env.TANKERKOENIG_API_KEY || '').trim();
  const url = new URL(env.UPSTREAM_URL || UPSTREAM);
  url.search = new URLSearchParams({ lat: String(area.lat), lng: String(area.lng), rad: String(area.rad), type: 'all', apikey: key }).toString();
  const res = await fetch(url, { headers: { 'User-Agent': 'munich-fuel-min (github.com/nastya-star/munich-fuel-min)' }, signal: AbortSignal.timeout(10_000) });
  let body;
  try {
    body = await res.json();
  } catch {
    return { error: res.status === 429 ? 'upstream_rate_limited' : 'upstream_error' };
  }
  if (!res.ok || !body || body.ok !== true) {
    const message = String(body?.message || '').replaceAll(key || '\u0000', '***').slice(0, 200);
    return { error: classifyUpstreamError(res.status, message), message };
  }
  if (!Array.isArray(body.stations)) return { error: 'upstream_error', message: 'no stations array' };
  return { stations: normalizeStations(body.stations) };
}

export class PriceGate extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.gate = new Gate({ storage: ctx.storage, fetchUpstream: (area) => fetchTankerkoenig(env, area) });
  }

  async getPrices(area) {
    return this.gate.get(area);
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname !== '/api/prices') return json(404, { ok: false, error: 'not_found' }, headers);
    if (request.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' }, headers);

    // Browsers from other websites are refused; the data is for this site's visitors only.
    const origin = request.headers.get('Origin');
    if (origin && !headers['Access-Control-Allow-Origin']) return json(403, { ok: false, error: 'origin_not_allowed' }, headers);

    const parsed = parseArea(url.searchParams);
    if (!parsed.ok) return json(400, { ok: false, error: parsed.error }, headers);
    if (!(env.TANKERKOENIG_API_KEY || '').trim()) return json(503, { ok: false, error: 'not_configured', query: parsed.area }, headers);

    const stub = env.PRICE_GATE.get(env.PRICE_GATE.idFromName('global'));
    const { status, body } = await stub.getPrices(parsed.area);
    if (body.retryAfterSeconds && status !== 200) headers['Retry-After'] = String(body.retryAfterSeconds);
    console.log(JSON.stringify({ status, source: body.source, coverage: body.coverage, stale: body.stale, error: body.error, stations: body.stations?.length }));
    return json(status, body, headers);
  },
};
