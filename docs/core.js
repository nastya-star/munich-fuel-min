// Pure logic shared by the page (app.js) and the tests. Prices are integer thousandths of a
// euro (1789 = 1.789 €/L); null means "no valid price". Distances are straight-line km.

export const FUELS = ['e5', 'e10', 'diesel'];
export const RADII = [5, 10, 17];
export const DEFAULT_LOCATION = Object.freeze({ lat: 48.1374, lng: 11.5755, label: 'Marienplatz, München', source: 'default' });
export const MAX_RADIUS_KM = 25;

// ---- geometry ---------------------------------------------------------------------------------

const R_EARTH_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Area sent to the server: centre snapped to 0.01° (~1 km) so the precise location never leaves
 * the browser, radius enlarged by the snapping distance so the circle still contains the
 * visitor's own circle. Matches worker/src/query.js snapArea().
 */
export function serverArea(origin, radiusKm) {
  const lat = round2(origin.lat);
  const lng = round2(origin.lng);
  const shift = haversineKm(origin, { lat, lng });
  return { lat, lng, rad: Math.min(MAX_RADIUS_KM, Math.ceil((radiusKm + shift) * 2 - 1e-9) / 2) };
}

/** True if a response with complete coverage of `query` also covers origin+radius completely. */
export function responseCovers(response, origin, radiusKm) {
  if (!response || response.coverage !== 'full' || !response.query) return false;
  return haversineKm(response.query, origin) + radiusKm <= response.query.rad + 0.05;
}

/** Stations with distance recomputed from `origin`, limited to `radiusKm`, duplicates removed. */
export function localStations(stations, origin, radiusKm) {
  const seen = new Set();
  const out = [];
  for (const s of stations || []) {
    if (!s || seen.has(s.id) || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    seen.add(s.id);
    const dist = haversineKm(origin, s);
    if (dist <= radiusKm) out.push({ ...s, dist });
  }
  return out;
}

// ---- prices -----------------------------------------------------------------------------------

export function validPrice(s, fuel) {
  const p = s?.prices?.[fuel];
  return Number.isInteger(p) && p > 0 ? p : null;
}

/** Stations that may compete for the minimum of `fuel`. */
export function eligible(stations, fuel, { openOnly = true } = {}) {
  return stations.filter((s) => validPrice(s, fuel) !== null && (!openOnly || s.isOpen === true));
}

const nameKey = (s) => (s.brand || s.name || '').toLowerCase();

/** Sorted by price, then distance, then name, so the order is stable. */
export function byPrice(stations, fuel) {
  return [...stations].sort((a, b) => (validPrice(a, fuel) ?? Infinity) - (validPrice(b, fuel) ?? Infinity) || (a.dist ?? Infinity) - (b.dist ?? Infinity) || nameKey(a).localeCompare(nameKey(b)));
}

export function byDistance(stations, fuel) {
  return [...stations].sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity) || (validPrice(a, fuel) ?? Infinity) - (validPrice(b, fuel) ?? Infinity));
}

/** p*_f = min price over eligible stations, with every station tied at that price (nearest first). */
export function minimum(stations, fuel, options) {
  const pool = byPrice(eligible(stations, fuel, options), fuel);
  if (pool.length === 0) return null;
  const priceMilli = pool[0].prices[fuel];
  return { priceMilli, stations: pool.filter((s) => s.prices[fuel] === priceMilli), considered: pool.length };
}

export function minima(stations, options) {
  return Object.fromEntries(FUELS.map((f) => [f, minimum(stations, f, options)]));
}

/** List filter for the comparison table. */
export function filterList(stations, fuel, { status = 'open', query = '' } = {}) {
  const q = query.trim().toLocaleLowerCase('de');
  return stations.filter(
    (s) =>
      validPrice(s, fuel) !== null &&
      (status === 'all' || (status === 'open' ? s.isOpen === true : s.isOpen !== true)) &&
      (!q || [s.name, s.brand, s.place, s.street, s.postCode].some((v) => String(v || '').toLocaleLowerCase('de').includes(q))),
  );
}

// ---- formatting -------------------------------------------------------------------------------

/** 1789 -> "1.789" (en) / "1,789" (de). Integer arithmetic only. */
export function formatMilli(milli, lang) {
  const euros = Math.floor(milli / 1000);
  const rest = String(milli % 1000).padStart(3, '0');
  return `${euros}${lang === 'de' ? ',' : '.'}${rest}`;
}

export function formatKm(km, lang) {
  if (typeof km !== 'number' || !Number.isFinite(km)) return '';
  return `${km.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

/** "18:12" in Europe/Berlin. */
export function formatTime(iso, lang) {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// ---- station naming ---------------------------------------------------------------------------

const LEGAL = /\b(gmbh|mbh|ag|kg|ohg|gbr|ug|e\.\s?k\.?|co\.?|inh\.?|c\/o|ltd|se)\b/i;
export const isLegalName = (s) => LEGAL.test(s || '');

/** "ARAL" -> "Aral", "AGIP ENI" -> "Agip ENI"; short all-caps words (BK, JET, ENI) stay as they are. */
export function prettify(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t || t !== t.toLocaleUpperCase('de')) return t;
  return t
    .split(/(\s|-|\/)/)
    .map((w) => (/^[A-ZÄÖÜ]{2,3}$/.test(w) ? w : w.toLocaleLowerCase('de').replace(/^\p{L}/u, (c) => c.toLocaleUpperCase('de'))))
    .join('');
}

/** Consumer-facing title: the brand if there is one, otherwise the name; never a bare legal entity if avoidable. */
export function stationTitle(s, fallback) {
  const brand = prettify(s.brand);
  const name = prettify(s.name);
  if (brand) return brand;
  if (name) return name;
  return fallback;
}

/** Optional second line: the station's own name when it adds information and is not a company name. */
export function stationSubtitle(s) {
  const name = prettify(s.name);
  const brand = prettify(s.brand);
  if (!name || !brand || isLegalName(name)) return '';
  if (name.toLocaleLowerCase('de') === brand.toLocaleLowerCase('de')) return '';
  return name;
}

export function address(s) {
  const street = [prettify(s.street), s.houseNumber].filter(Boolean).join(' ');
  const town = [s.postCode, prettify(s.place)].filter(Boolean).join(' ');
  return [street, town].filter(Boolean).join(', ');
}

// ---- directions -------------------------------------------------------------------------------

const coord = (p) => `${Number(p.lat.toFixed(6))},${Number(p.lng.toFixed(6))}`;

/** Google Maps directions from the selected origin to the station, by car (documented Maps URLs format). */
export function directionsUrl(origin, station) {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) throw new Error('origin required');
  const url = new URL('https://www.google.com/maps/dir/');
  url.search = new URLSearchParams({ api: '1', origin: coord(origin), destination: coord(station), travelmode: 'driving' }).toString();
  return url.toString();
}

// ---- locations --------------------------------------------------------------------------------

export function validLocation(l) {
  return !!l && Number.isFinite(l.lat) && Number.isFinite(l.lng) && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180 && typeof l.label === 'string';
}

/** Nominatim (format=jsonv2) results -> [{label, lat, lng}], invalid entries dropped, duplicates merged. */
export function parseGeocode(results) {
  if (!Array.isArray(results)) return [];
  const out = [];
  for (const r of results) {
    const lat = Number(r?.lat);
    const lng = Number(r?.lon);
    const parts = String(r?.display_name || '').split(',').map((p) => p.trim()).filter(Boolean);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !parts.length) continue;
    // Nominatim lists the house number first ("29, Görresstraße, …"); show "Görresstraße 29, …".
    if (parts.length > 1 && /^\d+\s?[a-z]?(-\d+)?$/i.test(parts[0])) parts.splice(0, 2, `${parts[1]} ${parts[0]}`);
    const label = parts.slice(0, 3).join(', ');
    if (!out.some((o) => o.label === label)) out.push({ label, lat, lng, source: 'search' });
  }
  return out.slice(0, 5);
}

/** Wraps navigator.geolocation; resolves {lat,lng} or rejects with 'denied' | 'unavailable' | 'timeout' | 'unsupported'. */
export function requestPosition(geolocation, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') return reject(new Error('unsupported'));
    geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err && err.code === 1 ? 'denied' : err && err.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60_000 },
    );
  });
}

const STORE_KEY = 'fuel-location';

export function loadSaved(storage) {
  try {
    const v = JSON.parse(storage?.getItem(STORE_KEY) || 'null');
    if (v && validLocation(v.location) && RADII.includes(v.radius)) return v;
  } catch {}
  return null;
}

export function save(storage, location, radius) {
  try {
    storage?.setItem(STORE_KEY, JSON.stringify({ location: { lat: location.lat, lng: location.lng, label: location.label, source: location.source }, radius }));
  } catch {}
}
