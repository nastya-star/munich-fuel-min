// Validates and normalises the search area requested by a visitor.
//
// Privacy: the centre is snapped to a 0.01° grid (roughly 1 km) and the radius is enlarged by the
// snapping distance, so the snapped circle still contains the requested one. The server and its
// cache therefore never see or store a precise visitor location. The frontend already sends
// snapped values; snapping here enforces it for any client.

import { haversineKm, round2 } from './geo.js';

// Marienplatz, München: the default search centre.
export const DEFAULT_AREA = Object.freeze({ lat: 48.1374, lng: 11.5755, rad: 20 });
export const MAX_RADIUS_KM = 25; // Tankerkönig list.php maximum
export const MIN_RADIUS_KM = 1;
// Tankerkönig covers Germany only; a generous bounding box.
export const BOUNDS = Object.freeze({ minLat: 47.2, maxLat: 55.1, minLng: 5.8, maxLng: 15.1 });

/** Snaps a point/radius as described above. Radius rounded up to 0.5 km, capped at the API maximum. */
export function snapArea(lat, lng, radKm) {
  const s = { lat: round2(lat), lng: round2(lng) };
  const shift = haversineKm({ lat, lng }, s);
  return { ...s, rad: Math.min(MAX_RADIUS_KM, Math.ceil((radKm + shift) * 2 - 1e-9) / 2) };
}

/**
 * How much of the requested circle the snapped area really contains. Near the 25 km cap the
 * snapping shift cannot be compensated, so the covered radius is smaller than requested; the
 * response says so instead of implying complete coverage.
 */
export function requestCoverage(lat, lng, radKm, area) {
  const shift = haversineKm({ lat, lng }, area);
  const coveredRadiusKm = Math.min(radKm, Math.floor((area.rad - shift) * 100) / 100);
  return { radiusKm: radKm, coveredRadiusKm, complete: coveredRadiusKm >= radKm };
}

const ALLOWED_PARAMS = new Set(['lat', 'lng', 'rad']);
const MAX_PARAM_LENGTH = 32;

/**
 * @param {URLSearchParams} sp
 * @returns {{ok: true, area: {lat:number,lng:number,rad:number}, request: {radiusKm:number, coveredRadiusKm:number, complete:boolean}} | {ok: false, error: string}}
 */
export function parseArea(sp) {
  for (const [k, v] of sp) if (!ALLOWED_PARAMS.has(k) || v.length > MAX_PARAM_LENGTH) return { ok: false, error: 'invalid_area' };
  if ([...sp.keys()].length !== new Set(sp.keys()).size) return { ok: false, error: 'invalid_area' };
  // No parameters: the default area, snapped exactly as the page snaps it, so requests with and
  // without parameters share one cache entry (48.14, 11.58, 20.5 km contains Marienplatz + 20 km).
  if (!sp.has('lat') && !sp.has('lng') && !sp.has('rad')) {
    const area = snapArea(DEFAULT_AREA.lat, DEFAULT_AREA.lng, DEFAULT_AREA.rad);
    return { ok: true, area, request: requestCoverage(DEFAULT_AREA.lat, DEFAULT_AREA.lng, DEFAULT_AREA.rad, area) };
  }
  const num = (k) => (sp.has(k) && sp.get(k).trim() !== '' ? Number(sp.get(k)) : NaN);
  const lat = num('lat');
  const lng = num('lng');
  const rad = sp.has('rad') ? num('rad') : DEFAULT_AREA.rad;
  if (![lat, lng, rad].every(Number.isFinite)) return { ok: false, error: 'invalid_area' };
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return { ok: false, error: 'outside_coverage' };
  if (rad < MIN_RADIUS_KM || rad > MAX_RADIUS_KM) return { ok: false, error: 'invalid_radius' };
  const area = snapArea(lat, lng, rad);
  return { ok: true, area, request: requestCoverage(lat, lng, rad, area) };
}
