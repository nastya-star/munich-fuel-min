// Browser-side logic (docs/core.js). Station records here are hand-made test inputs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCATION, minimum, minima, eligible, byPrice, byDistance, filterList, formatMilli, formatKm, haversineKm, serverArea,
  responseCovers, localStations, directionsUrl, stationTitle, stationSubtitle, prettify, address, parseGeocode, requestPosition,
  loadSaved, save, validPrice,
} from '../docs/core.js';
import { snapArea } from '../worker/src/query.js';
import { haversineKm as serverHaversine } from '../worker/src/geo.js';

const st = (id, { open = true, lat = 48.14, lng = 11.58, dist = 1, e5 = null, e10 = null, diesel = null, name = id, brand = '' } = {}) => ({
  id, name, brand, street: 'Teststr.', houseNumber: '1', postCode: '80331', place: 'München', lat, lng, dist, isOpen: open, prices: { e5, e10, diesel },
});

const S = [
  st('a', { dist: 3.0, e5: 1849, e10: 1789, diesel: 1699 }),
  st('b', { dist: 1.2, e5: 1829, e10: null, diesel: 1719 }), // sells no E10
  st('c', { open: false, dist: 0.5, e5: 1699, e10: 1639, diesel: 1599 }), // closed and cheapest
  st('d', { dist: 7.5, e5: 1829, e10: 1789, diesel: null }), // ties: e5 with b, e10 with a
  st('e', { dist: 16.9, e5: 1899, e10: 1779, diesel: 1749 }),
];

// 1. default location
test('default starting point is Marienplatz', () => {
  assert.deepEqual([DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng, DEFAULT_LOCATION.label], [48.1374, 11.5755, 'Marienplatz, München']);
});

// 8. minimum-price calculations
test('E5/E10/Diesel minima exclude closed stations by default and keep ties', () => {
  const m = minima(S, { openOnly: true });
  assert.equal(m.e5.priceMilli, 1829);
  assert.deepEqual(m.e5.stations.map((s) => s.id), ['b', 'd']);
  assert.equal(m.e10.priceMilli, 1779);
  assert.equal(m.diesel.priceMilli, 1699);
  assert.equal(minima(S, { openOnly: false }).diesel.priceMilli, 1599);
});

test('integer comparison keeps equal thousandths tied', () => {
  assert.equal(minimum([st('p', { e5: 1789 }), st('q', { e5: 1789, dist: 0.2 })], 'e5').stations.length, 2);
});

// 9. missing / null data
test('missing, null, zero and non-integer prices are ignored; unavailable fuel gives null, not a price', () => {
  const odd = [st('x', { e5: null, e10: 0, diesel: 1.7 }), st('y', { e5: undefined }), { id: 'z', prices: null, isOpen: true }];
  assert.equal(validPrice(odd[0], 'diesel'), null);
  assert.equal(minimum(odd, 'e5'), null);
  assert.equal(minimum(odd, 'e10'), null);
  assert.equal(minimum([], 'e5'), null);
  assert.equal(eligible(S, 'e10').some((s) => s.id === 'b'), false);
});

test('missing names and brands fall back to a generic title; legal names do not become the title', () => {
  assert.equal(stationTitle({ name: '', brand: '' }, 'Petrol station'), 'Petrol station');
  assert.equal(stationTitle({ name: 'Gebrüder Neeb GmbH & Co. KG', brand: 'Neeb Tank' }, 'x'), 'Neeb Tank');
  assert.equal(stationSubtitle({ name: 'Gebrüder Neeb GmbH & Co. KG', brand: 'Neeb Tank' }), '');
  assert.equal(stationTitle({ name: 'ARAL TANKSTELLE', brand: '' }, 'x'), 'Aral Tankstelle');
  assert.equal(stationSubtitle({ name: 'BK Tankstelle Isarparkhaus', brand: 'BK' }), 'BK Tankstelle Isarparkhaus');
  assert.equal(prettify('AGIP ENI'), 'Agip ENI');
  assert.equal(address({ street: 'HAUPTSTR.', houseNumber: '1', postCode: '80331', place: 'MÜNCHEN' }), 'Hauptstr. 1, 80331 München');
  assert.equal(address({}), '');
});

test('duplicate station records appear once', () => {
  const dup = localStations([st('a', { e5: 1 }), st('a', { e5: 2 }), st('b')], DEFAULT_LOCATION, 17);
  assert.deepEqual(dup.map((s) => s.id), ['a', 'b']);
});

test('formatting: three decimals with locale separator, straight-line km', () => {
  assert.equal(formatMilli(1789, 'en'), '1.789');
  assert.equal(formatMilli(1789, 'de'), '1,789');
  assert.equal(formatMilli(1005, 'en'), '1.005');
  assert.equal(formatMilli(2000, 'de'), '2,000');
  assert.equal(formatKm(2.345, 'en'), '2.3 km');
  assert.equal(formatKm(2.345, 'de'), '2,3 km');
  assert.equal(formatKm(null, 'en'), '');
});

// 4. location-dependent distances
test('distances are recomputed from the selected origin and limited to the radius', () => {
  const stations = [st('near', { lat: 48.1374, lng: 11.5855 }), st('far', { lat: 48.1374, lng: 11.8 })];
  const fromMarienplatz = localStations(stations, DEFAULT_LOCATION, 10);
  assert.deepEqual(fromMarienplatz.map((s) => s.id), ['near']);
  assert.ok(Math.abs(fromMarienplatz[0].dist - 0.742) < 0.01);
  const fromEast = localStations(stations, { lat: 48.1374, lng: 11.79 }, 10);
  assert.deepEqual(fromEast.map((s) => s.id), ['far'], '"near" is 15.2 km from the eastern origin');
  assert.ok(Math.abs(fromEast.find((s) => s.id === 'far').dist - 0.742) < 0.01);
});

test('haversine matches a known distance and the server implementation', () => {
  const a = { lat: 48.1374, lng: 11.5755 };
  const b = { lat: 48.1554264, lng: 11.5634866 }; // Görresstraße 29
  assert.ok(Math.abs(haversineKm(a, b) - 2.18) < 0.03);
  assert.equal(haversineKm(a, b), serverHaversine(a, b));
});

// 6. dynamic radius and coverage
test('serverArea snaps like the server and contains the visitor circle', () => {
  for (const [lat, lng, r] of [[48.1374, 11.5755, 17], [48.15542, 11.56349, 5], [52.52, 13.405, 10]]) {
    const a = serverArea({ lat, lng }, r);
    assert.deepEqual(a, snapArea(lat, lng, r));
    assert.equal(String(a.lat).split('.')[1]?.length <= 2, true, 'no precise coordinates sent');
    assert.ok(haversineKm(a, { lat, lng }) + r <= a.rad + 1e-9);
  }
});

test('responseCovers: smaller radius / nearby origin reuse data; larger or partial does not', () => {
  const resp = { coverage: 'full', query: { lat: 48.14, lng: 11.58, rad: 17.5 } };
  assert.equal(responseCovers(resp, DEFAULT_LOCATION, 17), true);
  assert.equal(responseCovers(resp, DEFAULT_LOCATION, 5), true);
  assert.equal(responseCovers(resp, { lat: 48.16, lng: 11.6 }, 10), true);
  assert.equal(responseCovers(resp, { lat: 48.3, lng: 11.9 }, 10), false);
  assert.equal(responseCovers({ ...resp, coverage: 'partial' }, DEFAULT_LOCATION, 5), false);
  assert.equal(responseCovers(null, DEFAULT_LOCATION, 5), false);
});

// 5. directions URLs
test('Google Maps URL has the selected origin, the station as destination and driving mode', () => {
  const u = new URL(directionsUrl({ lat: 48.1554264, lng: 11.5634866 }, { lat: 48.161140, lng: 11.556605 }));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(u.searchParams.get('api'), '1');
  assert.equal(u.searchParams.get('origin'), '48.155426,11.563487');
  assert.equal(u.searchParams.get('destination'), '48.16114,11.556605');
  assert.equal(u.searchParams.get('travelmode'), 'driving');
  assert.throws(() => directionsUrl(null, { lat: 1, lng: 1 }));
});

// 2. custom address
test('geocoder results become selectable places; bad entries are dropped', () => {
  const places = parseGeocode([
    { display_name: 'Görresstraße 29, Maßmannbergl, Maxvorstadt, München, Bayern, 80798, Deutschland', lat: '48.1554264', lon: '11.5634866' },
    { display_name: 'Görresstraße 29, Maßmannbergl, Maxvorstadt, München', lat: '48.1554', lon: '11.5634' }, // same label -> merged
    { display_name: 'broken', lat: 'x', lon: '1' },
    { lat: '48', lon: '11' },
  ]);
  assert.deepEqual(places, [{ label: 'Görresstraße 29, Maßmannbergl, Maxvorstadt', lat: 48.1554264, lng: 11.5634866, source: 'search' }]);
  assert.deepEqual(parseGeocode(null), []);
});

// 3. geolocation success / denial
test('browser geolocation: success, denied, unavailable, unsupported', async () => {
  const ok = { getCurrentPosition: (res) => res({ coords: { latitude: 48.2, longitude: 11.6, accuracy: 30 } }) };
  assert.deepEqual(await requestPosition(ok), { lat: 48.2, lng: 11.6, accuracy: 30 });
  const denied = { getCurrentPosition: (_, rej) => rej({ code: 1 }) };
  await assert.rejects(requestPosition(denied), /denied/);
  await assert.rejects(requestPosition({ getCurrentPosition: (_, rej) => rej({ code: 2 }) }), /unavailable/);
  await assert.rejects(requestPosition({ getCurrentPosition: (_, rej) => rej({ code: 3 }) }), /timeout/);
  await assert.rejects(requestPosition(undefined), /unsupported/);
});

test('saved location round-trips; corrupt or invalid storage is ignored', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  save(storage, { lat: 48.2, lng: 11.6, label: 'X', source: 'search' }, 10);
  assert.deepEqual(loadSaved(storage), { location: { lat: 48.2, lng: 11.6, label: 'X', source: 'search' }, radius: 10 });
  mem.set('fuel-location', '{bad json');
  assert.equal(loadSaved(storage), null);
  mem.set('fuel-location', JSON.stringify({ location: { lat: 'x', lng: 1, label: 'y' }, radius: 10 }));
  assert.equal(loadSaved(storage), null);
  assert.equal(loadSaved(null), null);
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadSaved(throwing), null);
  save(throwing, DEFAULT_LOCATION, 17); // must not throw
});

// list
test('list: filter by fuel, status and search; sort by price or distance', () => {
  assert.deepEqual(filterList(S, 'e10', { status: 'open' }).map((s) => s.id), ['a', 'd', 'e']);
  assert.deepEqual(filterList(S, 'e10', { status: 'closed' }).map((s) => s.id), ['c']);
  assert.equal(filterList(S, 'e5', { status: 'all', query: 'münch' }).length, 5);
  assert.equal(filterList(S, 'e5', { status: 'all', query: 'nothing' }).length, 0);
  assert.deepEqual(byPrice(eligible(S, 'e5'), 'e5').map((s) => s.id), ['b', 'd', 'a', 'e']);
  assert.deepEqual(byDistance(eligible(S, 'e5'), 'e5').map((s) => s.id), ['b', 'a', 'd', 'e']);
});
