// Request gate for the Tankerkönig API key, shared by every visitor.
//
// Runs inside ONE Durable Object instance (see index.js), which Cloudflare guarantees is
// unique worldwide, so the limit holds across all Worker instances and regions.
//  - Concurrent callers share one evaluation (`pending`), so they never cause extra requests.
//  - `lastRequestAt` is written to durable storage BEFORE the upstream call, so the
//    1-request-per-minute limit also survives restarts and failed requests.
//  - A successful result is cached and reused for CACHE_TTL_MS.

export const MIN_INTERVAL_MS = 60_000; // at most one upstream request per minute (provider limit)
export const CACHE_TTL_MS = 60_000; // reuse a result for one minute

export class Gate {
  /**
   * @param {object} o
   * @param {{get(k:string):Promise<any>, put(k:string,v:any):Promise<void>}} o.storage
   * @param {() => Promise<{stations?: object[], error?: string, message?: string}>} o.fetchUpstream
   * @param {() => number} [o.now]
   * @param {object} o.area  search area echoed to clients
   */
  constructor({ storage, fetchUpstream, now = () => Date.now(), area }) {
    this.storage = storage;
    this.fetchUpstream = fetchUpstream;
    this.now = now;
    this.area = area;
    this.pending = null;
  }

  /** @returns {Promise<{status:number, body:object}>} */
  get() {
    if (!this.pending) this.pending = this.#evaluate().finally(() => { this.pending = null; });
    return this.pending;
  }

  async #evaluate() {
    const now = this.now();
    const snapshot = await this.storage.get('snapshot');
    if (snapshot && now - snapshot.fetchedAt < CACHE_TTL_MS) return this.#ok(snapshot, 'cache', false, now);

    const lastRequestAt = await this.storage.get('lastRequestAt');
    const waitMs = typeof lastRequestAt === 'number' ? MIN_INTERVAL_MS - (now - lastRequestAt) : 0;
    if (waitMs > 0) {
      const retryAfter = Math.ceil(waitMs / 1000);
      return snapshot
        ? this.#ok(snapshot, 'cache', true, now, { error: 'refresh_rate_limited', retryAfterSeconds: retryAfter })
        : { status: 429, body: { ok: false, error: 'rate_limited', retryAfterSeconds: retryAfter, area: this.area } };
    }

    await this.storage.put('lastRequestAt', now); // count the request before making it
    let result;
    try {
      result = await this.fetchUpstream();
    } catch {
      result = { error: 'upstream_unreachable' };
    }

    if (result && Array.isArray(result.stations)) {
      const fresh = { fetchedAt: this.now(), stations: result.stations };
      await this.storage.put('snapshot', fresh);
      return this.#ok(fresh, 'live', false, this.now());
    }
    const extra = { error: result?.error || 'upstream_error', upstreamMessage: result?.message || undefined, retryAfterSeconds: MIN_INTERVAL_MS / 1000 };
    return snapshot
      ? this.#ok(snapshot, 'cache', true, this.now(), extra)
      : { status: 502, body: { ok: false, ...extra, area: this.area } };
  }

  #ok(snapshot, source, stale, now, extra = {}) {
    return {
      status: 200,
      body: {
        ok: true,
        source, // 'live' = fetched for this request, 'cache' = reused earlier result
        stale, // true = older than the cache lifetime because a refresh was not possible
        fetchedAt: new Date(snapshot.fetchedAt).toISOString(),
        ageSeconds: Math.max(0, Math.round((now - snapshot.fetchedAt) / 1000)),
        area: this.area,
        stations: snapshot.stations,
        ...extra,
      },
    };
  }
}
