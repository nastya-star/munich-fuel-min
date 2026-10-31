// Converts a Tankerkönig list.php response into the records the website uses.
// Prices become integer thousandths of a euro (1.789 €/L -> 1789); anything that
// is not a plausible price (missing, false, null, 0, NaN, out of range) becomes null.

export const FUELS = ['e5', 'e10', 'diesel'];

// Plausibility bounds for a litre of fuel in Germany, in thousandths of a euro.
export const MIN_PRICE_MILLI = 500; // 0.500 €/L
export const MAX_PRICE_MILLI = 5000; // 5.000 €/L

export function priceToMilli(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const milli = Math.round(value * 1000);
  return milli >= MIN_PRICE_MILLI && milli <= MAX_PRICE_MILLI ? milli : null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function normalizeStations(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const id = str(s.id);
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    if (!id || seen.has(id) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    seen.add(id);
    out.push({
      id,
      name: str(s.name),
      brand: str(s.brand),
      street: str(s.street),
      houseNumber: str(s.houseNumber),
      postCode: str(s.postCode) ? str(s.postCode).padStart(5, '0') : '',
      place: str(s.place),
      lat,
      lng,
      dist: typeof s.dist === 'number' && Number.isFinite(s.dist) ? s.dist : null,
      isOpen: s.isOpen === true,
      prices: Object.fromEntries(FUELS.map((f) => [f, priceToMilli(s[f])])),
    });
  }
  return out;
}

// Maps Tankerkönig's `message` (ok: false) to a stable error code. Never includes the key.
export function classifyUpstreamError(httpStatus, message) {
  const m = String(message || '').toLowerCase();
  if (httpStatus === 429 || /rate|limit|zu viele|too many/.test(m)) return 'upstream_rate_limited';
  if (/key|apikey|schlüssel|nicht freigeschaltet|deaktiviert|existiert nicht/.test(m)) return 'upstream_key_rejected';
  return 'upstream_error';
}
