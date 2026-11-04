// Cloudflare Worker: the only component that knows the Tankerkönig API key.
//
//   GET /api/prices?lat=&lng=&rad=  -> current prices for a search circle, served through the
//                                      single global PriceGate Durable Object. Without parameters
//                                      the default area (Marienplatz, 20 km) is used.
//
// The key comes from the Worker secret TANKERKOENIG_API_KEY (`wrangler secret put`). It is
// never returned, logged or included in error messages. Visitor coordinates are snapped to a
// ~1 km grid before they reach the Durable Object (see query.js) and are never logged.
// HTTP handling and abuse controls: handler.js.

import { DurableObject } from 'cloudflare:workers';
import { Gate } from './gate.js';
import { handleRequest } from './handler.js';
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
  // The upstream message is used only to choose an error code; it is not returned or logged.
  if (!res.ok || !body || body.ok !== true) return { error: classifyUpstreamError(res.status, String(body?.message || '')) };
  if (!Array.isArray(body.stations)) return { error: 'upstream_error' };
  return { stations: normalizeStations(body.stations) };
}

export class PriceGate extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.gate = new Gate({ storage: ctx.storage, fetchUpstream: (area) => fetchTankerkoenig(env, area) });
  }

  async getPrices(area, opts) {
    return this.gate.get(area, opts);
  }
}

export default {
  fetch: (request, env) => handleRequest(request, env),
};
