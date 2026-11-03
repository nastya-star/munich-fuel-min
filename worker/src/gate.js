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
  }

  /** @param {{lat:number,lng:number,rad:number}} area already validated and snapped */
  get(area) {
    const run = this.queue.then(() => this.#evaluate(area));
    this.queue = run.catch(() => {});
    return run;
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

  async #evaluate(area) {
    let now = this.now();
    await this.#loadIndex(now);
    const newestFirst = [...this.index].sort((a, b) => b.fetchedAt - a.fetchedAt);
    const full = newestFirst.find((m) => covers(m, area));
    if (full && now - full.fetchedAt < CACHE_TTL_MS) return this.#ok(area, [full], 'cache', 'full', now);

    let extra;
    if ((await this.#nextRequestIn(now)) === 0) {
      await this.storage.put('lastRequestAt', now); // count the request before making it
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
      extra = { error: result?.error || 'upstream_error', upstreamMessage: result?.message || undefined };
    } else {
      extra = { error: 'refresh_rate_limited' };
    }
    extra.retryAfterSeconds = await this.#nextRequestIn(now);

    // No fresh data possible: fall back to labelled older data, never to an unlabelled guess.
    if (full) return this.#ok(area, [full], 'cache', 'full', now, extra);
    const partial = newestFirst.filter((m) => overlaps(m, area));
    if (partial.length) return this.#ok(area, partial, 'cache', 'partial', now, extra);
    const status = extra.error === 'refresh_rate_limited' ? 429 : 502;
    return { status, body: { ok: false, ...extra, error: status === 429 ? 'rate_limited' : extra.error, query: area } };
  }

  async #ok(area, metas, source, coverage, now, extra = {}) {
    const seen = new Set();
    const stations = [];
    for (const m of metas) {
      for (const s of (await this.storage.get(m.key)) || []) {
        if (seen.has(s.id)) continue; // newest snapshot wins
        const dist = haversineKm(area, s);
        if (dist > area.rad) continue;
        seen.add(s.id);
        stations.push({ ...s, dist: round1(dist) });
      }
    }
    const oldest = Math.min(...metas.map((m) => m.fetchedAt));
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
        stations,
        ...extra,
      },
    };
  }
}
