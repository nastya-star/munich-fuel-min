// Munich Fuel Minimum: requests prices only when the visitor clicks Search/Refresh.
// Fuel tabs, radius and the open-only filter reuse the last response.
import { FUELS, minimum, eligible, byPrice, formatMilli, formatKm, formatBerlin, displayName, address, directionsUrl } from './core.js';

// Public URL of the Cloudflare Worker (worker/). Contains no secret.
const API_BASE = 'REPLACE_WITH_WORKER_URL';

const lang = document.documentElement.lang === 'de' ? 'de' : 'en';
const M = {
  en: {
    search: 'Show current prices',
    refresh: 'Refresh prices',
    loading: 'Requesting current prices…',
    fuel: { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' },
    cheapest: (f) => `Cheapest ${f}`,
    perLitre: '€/L',
    tie: (n) => `${n} stations share the lowest price.`,
    directions: 'Directions',
    directionsLabel: (name) => `Directions to ${name} in Google Maps (opens in a new tab)`,
    open: 'Open',
    closed: 'Closed',
    from: 'from the search centre',
    considered: (n, open) => `Based on ${n} ${n === 1 ? 'station' : 'stations'} with a valid price${open ? ' that were reported as open' : ''}.`,
    noneOpen: (f) => `No station in this area reports a valid ${f} price. Try a larger radius.`,
    noneOpenOnly: (f) => `No open station in this area reports a valid ${f} price. You can include closed stations or choose a larger radius.`,
    allTitle: (f, n) => `All ${n} stations with a ${f} price, cheapest first`,
    live: (t) => `Retrieved from Tankerkönig at ${t}.`,
    cached: (t, a) => `Cached result, retrieved at ${t} (${a} ago). New prices can be requested once a minute.`,
    stale: (t, a) => `Older result from ${t} (${a} ago) — prices may have changed.`,
    staleWhy: {
      refresh_rate_limited: (s) => `A new request is possible in ${s} s (limit: one request per minute for all visitors).`,
      upstream_rate_limited: () => 'Tankerkönig rejected the request because of its rate limit.',
      upstream_key_rejected: () => 'Tankerkönig rejected the API key (it may not be activated yet).',
      upstream_unreachable: () => 'Tankerkönig could not be reached.',
      upstream_error: () => 'Tankerkönig returned an error.',
    },
    errors: {
      not_configured: 'The price service is not set up yet (missing API key). No prices are shown.',
      backend_missing: 'The price service is not connected yet. No prices are shown.',
      rate_limited: (s) => `Prices were requested less than a minute ago by another visitor. Please try again in ${s} s.`,
      upstream_rate_limited: 'Tankerkönig rejected the request because of its rate limit. Please try again in a minute.',
      upstream_key_rejected: 'Tankerkönig rejected the API key (it may not be activated yet). No prices are shown.',
      upstream_unreachable: 'Tankerkönig could not be reached. Please try again in a minute.',
      upstream_error: 'Tankerkönig returned an error. Please try again in a minute.',
      network: 'The price service could not be reached. Check your connection and try again.',
      unknown: 'Something went wrong. No prices are shown.',
    },
    empty: 'Tankerkönig returned no stations for this search area.',
    seconds: (s) => (s < 60 ? `${s} s` : `${Math.round(s / 60)} min`),
  },
  de: {
    search: 'Aktuelle Preise anzeigen',
    refresh: 'Preise aktualisieren',
    loading: 'Aktuelle Preise werden abgefragt …',
    fuel: { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' },
    cheapest: (f) => `Günstigstes ${f}`,
    perLitre: '€/L',
    tie: (n) => `${n} Tankstellen teilen sich den niedrigsten Preis.`,
    directions: 'Route',
    directionsLabel: (name) => `Route zu ${name} in Google Maps (öffnet in einem neuen Tab)`,
    open: 'Geöffnet',
    closed: 'Geschlossen',
    from: 'vom Suchmittelpunkt',
    considered: (n, open) => `Grundlage: ${n} ${n === 1 ? 'Tankstelle' : 'Tankstellen'} mit gültigem Preis${open ? ', als geöffnet gemeldet' : ''}.`,
    noneOpenOnly: (f) => `Keine geöffnete Tankstelle in diesem Gebiet meldet einen gültigen Preis für ${f}. Sie können geschlossene Tankstellen einbeziehen oder einen größeren Radius wählen.`,
    noneOpen: (f) => `Keine Tankstelle in diesem Gebiet meldet einen gültigen Preis für ${f}. Versuchen Sie einen größeren Radius.`,
    allTitle: (f, n) => `Alle ${n} Tankstellen mit ${f}-Preis, günstigste zuerst`,
    live: (t) => `Von Tankerkönig abgerufen am ${t}.`,
    cached: (t, a) => `Zwischengespeichertes Ergebnis, abgerufen am ${t} (vor ${a}). Neue Preise können einmal pro Minute abgefragt werden.`,
    stale: (t, a) => `Älteres Ergebnis vom ${t} (vor ${a}) – die Preise können sich geändert haben.`,
    staleWhy: {
      refresh_rate_limited: (s) => `Eine neue Abfrage ist in ${s} s möglich (Limit: eine Abfrage pro Minute für alle Besucher).`,
      upstream_rate_limited: () => 'Tankerkönig hat die Abfrage wegen des Abfragelimits abgelehnt.',
      upstream_key_rejected: () => 'Tankerkönig hat den API-Schlüssel abgelehnt (möglicherweise noch nicht freigeschaltet).',
      upstream_unreachable: () => 'Tankerkönig war nicht erreichbar.',
      upstream_error: () => 'Tankerkönig hat einen Fehler gemeldet.',
    },
    errors: {
      not_configured: 'Der Preisdienst ist noch nicht eingerichtet (API-Schlüssel fehlt). Es werden keine Preise angezeigt.',
      backend_missing: 'Der Preisdienst ist noch nicht verbunden. Es werden keine Preise angezeigt.',
      rate_limited: (s) => `Vor weniger als einer Minute wurden bereits Preise abgefragt. Bitte versuchen Sie es in ${s} s erneut.`,
      upstream_rate_limited: 'Tankerkönig hat die Abfrage wegen des Abfragelimits abgelehnt. Bitte versuchen Sie es in einer Minute erneut.',
      upstream_key_rejected: 'Tankerkönig hat den API-Schlüssel abgelehnt (möglicherweise noch nicht freigeschaltet). Es werden keine Preise angezeigt.',
      upstream_unreachable: 'Tankerkönig war nicht erreichbar. Bitte versuchen Sie es in einer Minute erneut.',
      upstream_error: 'Tankerkönig hat einen Fehler gemeldet. Bitte versuchen Sie es in einer Minute erneut.',
      network: 'Der Preisdienst ist nicht erreichbar. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
      unknown: 'Etwas ist schiefgelaufen. Es werden keine Preise angezeigt.',
    },
    empty: 'Tankerkönig hat für dieses Suchgebiet keine Tankstellen geliefert.',
    seconds: (s) => (s < 60 ? `${s} s` : `${Math.round(s / 60)} min`),
  },
}[lang];

const $ = (id) => document.getElementById(id);
const els = { button: $('search'), openOnly: $('open-only'), radius: $('radius'), status: $('status'), result: $('result'), list: $('list'), tabs: [...document.querySelectorAll('[data-fuel]')] };

let data = null; // last successful response
let fuel = 'e5';

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

function setStatus(parts, tone = 'info') {
  els.status.className = `status ${tone}`;
  els.status.replaceChildren(...parts.filter(Boolean).map((p) => el('p', {}, p)));
}

function options() {
  return { openOnly: els.openOnly.checked, maxDistKm: Number(els.radius.value) || Infinity };
}

function stationCard(s, { big = false } = {}) {
  const name = displayName(s);
  return el(
    'li',
    { class: big ? 'station top' : 'station' },
    el('div', { class: 'who' },
      el('strong', {}, name),
      s.brand && s.brand.toLowerCase() !== s.name.toLowerCase() ? el('span', { class: 'brand' }, s.brand) : null,
      el('span', { class: 'addr' }, address(s)),
      el('span', { class: 'meta' }, `${formatKm(s.dist, lang)} ${M.from}`, ' · ', el('span', { class: s.isOpen ? 'open' : 'closed' }, s.isOpen ? M.open : M.closed)),
    ),
    big ? null : el('span', { class: 'price' }, formatMilli(s.prices[fuel], lang)),
    el('a', { class: 'btn small', href: directionsUrl(s), target: '_blank', rel: 'noopener', 'aria-label': M.directionsLabel(name) }, M.directions),
  );
}

function render() {
  els.tabs.forEach((t) => {
    const on = t.dataset.fuel === fuel;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  if (!data) return;
  const opts = options();
  const label = M.fuel[fuel];
  const min = minimum(data.stations, fuel, opts);
  if (!data.stations.length) {
    els.result.replaceChildren(el('p', { class: 'empty' }, M.empty));
    els.list.replaceChildren();
    return;
  }
  if (!min) {
    els.result.replaceChildren(el('p', { class: 'empty' }, opts.openOnly ? M.noneOpenOnly(label) : M.noneOpen(label)));
    els.list.replaceChildren();
    return;
  }
  els.result.replaceChildren(
    el('h2', {}, M.cheapest(label)),
    el('p', { class: 'big' }, formatMilli(min.priceMilli, lang), el('span', { class: 'unit' }, ` ${M.perLitre}`)),
    min.stations.length > 1 ? el('p', { class: 'tie' }, M.tie(min.stations.length)) : null,
    el('ul', { class: 'stations' }, ...min.stations.map((s) => stationCard(s, { big: true }))),
    el('p', { class: 'basis' }, M.considered(min.considered, opts.openOnly)),
  );
  const all = byPrice(eligible(data.stations, fuel, opts), fuel);
  els.list.replaceChildren(
    el('details', {}, el('summary', { class: 'btn' }, M.allTitle(label, all.length)), el('ul', { class: 'stations' }, ...all.map((s) => stationCard(s)))),
  );
}

function describe(body) {
  const t = formatBerlin(body.fetchedAt, lang);
  const age = M.seconds(body.ageSeconds);
  if (body.stale) {
    const why = M.staleWhy[body.error];
    return { parts: [M.stale(t, age), why ? why(body.retryAfterSeconds) : null], tone: 'warn' };
  }
  return { parts: [body.source === 'live' ? M.live(t) : M.cached(t, age)], tone: 'info' };
}

async function search() {
  if (!/^https:\/\//.test(API_BASE)) {
    setStatus([M.errors.backend_missing], 'error');
    return;
  }
  els.button.disabled = true;
  setStatus([M.loading], 'info');
  try {
    const res = await fetch(`${API_BASE}/api/prices`, { cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (body && body.ok === true && Array.isArray(body.stations)) {
      data = body;
      const d = describe(body);
      setStatus(d.parts, d.tone);
      els.button.textContent = M.refresh;
      render();
    } else {
      const code = body?.error;
      const msg = M.errors[code];
      setStatus([typeof msg === 'function' ? msg(body.retryAfterSeconds ?? 60) : msg || M.errors.unknown, data ? M.stale(formatBerlin(data.fetchedAt, lang), M.seconds(Math.round((Date.now() - Date.parse(data.fetchedAt)) / 1000))) : null], 'error');
    }
  } catch {
    setStatus([M.errors.network], 'error');
  } finally {
    els.button.disabled = false;
  }
}

els.button.addEventListener('click', search);
els.openOnly.addEventListener('change', render);
els.radius.addEventListener('change', render);
els.tabs.forEach((t) =>
  t.addEventListener('click', () => {
    fuel = t.dataset.fuel;
    render();
  }),
);
// Arrow-key navigation between fuel tabs.
els.tabs.forEach((t, i) =>
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const next = els.tabs[(i + d + els.tabs.length) % els.tabs.length];
    next.focus();
    next.click();
  }),
);
render();
