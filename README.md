# Munich Fuel Minimum

Shows the cheapest **Super E5**, **Super E10** and **Diesel** price per litre within 17 km of
Marienplatz, Munich, using live [Tankerkönig](https://www.tankerkoenig.de/) data (MTS-K).
English and German.

**Website:** https://nastya-star.github.io/munich-fuel-min/

For each fuel *f* it shows p\*<sub>f</sub> = min<sub>i</sub> p<sub>if</sub>, taken over the stations in the search area that
report a valid price for *f*. It is restricted to stations reported as open, unless the visitor unticks
that filter. All stations tied at the minimum are listed. This version compares current prices only;
price prediction and travel-cost optimisation are out of scope.

## How it works

```
Browser (GitHub Pages, static)            Cloudflare Worker (free tier)            Tankerkönig
docs/index.html, docs/de/index.html  ──▶  GET /api/prices                     ──▶  list.php?type=all
docs/app.js (on click only)               └─ PriceGate Durable Object (one,
                                             global): cache + 1 request/min
```

- **On demand only.** The page requests prices when the visitor clicks *Show current prices* or *Refresh*. There is no scheduled harvesting and no background polling. Fuel tabs, the distance selector and the open-only filter reuse the last response.
- **One upstream call for everything.** A single `list.php` request (`type=all`, `rad=17`) returns all three fuel types. The minimum is calculated in the browser.
- **Shared limit across all visitors and Worker instances.** Every request goes through one Durable Object (`idFromName('global')`), which Cloudflare guarantees is unique worldwide:
  - Concurrent callers share one in-flight evaluation, so they never trigger duplicate requests.
  - The time of the last request is written to durable storage *before* the call, so failed requests and restarts count too.
  - Results are cached for 60 s. A new upstream request is made at most once per 60 s, whatever happens.
- **Honest labelling.** Each response says whether it is `live` (fetched for this click) or `cache` (reused), when it was retrieved (shown in Europe/Berlin time), and whether it is `stale` (a refresh failed or was rate-limited), with the reason. Errors show no prices.
- **The key stays on the server.** `TANKERKOENIG_API_KEY` is a Cloudflare Worker secret:
  - It is not in this repository, the Pages site, or any generated file.
  - It is never returned to the browser or logged, and upstream error messages are redacted.
  - The Worker only answers browsers on `https://nastya-star.github.io` (CORS plus an Origin check).
- **Data handling.** No price data is committed to the repository, and there is no bulk download. Prices are compared as integer thousandths of a euro and shown with three decimals. Missing, `false`, `0` or implausible prices (outside 0.500–5.000 €/L) are excluded.

### Search area

The search centre is Marienplatz (48.1374° N, 11.5755° E) with a radius of 17 km; the API maximum is 25 km. The farthest point of the Munich city boundary (OSM relation 62428) is 16.1 km from Marienplatz, so the circle contains the whole city area plus parts of neighbouring towns. Results are described as *the cheapest within this search area*. Visitors can narrow the distance to 5 or 10 km; that is filtered locally, with no extra request.

### Terms

These follow [Tankerkönig's API terms](https://creativecommons.tankerkoenig.de/?page=info) and [business terms](https://onboarding.tankerkoenig.de/geschaeftsbedingungen):
- at most 1 request per minute;
- requests made on user action;
- no bulk retrieval and no passing on of datasets;
- the key is never published;
- CC BY 4.0 attribution to Tankerkönig, with the MTS-K named as the data source.

The terms also ask public sites not to filter results unless the user explicitly wants it. The open-only filter is therefore a visible, labelled checkbox that visitors can untick, and the distance filter is chosen by the visitor.

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/` | GitHub Pages site (static): `index.html` (EN), `de/index.html` (DE), `app.js`, `core.js` |
| `build.mjs` | Generates both HTML pages from one template: `node build.mjs` |
| `worker/` | Cloudflare Worker + Durable Object (`src/index.js`, `src/gate.js`, `src/normalize.js`, `wrangler.toml`) |
| `tests/*.test.mjs` | Unit tests: minimum, ties, unavailable fuels, closed stations, price validation, cache, 1/min limit, concurrency (`node --test "tests/*.test.mjs"`) |
| `tests/integration.mjs` | Runs the real Worker in workerd against a mock list.php: 40 concurrent requests → 1 upstream call, cache, stale labelling, key redaction, Origin check (`node tests/integration.mjs`, about 2.5 min) |

## Deployment

### 1. Frontend: GitHub Pages

Repository → **Settings → Pages → Build and deployment**:
- **Source:** *Deploy from a branch*
- **Branch:** `main`, folder **`/docs`**

### 2. Backend: Cloudflare Worker (free plan)

You need a free Cloudflare account and Node.js 18+. Run these in `worker/`:

```bash
npm ci
npx wrangler login                              # opens the browser; approve access
npx wrangler secret put TANKERKOENIG_API_KEY    # paste the key when prompted (not echoed, not saved locally)
npx wrangler deploy                             # prints https://munich-fuel-min.<your-subdomain>.workers.dev
```

Then set `API_BASE` in `docs/app.js` to the printed URL (it contains no secret), commit and push.

**Live backend:** `https://munich-fuel-min.stepanenkon010.workers.dev/api/prices`. If `wrangler deploy` fails with *code 10063*, the account has no workers.dev subdomain yet: open **Workers & Pages** in the Cloudflare dashboard once, then deploy again. Run all `wrangler` commands from `worker/` so `wrangler.toml` (Durable Object binding and migration) is picked up.

Check that it works: `curl -s https://munich-fuel-min.<subdomain>.workers.dev/api/prices | head -c 300`. A response with `"ok":true` and stations means the key is active. `upstream_key_rejected` means the key is not activated yet: confirm the email from Tankerkönig.

Free-plan usage is tiny: each click is one Worker request plus one Durable Object request, and at most one upstream request per minute.

## Development

```bash
node build.mjs                    # regenerate docs/index.html and docs/de/index.html
node --test "tests/*.test.mjs"    # unit tests
cd worker && npm ci && cd .. && node tests/integration.mjs   # Worker integration test (mock upstream)
```

For a local run against the real API, put `TANKERKOENIG_API_KEY=…` in `worker/.dev.vars` (git-ignored) and run `npx wrangler dev`. Do this sparingly: every request counts toward the key's limit.

## Future work (not implemented)

Historical prices, forecasting, trends by hour, and route/travel-cost optimisation. The Worker's normalised station records (stable MTS-K IDs, integer prices) are a suitable base for these.

## Attribution

Price data: Tankerkönig, CC BY 4.0, from reports to the Markttransparenzstelle für Kraftstoffe (MTS-K) of the Bundeskartellamt. No guarantee that the data is current or correct; the price at the pump applies.
