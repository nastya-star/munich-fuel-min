// Minimum selection and formatting. Station records here are hand-made test inputs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minimum, eligible, byPrice, formatMilli } from '../docs/core.js';

const st = (id, { open = true, dist = 1, e5 = null, e10 = null, diesel = null } = {}) => ({
  id, name: id, brand: '', street: '', houseNumber: '', postCode: '80331', place: 'München', lat: 48.1, lng: 11.5, dist, isOpen: open,
  prices: { e5, e10, diesel },
});

const S = [
  st('a', { dist: 3.0, e5: 1849, e10: 1789, diesel: 1699 }),
  st('b', { dist: 1.2, e5: 1829, e10: null, diesel: 1719 }), // sells no E10
  st('c', { open: false, dist: 0.5, e5: 1699, e10: 1639, diesel: 1599 }), // closed and cheapest
  st('d', { dist: 7.5, e5: 1829, e10: 1789, diesel: null }), // ties: e5 with b, e10 with a
  st('e', { dist: 16.9, e5: 1899, e10: 1779, diesel: 1749 }),
];

test('closed stations are excluded by default', () => {
  assert.equal(minimum(S, 'diesel').priceMilli, 1699);
  assert.deepEqual(minimum(S, 'diesel').stations.map((s) => s.id), ['a']);
});

test('closed stations are included only when the filter is off', () => {
  assert.equal(minimum(S, 'diesel', { openOnly: false }).priceMilli, 1599);
});

test('all stations tied at the minimum are returned, nearest first', () => {
  const m = minimum(S, 'e5');
  assert.equal(m.priceMilli, 1829);
  assert.deepEqual(m.stations.map((s) => s.id), ['b', 'd']);
});

test('stations without a price for the fuel are ignored', () => {
  assert.equal(eligible(S, 'e10').some((s) => s.id === 'b'), false);
  assert.equal(minimum(S, 'e10').priceMilli, 1779);
});

test('radius filter uses the reported distance', () => {
  assert.equal(minimum(S, 'e10', { maxDistKm: 10 }).priceMilli, 1789);
  assert.deepEqual(minimum(S, 'e10', { maxDistKm: 10 }).stations.map((s) => s.id), ['a', 'd']);
});

test('unavailable fuel type gives no minimum instead of an invented one', () => {
  const onlyDiesel = [st('x', { diesel: 1700 }), st('y', { open: false, e5: 1800 })];
  assert.equal(minimum(onlyDiesel, 'e5'), null);
  assert.equal(minimum([], 'e5'), null);
});

test('integer comparison: 1.789 vs 1.7890000001 style input cannot split a tie', () => {
  // Prices arrive as integers from the backend, so equal thousandths compare equal.
  const m = minimum([st('p', { e5: 1789 }), st('q', { e5: 1789, dist: 0.2 })], 'e5');
  assert.equal(m.stations.length, 2);
});

test('price list is sorted by price, then distance', () => {
  assert.deepEqual(byPrice(eligible(S, 'e5'), 'e5').map((s) => s.id), ['b', 'd', 'a', 'e']);
});

test('formatMilli shows three decimals with locale separator', () => {
  assert.equal(formatMilli(1789, 'en'), '1.789');
  assert.equal(formatMilli(1789, 'de'), '1,789');
  assert.equal(formatMilli(1005, 'en'), '1.005');
  assert.equal(formatMilli(2000, 'de'), '2,000');
});
