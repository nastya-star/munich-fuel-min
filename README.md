# Munich Fuel Minimum

Shows the cheapest **Super E5**, **Super E10** and **Diesel** price per litre around a starting point
of your choice (default: Marienplatz, München), using live [Tankerkönig](https://www.tankerkoenig.de/) data (MTS-K).
English and German.

**Website:** https://nastya-star.github.io/munich-fuel-min/

For each fuel *f* it shows p*<sub>f</sub> = min<sub>i</sub> p<sub>if</sub> over the stations within the chosen radius of the
starting point that report a valid price for *f* and, unless the visitor unticks the filter, are reported open.
All stations tied at the minimum are listed. This compares current prices only; price prediction and travel-cost
optimisation are out of scope. Distances are straight-line (Haversine), not road distances.

## How it works

```
Browser (GitHub Pages, static)           Cloudflare Worker (free tier)                 Tankerkönig
docs/index.html, de/index.html     ──▶   GET /api/prices?lat&lng&rad              ──▶  list.php?type=all
docs/app.js, core.js                     └─ PriceGate Durable Object (one, global):
   │                                        area-aware cache + 1 request/min overall
   └─ address search ──▶ OpenStreetMap Nominatim (on submit only)
```

- **Starting point.** Marienplatz is the default. Visitors can:
  - search for an address, place or postcode (Nominatim, on submit only, at most once per second; typing only filters places they used before);
  - or click *Use my location*. The browser asks for permission only then; if it is denied, the starting point stays as it was.

  The choice and the radius (5/10/17 km) are kept in `localStorage`, so they survive the DE/EN switch.
- **When prices are requested.** On opening the page, when a starting point is confirmed, when a larger radius needs more data, and on *Refresh*. Never per keystroke, never on a timer. Fuel cards, the open-only filter, a smaller radius, and list search/sort/filter all reuse the data already loaded.
- **Privacy.** Before anything leaves the browser, the starting point is snapped to a 0.01° grid (about 1 km), and the radius is enlarged so the circle still contains the visitor’s own. The Worker snaps again for any client, so it never sees or stores a precise location. Exact distances and the Google Maps origin are computed in the browser from the precise point.
- **Area-aware cache with one global limit.** All requests go through one Durable Object (`idFromName("global")`) and are evaluated one after another, so there are no races:
  - **Covered:** a cached area younger than 60 s that fully contains the requested circle is reused. Distances are recomputed with Haversine from the requested centre, and only stations inside the circle are returned.
  - **Not covered:** a new `list.php` request is made only if none was made in the last 60 s (for *any* area). The time is stored *before* the request, so failures and restarts count too.
  - **Blocked by the limit:** the reply is clearly labelled. An older complete result of that area comes back as `stale`, results from overlapping areas as `coverage: "partial"` (the page then says it is *incomplete* and does not claim the cheapest), and otherwise a 429 with the waiting time.
  - Cached areas are kept for at most 30 minutes, and there are at most 10.
- **Directions.** *Route planen* opens `https://www.google.com/maps/dir/?api=1&origin=<start>&destination=<station>&travelmode=driving` (built with `URLSearchParams`). The origin is always the selected starting point and is never left out.
- **The key stays on the server.** `TANKERKOENIG_API_KEY` is a Cloudflare Worker secret:
  - It is not in this repository, the Pages site, or any generated file.
  - It is never returned or logged, and upstream error messages are redacted.
  - The Worker only answers browsers on `https://nastya-star.github.io` (CORS plus an Origin check).
  - It validates `lat`/`lng` (Germany only) and `rad` (1–25 km, the API maximum), and rejects any other parameters and overlong URLs.
- **Data handling.** No price data is committed and there is no bulk download. Prices are compared as integer thousandths of a euro and shown with three decimals. Missing, `false`, `0` or implausible prices are excluded. Station titles use the brand rather than legal company names.

### Map

One [Leaflet](https://leafletjs.com/) 1.9.4 map (self-hosted in `docs/vendor/leaflet/`, BSD-2-Clause) shows the stations of the current search: the radius, filtered by *Open stations only*. Clicking a fuel card restyles the markers in place, so zoom and position are kept. Panning, zooming, clicking markers and switching fuel never request prices. Clicking a marker opens a popup and the detail card, showing name, fuel, price (€/L, 3 decimals), address, straight-line distance, open/closed status, retrieval time and *Route planen*. *Show on map* in the list selects and centres that station.

**Marker colours** (`priceColors()` in `docs/core.js`, unit-tested):

| Colour | Meaning |
| --- | --- |
| Green with ✓ and a white ring | The minimum price for the selected fuel among the shown stations; every tied station. Only when the data covers the whole area. |
| Yellow → orange → red | Every higher price, ranked by the distinct prices present: the next price above the minimum is yellow, the highest is red, and a single higher price is red. Equal prices get equal colours. The scale never turns green. |
| Grey (small) | No valid price for that fuel. |

If coverage is incomplete, nothing is green: all prices go from yellow to red, and the legend says there is no confirmed cheapest. There is no marker clustering: around 200–400 stations in a 25 km radius stay readable, and clusters would hide the price colours.

**Tiles:** OpenStreetMap standard tiles (`https://tile.openstreetmap.org`) under the [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/):
- HTTPS, with the browser’s Referer;
- visible “© OpenStreetMap contributors” credit;
- only tiles in view, with no prefetching.

They are darkened with a CSS filter on the tile layer only; the attribution is not filtered. This suits a small personal site. The OSMF can restrict heavy users and gives no service guarantee. For more traffic, change `TILES` in `docs/app.js` to a dark provider such as [CARTO Dark Matter](https://github.com/CartoDB/basemap-styles), which needs a free key from carto.com (a public, domain-restricted key, not a secret), and drop `className: "tiles-dark"`.

### Design

The design uses the same tokens as the business-card site (`anastasiia-stepanenko/build.mjs`):
- background `#111111`, text `#F5F3EE`, muted text `#B9B5AC`;
- `Georgia, "Times New Roman", Times, serif` for headings, the system UI stack for body text;
- 1px outlined buttons with 6px corners, and inverted (light) fill for selected and primary actions.

There is no light mode. Amber and red appear only for warnings and errors; green, yellow, orange and red otherwise only on the map and its legend.

### API

`GET /api/prices?lat=48.14&lng=11.58&rad=17.5`. Without parameters, the default area is used (Marienplatz, 17 km).

| Field | Meaning |
| --- | --- |
| `source` | `live` or `cache` |
| `coverage` | `full` or `partial` |
| `stale` | true if older than 60 s, or partial |
| `fetchedAt` | retrieval time |
| `query` | the snapped area |
| `nextRequestInSeconds` | seconds until a new upstream request is possible |
| `stations` | normalised stations; `dist` from the query centre, `observedAt` = when that station’s price was retrieved |
| `observations` | provenance: one `{area, fetchedAt, stations}` per cached search that contributed (several for `partial` results) |
| `request` | `{radiusKm, coveredRadiusKm, complete}`: how much of the requested circle the snapped area covers. Only near the 25 km cap is `complete` false: snapping can move the centre by up to ~0.75 km, and the API maximum leaves no room to compensate |
| `error`, `retryAfterSeconds` | when fresh data was not possible: `refresh_rate_limited`/`rate_limited` (global 1/min), `client_rate_limited` (this client’s budget), `too_many_requests` (edge limiter), or `upstream_*` codes. Upstream diagnostic text is never forwarded |

### Abuse controls

The API is public. The `Origin` check and CORS only keep other *websites* from using it in visitors’ browsers. They are not authentication: any script can omit or forge `Origin`. Protection therefore does not rely on them:

1. **Edge rate limit** (`RATE_LIMITER` binding in `wrangler.toml`, Workers rate limiting): 60 requests per minute per client, counted approximately and per Cloudflare location. Requests over it get 429 before reaching the Durable Object. It is optional: `handler.js` works without the binding (remove the `[[ratelimits]]` block if the account does not support it).
2. **Strict per-client upstream budget** (in the global Durable Object, `gate.js`): a client may trigger at most 3 fresh Tankerkönig requests per 10 minutes. Requests answered from the cache are free. Beyond the budget, the client gets labelled cached/partial data or 429 `client_rate_limited`, so one client cannot keep the shared budget busy.
3. **Global gate:** at most 1 upstream request per minute for everyone, unchanged.

Clients are identified by a truncated SHA-256 of the connecting IP. It is held in memory only; neither IPs nor hashes are stored or logged. Remaining limits: many IPs (a botnet) can still use the global minute budget in turn, and responses can be scraped at the edge rate. A CAPTCHA-style check (e.g. Cloudflare Turnstile) would be the next step if that happens.

### Geocoding

Address search uses the public [Nominatim](https://nominatim.org/) API of the OpenStreetMap Foundation. No registration, key or cost is involved. It follows the [usage policy](https://operations.osmfoundation.org/policies/nominatim/):
- requests are made only on an explicit search, never for autocomplete;
- at most one request per second per visitor;
- the browser sends the site as Referer;
- the site credits © OpenStreetMap contributors (ODbL).

If traffic ever grows beyond occasional use, switch `GEOCODER` in `docs/app.js` to a dedicated provider.

### Terms

These follow [Tankerkönig's API terms](https://creativecommons.tankerkoenig.de/?page=info) and [business terms](https://onboarding.tankerkoenig.de/geschaeftsbedingungen):
- at most 1 request per minute;
- requests made on user action;
- no bulk retrieval and no passing on of datasets;
- the key is never published;
- CC BY 4.0 attribution to Tankerkönig, with the MTS-K named as the data source.

The terms also ask public sites not to filter results unless the user explicitly wants it. The open-only filter is therefore a visible, labelled checkbox that visitors can untick, and the radius is chosen by the visitor. Loading prices for the default or saved starting point when the page opens is a visitor action (opening the page); it is limited by the same global 1-request-per-minute gate.

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/` | GitHub Pages site (static): `index.html` (EN), `de/index.html` (DE), `app.js`, `core.js` |
| `build.mjs` | Generates both HTML pages from one template: `node build.mjs` |
| `worker/` | Cloudflare Worker + Durable Object (`src/index.js`, `src/handler.js` HTTP + abuse controls, `src/gate.js`, `src/query.js`, `src/geo.js`, `src/normalize.js`, `wrangler.toml`) |
| `tests/hardening.test.mjs` | Abuse controls, 25 km coverage edge case, provenance, suppressed upstream messages |
| `.github/workflows/ci.yml` | CI: unit, integration, E2E |
| `tests/*.test.mjs` | Unit tests: minimum, ties, unavailable fuels, closed stations, price validation, cache, 1/min limit, concurrency (`node --test "tests/*.test.mjs"`) |
| `tests/integration.mjs` | Runs the real Worker in workerd against a mock list.php: 40 concurrent requests → 1 upstream call, cache, origin inside the cached area, uncovered origin → 429, invalid areas → 400, stale labelling, key redaction, Origin check (`node tests/integration.mjs`, about 2.5 min) |
| `tests/e2e.mjs` | Browser test in headless Chrome with mocked API, geocoder and map tiles (`REAL_TILES=1` to load real tiles, `SHOT_DIR` for screenshots): theme and return links, map markers and colours per fuel, no requests on map/fuel interaction, marker/list selection, default location, address search, geolocation allowed/denied, origin-aware directions, radius and coverage, partial/rate-limit states, list sorting/filtering/show more, EN/DE switch, mobile overflow and touch targets (`node tests/e2e.mjs`) |
| `tools/inspect.mjs` | Local, developer-only data inspector (not published): raw JSON, table, field list, search, filters and CSV export |

## Data and fuel types

| Layer | Fuel types | Source |
| --- | --- | --- |
| MTS-K (Bundeskartellamt) | **Super E5, Super E10, Diesel** only | [MTSKraftV §4(2)](https://www.gesetze-im-internet.de/mtskraftv/BJNR059500013.html). Premium grades (Super Plus 98, Ultimate 102, V-Power, premium diesel), LPG, CNG and AdBlue are not in the reporting duty. |
| Tankerkönig API | `e5`, `e10`, `diesel` | [API documentation](https://creativecommons.tankerkoenig.de/?page=info) |
| This project | `e5`, `e10`, `diesel` | `worker/src/normalize.js` (`FUELS`) |

Key facts:
- **Missing fuels:** a station that does not sell a fuel, or has no valid price for it, gets `null` in the Worker output. The raw API may send `false`.
- **Timestamps:** the live endpoints (`list.php`, `prices.php`, `detail.php`) have no per-station price timestamp. The only time available is the retrieval time (`fetchedAt`). MTS-K receives the time of each change, but Tankerkönig exposes those times only in its historical data (CC BY-NC-SA, bulk), which this project does not use.
- **Field differences:** the raw `list.php` station fields are `id, name, brand, street, houseNumber, postCode (int), place, lat, lng, dist, e5, e10, diesel (float), isOpen`. The Worker keeps all of them, but turns `postCode` into a zero-padded string and moves prices into `prices: {e5, e10, diesel}` as integer thousandths of a euro (or `null`). `detail.php` adds `openingTimes`, `overrides`, `wholeDay` and `state`.

## Developer data inspector

`tools/inspect.mjs` is a small local web page for looking at the data. It needs no dependencies, binds to `127.0.0.1` only, and is not published. It fetches only when you click **Fetch**.

```bash
node tools/inspect.mjs                 # data from the deployed Worker (no key; shares the 60 s cache)
```

```bash
TANKERKOENIG_API_KEY=… node tools/inspect.mjs --raw   # raw list.php, plus detail.php per station
```

Then open http://127.0.0.1:8790.

- **Views:** a table (one row per station and fuel), fields (every key with its observed types and meaning) and raw JSON. You can search by name, brand, street, place or ID, filter by fuel and availability, sort by any column, and export the current rows as CSV.
- **`--raw` and the key:** `--raw` reads the key from the environment, never prints it, and redacts it from everything it shows.
- **`--raw` and the limit:** it uses the same key as the live site, whose limit is 1 request per minute. The tool therefore allows at most one upstream request per 60 s; the timestamp is kept in a temp file. That guard does not know about the site's own requests, so if the site was just used, Tankerkönig may answer with a rate-limit error. Use `--raw` sparingly, and never in a loop.

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

**Upgrading to the location-aware version:** deploy the Worker first (`npx wrangler deploy` in `worker/`). It still answers requests without parameters exactly as before, so the old page keeps working. Then merge the frontend into `main`. The new page needs the new Worker: with the old Worker, every result would be labelled incomplete. No new secrets or bindings are needed; the Durable Object migration is unchanged.

**Live backend:** `https://munich-fuel-min.stepanenkon010.workers.dev/api/prices`. If `wrangler deploy` fails with *code 10063*, the account has no workers.dev subdomain yet: open **Workers & Pages** in the Cloudflare dashboard once, then deploy again. Run all `wrangler` commands from `worker/` so `wrangler.toml` (Durable Object binding and migration) is picked up.

Check that it works: `curl -s https://munich-fuel-min.<subdomain>.workers.dev/api/prices | head -c 300`. A response with `"ok":true` and stations means the key is active. `upstream_key_rejected` means the key is not activated yet: confirm the email from Tankerkönig.

Free-plan usage is tiny: each click is one Worker request plus one Durable Object request, and at most one upstream request per minute.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request. It uses read-only permissions, no secrets and no Tankerkönig access:
- unit tests, plus a check that `docs/` matches `build.mjs`;
- the Worker integration test (workerd, mock list.php);
- the browser E2E test (headless Chrome; API, geocoder and tiles mocked).

## Development

```bash
node build.mjs                    # regenerate docs/index.html and docs/de/index.html
node --test "tests/*.test.mjs"    # unit tests
node tests/e2e.mjs                # browser test (needs Google Chrome; CHROME_PATH to override)
cd worker && npm ci && cd .. && node tests/integration.mjs   # Worker integration test (mock upstream)
```

For a local run against the real API, put `TANKERKOENIG_API_KEY=…` in `worker/.dev.vars` (git-ignored) and run `npx wrangler dev`. Do this sparingly: every request counts toward the key's limit.

## Future work (not implemented)

Historical prices, forecasting, trends by hour, and route/travel-cost optimisation. The Worker's normalised station records (stable MTS-K IDs, integer prices) are a suitable base for these.

## Attribution

Price data: Tankerkönig, CC BY 4.0, from reports to the Markttransparenzstelle für Kraftstoffe (MTS-K) of the Bundeskartellamt. No guarantee that the data is current or correct; the price at the pump applies.
