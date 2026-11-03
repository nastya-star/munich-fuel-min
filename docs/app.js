// Munich Fuel Minimum – page logic.
// Prices are requested when the page opens, when a starting point is confirmed, when the radius
// grows beyond the data already loaded, and on Refresh. Never per keystroke, never on a timer.
// Fuel, open-only, list search/sort/filter work on the data already loaded.
import {
  FUELS, RADII, DEFAULT_LOCATION, serverArea, responseCovers, localStations, minima, byPrice, byDistance, filterList,
  formatMilli, formatKm, formatTime, stationTitle, stationSubtitle, address, directionsUrl, parseGeocode, requestPosition,
  loadSaved, save, validLocation, priceColors, validPrice,
} from './core.js';

// Public URL of the Cloudflare Worker (worker/). Contains no secret.
const API_BASE = 'https://munich-fuel-min.stepanenkon010.workers.dev';
// Address search: OpenStreetMap Nominatim, used only on explicit search (max 1 request/second,
// no autocomplete, per https://operations.osmfoundation.org/policies/nominatim/).
const GEOCODER = 'https://nominatim.openstreetmap.org/search';
const LIST_PAGE = 20;
// Map tiles: OpenStreetMap standard tiles (https://operations.osmfoundation.org/policies/tiles/),
// darkened with CSS on the tile layer only. Only tiles in view are loaded (no prefetching).
// To switch provider (e.g. CARTO Dark Matter with a free key), change this object; see README.
const TILES = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19, className: 'tiles-dark' };

const lang = document.documentElement.lang === 'de' ? 'de' : 'en';
const M = {
  en: {
    fuel: { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' },
    perLitre: '€/L',
    lowest: 'lowest price',
    lowestPartial: 'lowest found · incomplete',
    noPrice: 'no price',
    myLocation: 'My location',
    loading: 'Loading prices…',
    updated: (t) => `Updated ${t}`,
    cached: (t) => `Cached ${t}`,
    outdated: (t) => `Data may be outdated (${t})`,
    refreshIn: (s) => `Refresh available in ${s} s`,
    locating: 'Finding your location…',
    searching: 'Searching…',
    geoDenied: 'Location access was not allowed. Your starting point is unchanged – you can type an address instead.',
    geoUnavailable: 'Your location could not be determined. Your starting point is unchanged.',
    geoUnsupported: 'This browser cannot share its location. Please type an address.',
    noPlace: 'No matching place found in Germany. Try a street, town or postcode.',
    geocodeError: 'Address search is unavailable right now. Please try again in a moment.',
    emptyQuery: 'Please enter an address, place or postcode.',
    pickOne: 'Choose a place:',
    recent: 'Recent',
    chosen: (l) => `Starting point: ${l}`,
    straight: 'straight line',
    open: 'Open',
    closed: 'Closed',
    route: 'Route planen',
    routeLabel: (n) => `Directions to ${n} in Google Maps, by car from your starting point (opens in a new tab)`,
    tie: (n) => `${n} stations share the lowest price.`,
    noneOpen: (f) => `No open station in this radius reports a ${f} price. Try a larger radius or include closed stations.`,
    none: (f) => `No station in this radius reports a ${f} price. Try a larger radius.`,
    noStations: 'No petrol stations were reported in this radius. Try a larger radius.',
    partial: 'Incomplete: a new request is not possible right now, so only stations from an earlier search nearby are shown. The cheapest station in your area may be missing.',
    count: (n) => `${n} ${n === 1 ? 'station' : 'stations'}`,
    moreTitle: (n) => `Compare stations (${n})`,
    station: 'Petrol station',
    selected: 'Selected station',
    best: 'Best station',
    showCheapest: '← Show the cheapest',
    showOnMap: 'Show on map',
    retrieved: (t) => `Price retrieved ${t}`,
    noPriceFor: (f) => `No ${f} price reported`,
    legendMin: (p) => `Cheapest ${p}`,
    legendAbove: (a, b) => (a === b ? `Higher ${a}` : `Higher ${a} → ${b}`),
    legendPartial: (a, b) => `${a} → ${b} · incomplete data, no confirmed cheapest`,
    legendNone: 'no price',
    mapUnavailable: 'The map could not be loaded. Prices and the list still work.',
    errors: {
      rate_limited: (s) => `Prices for this area can be requested again in ${s} s (one request per minute for all visitors).`,
      refresh_rate_limited: (s) => `New prices can be requested in ${s} s.`,
      not_configured: 'The price service is not set up. No prices are shown.',
      upstream_rate_limited: 'Tankerkönig is limiting requests right now. Please try again in a minute.',
      upstream_key_rejected: 'Tankerkönig rejected the request. No prices are shown.',
      upstream_unreachable: 'Tankerkönig could not be reached. Please try again in a minute.',
      upstream_error: 'Tankerkönig returned an error. Please try again in a minute.',
      outside_coverage: 'Prices are only available for locations in Germany.',
      invalid_area: 'This location could not be used. Please choose another.',
      invalid_radius: 'This radius is not supported.',
      network: 'The price service could not be reached. Check your connection and try again.',
      unknown: 'Something went wrong. No prices are shown.',
    },
  },
  de: {
    fuel: { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' },
    perLitre: '€/L',
    lowest: 'niedrigster Preis',
    lowestPartial: 'niedrigster gefundener · unvollständig',
    noPrice: 'kein Preis',
    myLocation: 'Mein Standort',
    loading: 'Preise werden geladen …',
    updated: (t) => `Aktualisiert ${t}`,
    cached: (t) => `Zwischengespeichert ${t}`,
    outdated: (t) => `Daten möglicherweise veraltet (${t})`,
    refreshIn: (s) => `Aktualisierung in ${s} s möglich`,
    locating: 'Standort wird ermittelt …',
    searching: 'Suche läuft …',
    geoDenied: 'Der Standortzugriff wurde nicht erlaubt. Ihr Startpunkt bleibt unverändert – Sie können stattdessen eine Adresse eingeben.',
    geoUnavailable: 'Ihr Standort konnte nicht ermittelt werden. Ihr Startpunkt bleibt unverändert.',
    geoUnsupported: 'Dieser Browser kann keinen Standort bereitstellen. Bitte geben Sie eine Adresse ein.',
    noPlace: 'Kein passender Ort in Deutschland gefunden. Versuchen Sie eine Straße, einen Ort oder eine PLZ.',
    geocodeError: 'Die Adresssuche ist gerade nicht verfügbar. Bitte versuchen Sie es gleich noch einmal.',
    emptyQuery: 'Bitte geben Sie eine Adresse, einen Ort oder eine PLZ ein.',
    pickOne: 'Ort auswählen:',
    recent: 'Zuletzt verwendet',
    chosen: (l) => `Startpunkt: ${l}`,
    straight: 'Luftlinie',
    open: 'Geöffnet',
    closed: 'Geschlossen',
    route: 'Route planen',
    routeLabel: (n) => `Route zu ${n} in Google Maps, mit dem Auto ab Ihrem Startpunkt (öffnet in einem neuen Tab)`,
    tie: (n) => `${n} Tankstellen teilen sich den niedrigsten Preis.`,
    noneOpen: (f) => `Keine geöffnete Tankstelle in diesem Umkreis meldet einen Preis für ${f}. Wählen Sie einen größeren Umkreis oder beziehen Sie geschlossene Tankstellen ein.`,
    none: (f) => `Keine Tankstelle in diesem Umkreis meldet einen Preis für ${f}. Wählen Sie einen größeren Umkreis.`,
    noStations: 'In diesem Umkreis wurden keine Tankstellen gemeldet. Wählen Sie einen größeren Umkreis.',
    partial: 'Unvollständig: Eine neue Abfrage ist gerade nicht möglich, daher werden nur Tankstellen aus einer früheren Suche in der Nähe angezeigt. Die günstigste Tankstelle in Ihrem Gebiet kann fehlen.',
    count: (n) => `${n} ${n === 1 ? 'Tankstelle' : 'Tankstellen'}`,
    moreTitle: (n) => `Tankstellen vergleichen (${n})`,
    station: 'Tankstelle',
    selected: 'Ausgewählte Tankstelle',
    best: 'Beste Tankstelle',
    showCheapest: '← Günstigste anzeigen',
    showOnMap: 'Auf der Karte',
    retrieved: (t) => `Preis abgerufen ${t}`,
    noPriceFor: (f) => `Kein Preis für ${f} gemeldet`,
    legendMin: (p) => `Günstigster ${p}`,
    legendAbove: (a, b) => (a === b ? `Teurer ${a}` : `Teurer ${a} → ${b}`),
    legendPartial: (a, b) => `${a} → ${b} · unvollständige Daten, kein bestätigter Tiefstpreis`,
    legendNone: 'kein Preis',
    mapUnavailable: 'Die Karte konnte nicht geladen werden. Preise und Liste funktionieren weiterhin.',
    errors: {
      rate_limited: (s) => `Preise für dieses Gebiet können in ${s} s erneut abgefragt werden (eine Abfrage pro Minute für alle Besucher).`,
      refresh_rate_limited: (s) => `Neue Preise können in ${s} s abgefragt werden.`,
      not_configured: 'Der Preisdienst ist nicht eingerichtet. Es werden keine Preise angezeigt.',
      upstream_rate_limited: 'Tankerkönig begrenzt gerade die Abfragen. Bitte versuchen Sie es in einer Minute erneut.',
      upstream_key_rejected: 'Tankerkönig hat die Abfrage abgelehnt. Es werden keine Preise angezeigt.',
      upstream_unreachable: 'Tankerkönig war nicht erreichbar. Bitte versuchen Sie es in einer Minute erneut.',
      upstream_error: 'Tankerkönig hat einen Fehler gemeldet. Bitte versuchen Sie es in einer Minute erneut.',
      outside_coverage: 'Preise gibt es nur für Orte in Deutschland.',
      invalid_area: 'Dieser Ort kann nicht verwendet werden. Bitte wählen Sie einen anderen.',
      invalid_radius: 'Dieser Umkreis wird nicht unterstützt.',
      network: 'Der Preisdienst ist nicht erreichbar. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
      unknown: 'Etwas ist schiefgelaufen. Es werden keine Preise angezeigt.',
    },
  },
}[lang];

// ---- DOM helpers (all text goes through textContent; null/undefined/false children are skipped) --

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  return fill(n, ...children, true);
}
/** Replaces (or, with a trailing `true`, appends) children, ignoring null/undefined/false. */
function fill(node, ...children) {
  const append = children[children.length - 1] === true;
  const kids = (append ? children.slice(0, -1) : children).flat().filter((c) => c !== null && c !== undefined && c !== false && c !== '');
  if (append) node.append(...kids);
  else node.replaceChildren(...kids);
  return node;
}

let storage = null;
try { storage = window.localStorage; storage.getItem('x'); } catch { storage = null; }

const els = {
  form: $('loc-form'), input: $('loc-input'), submit: $('loc-submit'), results: $('loc-results'), msg: $('loc-msg'), geo: $('geo'),
  radios: [...document.querySelectorAll('input[name=radius]')], openOnly: $('open-only'), status: $('status'), refresh: $('refresh'), note: $('note'),
  cards: [...document.querySelectorAll('.card[data-fuel]')], best: $('best'), more: $('more'), moreTitle: $('more-title'),
  bestH: $('best-h'), mapEl: $('map'), legend: $('legend'),
  listQ: $('list-q'), listFuel: $('list-fuel'), listSort: $('list-sort'), listStatus: $('list-status'), listCount: $('list-count'), list: $('list'), showMore: $('show-more'),
};

const saved = loadSaved(storage);
const state = {
  location: saved?.location ?? { ...DEFAULT_LOCATION },
  radius: saved?.radius ?? 17,
  fuel: 'e5',
  response: null, // last successful response that covers (or partially covers) the current area
  error: null, // {code, retry}
  loading: false,
  listLimit: LIST_PAGE,
  nextAt: 0, // time (ms) when a new upstream request becomes possible
  selectedId: null, // station chosen on the map or in the list
};
let inflight = null;
let geocodeBusyUntil = 0;
let ticker = null;

const locationLabel = (l) => (l.source === 'geo' ? M.myLocation : l.label);

// ---- data loading ---------------------------------------------------------------------------------

async function load() {
  const area = serverArea(state.location, state.radius);
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  state.loading = true;
  state.error = null;
  // Results of a different area must not stay on screen while the new area loads.
  if (!responseCovers(state.response, state.location, state.radius)) state.response = null;
  render();
  try {
    const url = new URL(`${API_BASE}/api/prices`);
    url.search = new URLSearchParams({ lat: String(area.lat), lng: String(area.lng), rad: String(area.rad) }).toString();
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    if (ctrl !== inflight) return;
    if (body && body.ok === true && Array.isArray(body.stations)) {
      state.response = body;
      state.error = body.error ? { code: body.error, retry: body.retryAfterSeconds } : null;
      state.nextAt = Date.now() + (body.nextRequestInSeconds || 0) * 1000;
    } else {
      // Never keep showing results that do not cover the newly requested area.
      if (!responseCovers(state.response, state.location, state.radius)) state.response = null;
      state.error = { code: body?.error || 'unknown', retry: body?.retryAfterSeconds };
      state.nextAt = Date.now() + (body?.retryAfterSeconds || 0) * 1000;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (!responseCovers(state.response, state.location, state.radius)) state.response = null;
    state.error = { code: 'network' };
  } finally {
    if (ctrl === inflight) {
      state.loading = false;
      inflight = null;
      render();
    }
  }
}

// ---- location selection ---------------------------------------------------------------------------

function selectLocation(loc) {
  if (!validLocation(loc)) return;
  state.location = { lat: loc.lat, lng: loc.lng, label: loc.label, source: loc.source || 'search' };
  els.input.value = locationLabel(state.location);
  hideResults();
  if (loc.source === 'search') remember(loc);
  save(storage, state.location, state.radius);
  fill(els.msg, M.chosen(locationLabel(state.location)));
  els.msg.className = 'msg full';
  state.listLimit = LIST_PAGE;
  load(); // a confirmed selection updates results immediately
}

function recentList() {
  try {
    const v = JSON.parse(storage?.getItem('fuel-recent') || '[]');
    return Array.isArray(v) ? v.filter(validLocation).slice(0, 5) : [];
  } catch { return []; }
}
function remember(loc) {
  const list = [{ lat: loc.lat, lng: loc.lng, label: loc.label, source: 'search' }, ...recentList().filter((r) => r.label !== loc.label)].slice(0, 5);
  try { storage?.setItem('fuel-recent', JSON.stringify(list)); } catch {}
}

function showResults(items, heading) {
  fill(
    els.results,
    heading ? el('li', { class: 'hint', role: 'presentation' }, heading) : null,
    items.map((it) => el('li', {}, el('button', { type: 'button', 'data-lat': it.lat, 'data-lng': it.lng }, it.label))),
  );
  els.results.hidden = items.length === 0;
  els.results.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => selectLocation(items[i])));
}
function hideResults() {
  els.results.hidden = true;
  fill(els.results);
}

function setMsg(text, isError = false) {
  fill(els.msg, text);
  els.msg.className = `msg full${isError ? ' err' : ''}`;
}

async function geocode(q) {
  const now = Date.now();
  if (now < geocodeBusyUntil) return; // at most one search per second
  geocodeBusyUntil = now + 1100;
  setMsg(M.searching);
  els.submit.disabled = true;
  try {
    const url = new URL(GEOCODER);
    url.search = new URLSearchParams({ q, format: 'jsonv2', limit: '5', countrycodes: 'de', 'accept-language': lang }).toString();
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const places = parseGeocode(await res.json());
    if (places.length === 0) setMsg(M.noPlace, true);
    else if (places.length === 1) selectLocation(places[0]);
    else {
      setMsg('');
      showResults(places, M.pickOne);
      els.results.querySelector('button')?.focus();
    }
  } catch {
    setMsg(M.geocodeError, true);
  } finally {
    els.submit.disabled = false;
  }
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q) return setMsg(M.emptyQuery, true);
  if (q === locationLabel(state.location)) return load();
  const hit = recentList().find((r) => r.label.toLowerCase() === q.toLowerCase());
  if (hit) return selectLocation(hit);
  geocode(q);
});

// Typing only filters places you have used before (stored in this browser); no network requests.
els.input.addEventListener('input', () => {
  const q = els.input.value.trim().toLowerCase();
  const items = q ? recentList().filter((r) => r.label.toLowerCase().includes(q)) : [];
  if (items.length) showResults(items, M.recent);
  else hideResults();
});
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && !els.results.hidden) {
    e.preventDefault();
    els.results.querySelector('button')?.focus();
  } else if (e.key === 'Escape') hideResults();
});
els.results.addEventListener('keydown', (e) => {
  const buttons = [...els.results.querySelectorAll('button')];
  const i = buttons.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = buttons[i + (e.key === 'ArrowDown' ? 1 : -1)];
    (next || els.input).focus();
  } else if (e.key === 'Escape') {
    hideResults();
    els.input.focus();
  }
});

els.geo.addEventListener('click', async () => {
  setMsg(M.locating);
  els.geo.disabled = true;
  try {
    const p = await requestPosition(navigator.geolocation); // permission is requested only here
    selectLocation({ lat: p.lat, lng: p.lng, label: M.myLocation, source: 'geo' });
  } catch (e) {
    const text = e.message === 'denied' ? M.geoDenied : e.message === 'unsupported' ? M.geoUnsupported : M.geoUnavailable;
    setMsg(text, true);
  } finally {
    els.geo.disabled = false;
  }
});

// ---- options --------------------------------------------------------------------------------------

els.radios.forEach((r) =>
  r.addEventListener('change', () => {
    state.radius = Number(r.value);
    save(storage, state.location, state.radius);
    state.listLimit = LIST_PAGE;
    // A smaller radius inside the loaded area is answered locally; a larger one needs new data.
    if (responseCovers(state.response, state.location, state.radius)) render();
    else load();
  }),
);
els.openOnly.addEventListener('change', () => {
  els.listStatus.value = els.openOnly.checked ? 'open' : 'all';
  render();
});
els.cards.forEach((c) => c.addEventListener('click', () => setFuel(c.dataset.fuel)));
els.listFuel.addEventListener('change', () => setFuel(els.listFuel.value));
for (const x of [els.listSort, els.listStatus]) x.addEventListener('change', () => { state.listLimit = LIST_PAGE; renderList(); });
els.listQ.addEventListener('input', () => { state.listLimit = LIST_PAGE; renderList(); });
els.showMore.addEventListener('click', () => { state.listLimit += LIST_PAGE; renderList(); });
els.refresh.addEventListener('click', () => load());

function setFuel(f) {
  if (!FUELS.includes(f)) return;
  state.fuel = f; // map markers are restyled in place: zoom and position are kept
  els.listFuel.value = f;
  state.listLimit = LIST_PAGE;
  render();
}

// ---- rendering ------------------------------------------------------------------------------------

function current() {
  const r = state.response;
  if (!r) return { stations: [], partial: false };
  return { stations: localStations(r.stations, state.location, state.radius), partial: r.coverage !== 'full' || !responseCovers(r, state.location, state.radius) };
}

/** Stations shown on the map and coloured together: the radius plus the open-only filter. */
const onMap = (stations) => (els.openOnly.checked ? stations.filter((s) => s.isOpen === true) : stations);

function render() {
  renderStatus();
  const { stations, partial } = current();
  const opts = { openOnly: els.openOnly.checked };
  const mins = minima(stations, opts);
  els.cards.forEach((c) => {
    const f = c.dataset.fuel;
    c.setAttribute('aria-pressed', String(f === state.fuel));
    const m = mins[f];
    fill(
      c,
      el('span', { class: 'k' }, M.fuel[f]),
      el('span', { class: 'p' }, state.response && m ? [formatMilli(m.priceMilli, lang), el('small', {}, ` ${M.perLitre}`)] : '–'),
      el('span', { class: 'h' }, !state.response ? '' : m ? (partial ? M.lowestPartial : M.lowest) : M.noPrice),
    );
  });
  renderNote(partial && !!state.response);
  const visible = onMap(stations);
  const colors = priceColors(visible, state.fuel, { complete: !partial });
  if (state.selectedId && !visible.some((s) => s.id === state.selectedId)) state.selectedId = null;
  renderMap(visible, colors);
  renderLegend(colors);
  renderDetail(stations, visible, mins[state.fuel], opts);
  renderList(colors);
}

function renderStatus() {
  clearInterval(ticker);
  const r = state.response;
  const parts = [];
  if (state.loading) parts.push(el('span', { class: 'pill' }, M.loading));
  else if (r) {
    const t = formatTime(r.fetchedAt, lang);
    if (r.stale) parts.push(el('span', { class: 'pill warn' }, M.outdated(t)));
    else parts.push(el('span', { class: 'pill' }, r.source === 'live' ? M.updated(t) : M.cached(t)));
  }
  const wait = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
  const showWait = !state.loading && wait > 0 && (!r || r.stale || state.error);
  if (showWait) parts.push(el('span', { class: 'cd' }, M.refreshIn(wait)));
  fill(els.status, parts);
  els.refresh.disabled = state.loading || showWait;
  // Local countdown for the label only; it never triggers a request.
  if (showWait) ticker = setInterval(() => (Date.now() >= state.nextAt ? renderStatus() : updateCountdown()), 1000);
}
/** One notice area: incomplete coverage and/or the error that prevented fresh data. */
function renderNote(partial) {
  const texts = [];
  if (partial) texts.push(M.partial);
  // When older data is shown, the status line already says when a refresh is possible.
  if (state.error && !state.loading && !(state.response && state.error.code === 'refresh_rate_limited')) {
    const msg = M.errors[state.error.code] || M.errors.unknown;
    const wait = Math.max(1, Math.ceil((state.nextAt - Date.now()) / 1000));
    texts.push(typeof msg === 'function' ? msg(wait) : msg);
  }
  fill(els.note, texts.join(' '));
  els.note.className = state.response ? 'note' : 'note err';
}
function updateCountdown() {
  const cd = els.status.querySelector('.cd');
  if (cd) cd.textContent = M.refreshIn(Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000)));
}

function routeButton(s, cls = 'btn solid') {
  const title = stationTitle(s, M.station);
  return el('a', { class: cls, href: directionsUrl(state.location, s), target: '_blank', rel: 'noopener', 'aria-label': M.routeLabel(title) }, M.route);
}
const statusBadge = (s) => el('span', { class: s.isOpen ? 'badge' : 'badge closed' }, s.isOpen ? M.open : M.closed);
const priceText = (s) => (validPrice(s, state.fuel) === null ? M.noPriceFor(M.fuel[state.fuel]) : `${formatMilli(s.prices[state.fuel], lang)} ${M.perLitre}`);

/** Name, address, straight-line distance, status (and optionally retrieval time) of one station. */
function stationLines(s, { time = false } = {}) {
  return [
    el('div', {}, el('p', { class: 'name' }, stationTitle(s, M.station)), stationSubtitle(s) ? el('p', { class: 'meta' }, stationSubtitle(s)) : null),
    el('p', { class: 'meta' }, address(s)),
    el('p', { class: 'meta' }, `${formatKm(s.dist, lang)} (${M.straight}) · `, statusBadge(s)),
    time && state.response ? el('p', { class: 'meta' }, M.retrieved(formatTime(state.response.fetchedAt, lang))) : null,
  ];
}

function renderDetail(stations, visible, min, opts) {
  const label = M.fuel[state.fuel];
  const sel = state.selectedId ? visible.find((s) => s.id === state.selectedId) : null;
  fill(els.bestH, sel ? M.selected : M.best);
  if (!state.response) return fill(els.best); // loading or error: the status line / notice explains why
  if (sel) {
    const p = validPrice(sel, state.fuel);
    return fill(
      els.best,
      el(
        'div',
        { class: 'best' },
        el('div', { class: 'price' }, p === null ? '–' : formatMilli(p, lang), el('small', {}, ` ${M.perLitre} · ${label}`)),
        p === null ? el('p', { class: 'sel-note' }, M.noPriceFor(label)) : null,
        el('ul', { class: 'stns' }, el('li', {}, stationLines(sel, { time: true }), routeButton(sel))),
      ),
      el('button', { type: 'button', class: 'linkbtn', id: 'show-cheapest' }, M.showCheapest),
    );
  }
  if (stations.length === 0) return fill(els.best, el('p', { class: 'empty' }, M.noStations));
  if (!min) return fill(els.best, el('p', { class: 'empty' }, opts.openOnly ? M.noneOpen(label) : M.none(label)));
  // The price is shown once; every station tied at that price is listed underneath.
  fill(
    els.best,
    el(
      'div',
      { class: 'best' },
      el('div', { class: 'price' }, formatMilli(min.priceMilli, lang), el('small', {}, ` ${M.perLitre} · ${label}`)),
      min.stations.length > 1 ? el('p', { class: 'tie' }, M.tie(min.stations.length)) : null,
      el('ul', { class: 'stns' }, min.stations.map((s) => el('li', {}, stationLines(s, { time: true }), routeButton(s)))),
    ),
  );
}
els.best.addEventListener('click', (e) => {
  if (e.target.id === 'show-cheapest') selectStation(null);
});

function renderList(colors) {
  const { stations } = current();
  const rows = filterList(stations, state.fuel, { status: els.listStatus.value, query: els.listQ.value });
  const sorted = els.listSort.value === 'dist' ? byDistance(rows, state.fuel) : byPrice(rows, state.fuel);
  fill(els.moreTitle, M.moreTitle(sorted.length));
  fill(els.listCount, M.count(sorted.length));
  fill(
    els.list,
    sorted.slice(0, state.listLimit).map((s) => {
      const c = colors?.byId.get(s.id); // undefined when the station is not on the map (e.g. closed while "open only")
      return el(
        'li',
        { class: s.id === state.selectedId ? 'row on' : 'row', 'data-id': s.id },
        el('span', { class: 'rp' }, c ? el('span', { class: 'dot', style: `--c:${c.color}`, 'aria-hidden': 'true' }) : null, formatMilli(s.prices[state.fuel], lang)),
        el('div', { class: 'who' }, el('b', {}, stationTitle(s, M.station)), el('p', { class: 'meta' }, address(s)), el('p', { class: 'meta' }, `${formatKm(s.dist, lang)} · `, statusBadge(s))),
        el('div', { class: 'acts' }, c && map ? el('button', { type: 'button', class: 'btn small', 'data-show': s.id }, M.showOnMap) : null, routeButton(s, 'btn small')),
      );
    }),
  );
  els.showMore.hidden = sorted.length <= state.listLimit;
}
els.list.addEventListener('click', (e) => {
  const id = e.target.closest('[data-show]')?.getAttribute('data-show');
  if (id) selectStation(id, { pan: true });
});

// ---- map --------------------------------------------------------------------------------------------
// One Leaflet map. Fuel changes restyle the existing markers (view unchanged); the view is only
// fitted when the starting point or radius changes. Nothing here requests prices.

const map = (() => {
  if (!window.L || !els.mapEl) {
    if (els.mapEl) fill(els.mapEl, el('p', { class: 'empty' }, M.mapUnavailable));
    return null;
  }
  const m = window.L.map(els.mapEl, { zoomControl: true, attributionControl: true, minZoom: 6, maxZoom: TILES.maxZoom });
  window.L.tileLayer(TILES.url, { maxZoom: TILES.maxZoom, attribution: TILES.attribution, className: TILES.className }).addTo(m);
  m.setView([state.location.lat, state.location.lng], 11);
  return m;
})();
const mapState = { markers: new Map(), stations: new Map(), origin: null, circle: null, fitKey: '', idsKey: '' };

function icon(c, selected) {
  const size = c.tier === 'min' ? 24 : c.tier === 'none' ? 12 : 16;
  return window.L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<span class="mk ${c.tier}${selected ? ' sel' : ''}" style="--c:${c.color}">${c.tier === 'min' ? '✓' : ''}</span>`,
  });
}
const zOf = (c) => (c.tier === 'min' ? 1000 : c.tier === 'none' ? -500 : Math.round((1 - c.t) * 400));

function popupContent(id) {
  const s = mapState.stations.get(id);
  if (!s) return '';
  const p = validPrice(s, state.fuel);
  return el(
    'div',
    { class: 'pop' },
    el('p', { class: 'name' }, stationTitle(s, M.station)),
    el('p', { class: 'pp' }, p === null ? M.noPriceFor(M.fuel[state.fuel]) : [formatMilli(p, lang), el('small', {}, ` ${M.perLitre} · ${M.fuel[state.fuel]}`)]),
    el('p', { class: 'meta' }, address(s)),
    el('p', { class: 'meta' }, `${formatKm(s.dist, lang)} (${M.straight}) · `, statusBadge(s)),
    state.response ? el('p', { class: 'meta' }, M.retrieved(formatTime(state.response.fetchedAt, lang))) : null,
    routeButton(s, 'btn solid'),
  );
}

function renderMap(visible, colors) {
  if (!map) return;
  const L = window.L;
  const o = state.location;
  // Starting point and search circle.
  if (!mapState.origin) {
    mapState.origin = L.marker([o.lat, o.lng], { icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<span class="mk origin"></span>' }), keyboard: false, interactive: false, zIndexOffset: 2000 }).addTo(map);
    mapState.circle = L.circle([o.lat, o.lng], { radius: state.radius * 1000, color: '#F5F3EE', weight: 1, opacity: 0.6, fill: false, interactive: false }).addTo(map);
  }
  mapState.origin.setLatLng([o.lat, o.lng]);
  mapState.circle.setLatLng([o.lat, o.lng]).setRadius(state.radius * 1000);
  const fitKey = `${o.lat},${o.lng},${state.radius}`;
  if (fitKey !== mapState.fitKey) {
    mapState.fitKey = fitKey;
    map.fitBounds(mapState.circle.getBounds(), { padding: [8, 8] });
  }
  // Markers: rebuilt only when the set of stations changes; otherwise restyled in place.
  const idsKey = visible.map((s) => s.id).join(',');
  if (idsKey !== mapState.idsKey) {
    mapState.idsKey = idsKey;
    for (const mk of mapState.markers.values()) mk.remove();
    mapState.markers.clear();
    mapState.stations.clear();
    for (const s of visible) {
      const mk = L.marker([s.lat, s.lng], { keyboard: false, riseOnHover: true });
      mk.bindPopup(() => popupContent(s.id), { maxWidth: 260, autoPanPadding: [16, 16] });
      mk.on('click', () => selectStation(s.id));
      mk.addTo(map);
      mapState.markers.set(s.id, mk);
    }
  }
  for (const s of visible) mapState.stations.set(s.id, s); // current distances and prices
  for (const [id, mk] of mapState.markers) {
    const c = colors.byId.get(id);
    const s = mapState.stations.get(id);
    mk.setIcon(icon(c, id === state.selectedId));
    mk.setZIndexOffset(zOf(c));
    const node = mk.getElement();
    if (node) {
      node.setAttribute('title', `${stationTitle(s, M.station)}: ${priceText(s)}`);
      node.setAttribute('data-id', id);
      node.setAttribute('data-tier', c.tier);
      node.setAttribute('data-color', c.color);
    }
    if (mk.isPopupOpen()) mk.setPopupContent(popupContent(id));
  }
}

function renderLegend(colors) {
  if (!state.response || !colors.distinct.length) return fill(els.legend);
  const f = (p) => `${formatMilli(p, lang)} ${M.perLitre}`;
  const dot = (cls, c, txt) => el('span', { class: 'mk ' + cls, style: `--c:${c}`, 'aria-hidden': 'true' }, txt || null);
  const items = [];
  if (colors.complete) {
    items.push(el('span', { class: 'it' }, dot('min', '#22C55E', '✓'), M.legendMin(f(colors.min))));
    if (colors.distinct.length > 1) items.push(el('span', { class: 'it' }, el('span', { class: 'grad', 'aria-hidden': 'true' }), M.legendAbove(f(colors.distinct[1]), f(colors.max))));
  } else {
    items.push(el('span', { class: 'it' }, el('span', { class: 'grad', 'aria-hidden': 'true' }), M.legendPartial(f(colors.min), f(colors.max))));
  }
  if ([...colors.byId.values()].some((c) => c.tier === 'none')) items.push(el('span', { class: 'it' }, dot('none', '#8C8981'), M.legendNone));
  fill(els.legend, items);
}

function selectStation(id, { pan = false } = {}) {
  state.selectedId = id;
  render();
  if (!map) return;
  if (!id) return map.closePopup();
  const mk = mapState.markers.get(id);
  if (!mk) return;
  if (pan) {
    map.setView(mk.getLatLng(), Math.max(map.getZoom(), 14));
    els.mapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (!mk.isPopupOpen()) mk.openPopup();
}

// ---- start ----------------------------------------------------------------------------------------

els.input.value = locationLabel(state.location);
if (!RADII.includes(state.radius)) state.radius = 17;
els.radios.forEach((r) => (r.checked = Number(r.value) === state.radius));
render();
load();
