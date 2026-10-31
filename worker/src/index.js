// Cloudflare Worker: the only component that knows the Tankerkönig API key.
//
//   GET /api/prices  -> current prices for the fixed search area (see AREA), served through
//                       the single global PriceGate Durable Object.
//
// The key comes from the Worker secret TANKERKOENIG_API_KEY (`wrangler secret put`). It is
// never returned, logged or included in error messages.

import { DurableObject } from 'cloudflare:workers';
import { Gate } from './gate.js';
import { normalizeStations, classifyUpstreamError } from './normalize.js';

// Marienplatz, Munich. The farthest point of the city boundary (OSM relation 62428) is
// 16.1 km away, so a 17 km circle contains the whole city area. API maximum: 25 km.
export const AREA = { lat: 48.1374, lng: 11.5755, radiusKm: 17, label: 'Marienplatz, München' };

const UPSTREAM = 'https://creativecommons.tankerkoenig.de/json/list.php';

async function fetchTankerkoenig(env) {
  const key = (env.TANKERKOENIG_API_KEY || '').trim();
  const url = new URL(env.UPSTREAM_URL || UPSTREAM);
  url.search = new URLSearchParams({ lat: String(AREA.lat), lng: String(AREA.lng), rad: String(AREA.radiusKm), type: 'all', apikey: key }).toString();
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
    this.gate = new Gate({ storage: ctx.storage, fetchUpstream: () => fetchTankerkoenig(env), area: AREA });
  }

  async getPrices() {
    return this.gate.get();
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

    if (!(env.TANKERKOENIG_API_KEY || '').trim()) return json(503, { ok: false, error: 'not_configured', area: AREA }, headers);

    const stub = env.PRICE_GATE.get(env.PRICE_GATE.idFromName('global'));
    const { status, body } = await stub.getPrices();
    if (body.retryAfterSeconds && status !== 200) headers['Retry-After'] = String(body.retryAfterSeconds);
    console.log(JSON.stringify({ status, source: body.source, stale: body.stale, error: body.error, stations: body.stations?.length }));
    return json(status, body, headers);
  },
};
