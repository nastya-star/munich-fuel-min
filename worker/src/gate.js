// Request gate for the Tankerkönig API key, shared by every visitor and every search area.
//
// Runs inside ONE Durable Object instance (see index.js), which Cloudflare guarantees is unique
// worldwide, so the limit holds across all Worker instances and regions.
//  - All requests are evaluated one after another (a promise queue), so there are no races:
//    a request that arrives while another is fetching waits and then usually finds a fresh cache.
//  - `lastRequestAt` is written to durable storage BEFORE the upstream call, so the
//    1-request-per-minute limit covers all areas and also survives restarts and failed requests.
//  - Results are cached per area (centre + radius). A cached area is reused for any requested
//    circle it fully contains, with distances recomputed from the requested centre. A cached area
//    that only overlaps is never presented as complete: it is returned only as `coverage: "partial"`
//    when a fresh request is impossible.

import { haversineKm, covers, overlaps, round1 } from './geo.js';

export const MIN_INTERVAL_MS = 60_000; // at most one upstream request per minute (provider limit)
export const CACHE_TTL_MS = 60_000; // a cached area counts as current for one minute
export const STALE_MAX_MS = 30 * 60_000; // older areas are deleted and never served
export const MAX_SNAPSHOTS = 10;
// Strict per-client budget for requests that trigger an upstream call (cache hits are free):
// one client cannot keep the shared 1/min budget busy. Keys are hashes from handler.js and are
// held in memory only (never stored).
export const CLIENT_UPSTREAM_MAX = 3;
export const CLIENT_UPSTREAM_WINDOW_MS = 10 * 60_000;
const CLIENT_MAP_LIMIT = 5000;

const UPSTREAM_ERRORS = new Set(['upstream_rate_limited', 'upstream_key_rejected', 'upstream_unreachable', 'upstream_error']);

const INDEX_KEY = 'snapshots';
const snapKey = (a) => `s:${a.lat},${a.lng},${a.rad}`;

export class Gate {
  /**
   * @param {object} o
   * @param {{get(k:string):Promise<any>, put(k:string,v:any):Promise<void>, delete(k:string):Promise<any>}} o.storage
   * @param {(area:{lat:number,lng:number,rad:number}) => Promise<{stations?: object[], error?: string, message?: string}>} o.fetchUpstream
   * @param {() => number} [o.now]
   */
  constructor({ storage, fetchUpstream, now = () => Date.now() }) {
    this.storage = storage;
    this.fetchUpstream = fetchUpstream;
    this.now = now;
    this.queue = Promise.resolve();
    this.index = null; // [{key, lat, lng, rad, fetchedAt}]
    this.clients = new Map(); // client key -> timestamps of upstream requests it triggered
  }

  /**
   * @param {{lat:number,lng:number,rad:number}} area already validated and snapped
   * @param {{client?: string}} [opts] hashed client key for the per-client upstream budget
   */
  get(area, { client } = {}) {
    const run = this.queue.then(() => this.#evaluate(area, client));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Seconds until `client` may trigger another upstream request (0 = allowed now). */
  #clientWait(client, now) {
    if (!client) return 0;
    const recent = (this.clients.get(client) || []).filter((t) => now - t < CLIENT_UPSTREAM_WINDOW_MS);
    if (recent.length) this.clients.set(client, recent);
    else this.clients.delete(client);
    if (recent.length < CLIENT_UPSTREAM_MAX) return 0;
    return Math.max(1, Math.ceil((recent[0] + CLIENT_UPSTREAM_WINDOW_MS - now) / 1000));
  }

  #chargeClient(client, now) {
    if (!client) return;
    if (this.clients.size >= CLIENT_MAP_LIMIT) {
      for (const [k, ts] of this.clients) if (now - ts[ts.length - 1] >= CLIENT_UPSTREAM_WINDOW_MS) this.clients.delete(k);
      if (this.clients.size >= CLIENT_MAP_LIMIT) this.clients.delete(this.clients.keys().next().value);
    }
    this.clients.set(client, [...(this.clients.get(client) || []), now]);
  }

  async #loadIndex(now) {
    if (!this.index) this.index = (await this.storage.get(INDEX_KEY)) || [];
    const keep = this.index.filter((m) => now - m.fetchedAt < STALE_MAX_MS);
    for (const m of this.index) if (!keep.includes(m)) await this.storage.delete(m.key);
    if (keep.length !== this.index.length) await this.#saveIndex(keep);
  }

  async #saveIndex(index) {
    this.index = index;
    await this.storage.put(INDEX_KEY, index);
  }

  async #remember(area, stations, fetchedAt) {
    const meta = { key: snapKey(area), lat: area.lat, lng: area.lng, rad: area.rad, fetchedAt };
    await this.storage.put(meta.key, stations);
    const others = this.index.filter((m) => m.key !== meta.key);
    const next = [meta, ...others].sort((a, b) => b.fetchedAt - a.fetchedAt);
    for (const m of next.slice(MAX_SNAPSHOTS)) await this.storage.delete(m.key);
    await this.#saveIndex(next.slice(0, MAX_SNAPSHOTS));
    return meta;
  }

  async #nextRequestIn(now) {
    const last = await this.storage.get('lastRequestAt');
    return typeof last === 'number' ? Math.max(0, Math.ceil((last + MIN_INTERVAL_MS - now) / 1000)) : 0;
  }

  async #evaluate(area, client) {
    let now = this.now();
    await this.#loadIndex(now);
    const newestFirst = [...this.index].sort((a, b) => b.fetchedAt - a.fetchedAt);
    const full = newestFirst.find((m) => covers(m, area));
    if (full && now - full.fetchedAt < CACHE_TTL_MS) return this.#ok(area, [full], 'cache', 'full', now);

    let extra;
    const globalWait = await this.#nextRequestIn(now);
    const clientWait = globalWait === 0 ? this.#clientWait(client, now) : 0;
    if (globalWait > 0) {
      extra = { error: 'refresh_rate_limited' };
    } else if (clientWait > 0) {
      extra = { error: 'client_rate_limited', retryAfterSeconds: clientWait };
    } else {
      await this.storage.put('lastRequestAt', now); // count the request before making it
      this.#chargeClient(client, now);
      let result;
      try {
        result = await this.fetchUpstream(area);
      } catch {
        result = { error: 'upstream_unreachable' };
      }
      now = this.now();
      if (result && Array.isArray(result.stations)) {
        const meta = await this.#remember(area, result.stations, now);
        return this.#ok(area, [meta], 'live', 'full', now);
      }
      // Only a known error code goes to clients; upstream diagnostic text is never forwarded.
      extra = { error: UPSTREAM_ERRORS.has(result?.error) ? result.error : 'upstream_error' };
    }
    extra.retryAfterSeconds ??= await this.#nextRequestIn(now);

    // No fresh data possible: fall back to labelled older data, never to an unlabelled guess.
    if (full) return this.#ok(area, [full], 'cache', 'full', now, extra);
    const partial = newestFirst.filter((m) => overlaps(m, area));
    if (partial.length) return this.#ok(area, partial, 'cache', 'partial', now, extra);
    const limited = extra.error === 'refresh_rate_limited' || extra.error === 'client_rate_limited';
    const status = limited ? 429 : 502;
    return { status, body: { ok: false, ...extra, error: extra.error === 'refresh_rate_limited' ? 'rate_limited' : extra.error, query: area } };
  }

  async #ok(area, metas, source, coverage, now, extra = {}) {
    const seen = new Set();
    const stations = [];
    const observations = [];
    for (const m of metas) {
      const observedAt = new Date(m.fetchedAt).toISOString();
      let count = 0;
      for (const s of (await this.storage.get(m.key)) || []) {
        if (seen.has(s.id)) continue; // newest snapshot wins
        const dist = haversineKm(area, s);
        if (dist > area.rad) continue;
        seen.add(s.id);
        stations.push({ ...s, dist: round1(dist), observedAt });
        count++;
      }
      // Provenance: which earlier search each part of a combined result comes from.
      if (count) observations.push({ area: { lat: m.lat, lng: m.lng, rad: m.rad }, fetchedAt: observedAt, stations: count });
    }
    const used = observations.length ? observations.map((o) => Date.parse(o.fetchedAt)) : metas.map((m) => m.fetchedAt);
    const oldest = Math.min(...used);
    return {
      status: 200,
      body: {
        ok: true,
        source, // 'live' = fetched for this request, 'cache' = reused earlier result
        coverage, // 'full' = every station in the requested area; 'partial' = only an earlier, overlapping search
        stale: coverage === 'partial' || now - oldest >= CACHE_TTL_MS,
        fetchedAt: new Date(oldest).toISOString(),
        ageSeconds: Math.max(0, Math.round((now - oldest) / 1000)),
        query: area, // the (snapped) area the stations and distances refer to
        nextRequestInSeconds: await this.#nextRequestIn(now),
        observations, // [{area, fetchedAt, stations}] per contributing cached search
        stations, // each with observedAt = time its price was retrieved
        ...extra,
      },
    };
  }
}
