// Validates and normalises the search area requested by a visitor.
//
// Privacy: the centre is snapped to a 0.01° grid (roughly 1 km) and the radius is enlarged by the
// snapping distance, so the snapped circle still contains the requested one. The server and its
// cache therefore never see or store a precise visitor location. The frontend already sends
// snapped values; snapping here enforces it for any client.

import { haversineKm, round2 } from './geo.js';

// Marienplatz, München: the default search centre.
export const DEFAULT_AREA = Object.freeze({ lat: 48.1374, lng: 11.5755, rad: 17 });
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
 * @param {URLSearchParams} sp
 * @returns {{ok: true, area: {lat:number,lng:number,rad:number}} | {ok: false, error: string}}
 */
export function parseArea(sp) {
  // No parameters: the default area, exactly (backwards compatible with older pages).
  if (!sp.has('lat') && !sp.has('lng') && !sp.has('rad')) return { ok: true, area: { ...DEFAULT_AREA } };
  const num = (k) => (sp.has(k) && sp.get(k).trim() !== '' ? Number(sp.get(k)) : NaN);
  const lat = num('lat');
  const lng = num('lng');
  const rad = sp.has('rad') ? num('rad') : DEFAULT_AREA.rad;
  if (![lat, lng, rad].every(Number.isFinite)) return { ok: false, error: 'invalid_area' };
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return { ok: false, error: 'outside_coverage' };
  if (rad < MIN_RADIUS_KM || rad > MAX_RADIUS_KM) return { ok: false, error: 'invalid_radius' };
  return { ok: true, area: snapArea(lat, lng, rad) };
}
