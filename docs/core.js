// Pure logic shared by the page (app.js) and the tests. Prices are integer
// thousandths of a euro (1789 = 1.789 €/L); null means "no valid price".

export const FUELS = ['e5', 'e10', 'diesel'];

/** Stations that may compete for the minimum of `fuel`. */
export function eligible(stations, fuel, { openOnly = true, maxDistKm = Infinity } = {}) {
  return stations.filter(
    (s) =>
      Number.isInteger(s.prices?.[fuel]) &&
      s.prices[fuel] > 0 &&
      (!openOnly || s.isOpen === true) &&
      (maxDistKm === Infinity || (typeof s.dist === 'number' && s.dist <= maxDistKm)),
  );
}

/** Sorted by price, then distance, then name, so the list is stable. */
export function byPrice(stations, fuel) {
  return [...stations].sort(
    (a, b) => a.prices[fuel] - b.prices[fuel] || (a.dist ?? Infinity) - (b.dist ?? Infinity) || a.name.localeCompare(b.name),
  );
}

/** p*_f = min price over eligible stations, with every station tied at that price. */
export function minimum(stations, fuel, options) {
  const pool = byPrice(eligible(stations, fuel, options), fuel);
  if (pool.length === 0) return null;
  const priceMilli = pool[0].prices[fuel];
  return { priceMilli, stations: pool.filter((s) => s.prices[fuel] === priceMilli), considered: pool.length };
}

/** 1789 -> "1.789" (en) / "1,789" (de). Integer arithmetic only. */
export function formatMilli(milli, lang) {
  const euros = Math.floor(milli / 1000);
  const rest = String(milli % 1000).padStart(3, '0');
  return `${euros}${lang === 'de' ? ',' : '.'}${rest}`;
}

export function formatKm(km, lang) {
  return typeof km === 'number' ? `${km.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : '';
}

export function formatBerlin(iso, lang) {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

const cap = (s) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-/(.])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s);

export function displayName(s) {
  return cap(s.name) || cap(s.brand) || '—';
}

export function address(s) {
  const street = [cap(s.street), s.houseNumber].filter(Boolean).join(' ');
  const town = [s.postCode, cap(s.place)].filter(Boolean).join(' ');
  return [street, town].filter(Boolean).join(', ');
}

/** Google Maps directions to the station's reported coordinates. */
export function directionsUrl(s) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lng}`)}`;
}
