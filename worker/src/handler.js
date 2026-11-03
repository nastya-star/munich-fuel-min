// HTTP handling for GET /api/prices, without Cloudflare-specific imports so it can be unit-tested.
//
// Abuse controls (Origin/CORS is NOT authentication; any non-browser client can omit or forge it):
//  1. RATE_LIMITER binding (optional, Cloudflare Workers rate limiting): cheap per-client limit at
//     the edge, approximate and per location. Requests over the limit never reach the Durable Object.
//  2. Strict per-client budget for upstream-triggering requests, enforced in the global Durable
//     Object (gate.js): one client cannot keep the shared 1-request-per-minute key budget busy.
//  3. The global 1/min upstream gate itself (gate.js), unchanged.
// The client key is a truncated SHA-256 of the connecting IP; the raw IP is never stored or logged.

import { parseArea } from './query.js';

export const RATE_LIMIT_RETRY_SECONDS = 60;
const MAX_URL_LENGTH = 256;

export async function clientKey(ip) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`munich-fuel-min:${ip || 'unknown'}`));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
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

export async function handleRequest(request, env, { log = (x) => console.log(x) } = {}) {
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (url.pathname !== '/api/prices') return json(404, { ok: false, error: 'not_found' }, headers);
  if (request.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' }, headers);
  if (request.url.length > MAX_URL_LENGTH) return json(400, { ok: false, error: 'invalid_area' }, headers);

  // Browsers on other websites are refused (CORS hygiene only, not access control).
  const origin = request.headers.get('Origin');
  if (origin && !headers['Access-Control-Allow-Origin']) return json(403, { ok: false, error: 'origin_not_allowed' }, headers);

  const client = await clientKey(request.headers.get('CF-Connecting-IP'));
  if (env.RATE_LIMITER) {
    let allowed = true;
    try {
      ({ success: allowed } = await env.RATE_LIMITER.limit({ key: client }));
    } catch {
      allowed = true; // limiter unavailable: fail open; the strict gate limits still apply
    }
    if (!allowed) {
      headers['Retry-After'] = String(RATE_LIMIT_RETRY_SECONDS);
      return json(429, { ok: false, error: 'too_many_requests', retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS }, headers);
    }
  }

  const parsed = parseArea(url.searchParams);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.error }, headers);
  if (!(env.TANKERKOENIG_API_KEY || '').trim()) return json(503, { ok: false, error: 'not_configured', query: parsed.area }, headers);

  const stub = env.PRICE_GATE.get(env.PRICE_GATE.idFromName('global'));
  const { status, body } = await stub.getPrices(parsed.area, { client });
  // How much of the requested circle the snapped search area really covers (see query.js).
  body.request = parsed.request;
  if (body.retryAfterSeconds && status !== 200) headers['Retry-After'] = String(body.retryAfterSeconds);
  log(JSON.stringify({ status, source: body.source, coverage: body.coverage, stale: body.stale, error: body.error, stations: body.stations?.length }));
  return json(status, body, headers);
}
