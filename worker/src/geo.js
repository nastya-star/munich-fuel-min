// Great-circle geometry for search areas. Distances are straight-line (not road) kilometres.

const R_EARTH_KM = 6371.0088;
const rad = (deg) => (deg * Math.PI) / 180;

/** Haversine distance in km between {lat,lng} points. */
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const round2 = (x) => Math.round(x * 100) / 100;
export const round1 = (x) => Math.round(x * 10) / 10;

// Tolerance for float noise when testing circle containment.
export const EPS_KM = 0.05;

/** True if circle `outer` ({lat,lng,rad}) fully contains circle `inner`. */
export function covers(outer, inner) {
  return haversineKm(outer, inner) + inner.rad <= outer.rad + EPS_KM;
}

/** True if the two circles overlap at all. */
export function overlaps(a, b) {
  return haversineKm(a, b) < a.rad + b.rad;
}
