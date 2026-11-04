// Price histogram and savings ranges (docs/core.js). Prices are integer thousandths of a euro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceStats, stationEntry, savings, litreCents, formatEuroRange, formatEuroCents, statsCache, maxBins } from '../docs/core.js';

const st = (id, price, fuel = 'e5') => ({ id, prices: { e5: null, e10: null, diesel: null, [fuel]: price } });
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('bins: equal width, aligned, non-overlapping; percentages are station shares', () => {
  // 40 prices 1.700 … 1.895 (step 5 milli): range 195, limit 13 bins → width 20 milli (2 ct)
  const s = priceStats(Array.from({ length: 40 }, (_, i) => st(`s${i}`, 1700 + 5 * i)), 'e5');
  assert.equal(s.n, 40);
  assert.equal(s.width, 20);
  assert.equal(s.start, 1700);
  assert.equal(s.counts.length, 10);
  assert.ok(s.counts.length >= 8 && s.counts.length <= maxBins(40));
  assert.equal(sum(s.counts), 40);
  assert.deepEqual(s.counts, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
  assert.ok(s.pct.every((p) => p === 10));
  assert.ok(Math.abs(sum(s.pct) - 100) < 1e-9);
});

test('a price on a bin boundary belongs to the upper bin; precision is 0.1 ct (no rounding)', () => {
  const s = priceStats([st('a', 1700), st('b', 1719), st('c', 1720), st('d', 1739), st('e', 1740), st('f', 1799), st('g', 1800), st('h', 1801)], 'e5');
  assert.equal(s.width, 20);
  const bin = (id) => stationEntry(s, id).bin;
  assert.equal(bin('a'), 0); assert.equal(bin('b'), 0); // 1.700 and 1.719 → [1.700, 1.720)
  assert.equal(bin('c'), 1); assert.equal(bin('d'), 1); // 1.720 on the boundary → next bin
  assert.equal(bin('e'), 2);
  assert.equal(bin('g'), 5); assert.equal(bin('h'), 5);
  for (const id of 'abcdefgh') {
    const e = stationEntry(s, id);
    assert.ok(e.price >= s.start + e.bin * s.width && e.price < s.start + (e.bin + 1) * s.width, id);
  }
});

test('the selected station is counted in its own bin; ties share bin and percentage', () => {
  const s = priceStats([st('a', 1689), st('b', 1689), st('c', 1729), st('d', 1749)], 'e5');
  assert.equal(stationEntry(s, 'a').bin, stationEntry(s, 'b').bin);
  assert.equal(s.counts[stationEntry(s, 'a').bin], 2);
  assert.equal(s.pct[stationEntry(s, 'a').bin], 50);
  assert.deepEqual(s.distinct, [1689, 1729, 1749]);
});

test('missing, zero, non-integer and duplicate prices are excluded', () => {
  const s = priceStats([st('a', 1700), st('b', null), st('c', 0), st('d', 1.7), st('e', 1800), st('a', 1999), { id: 'x' }], 'e5');
  assert.equal(s.n, 2);
  assert.equal(stationEntry(s, 'b'), null);
  assert.equal(stationEntry(s, 'a').price, 1700, 'first record of an id wins');
  assert.equal(priceStats([st('a', null)], 'e5').n, 0);
});

test('other fuels are ignored', () => {
  const s = priceStats([st('a', 1700, 'diesel'), st('b', 1800, 'e5')], 'e5');
  assert.equal(s.n, 1);
  assert.equal(stationEntry(s, 'a'), null);
});

test('zero range and one station: a single bin with 100 %', () => {
  for (const s of [priceStats([st('a', 1789)], 'e5'), priceStats([st('a', 1789), st('b', 1789), st('c', 1789)], 'e5')]) {
    assert.deepEqual(s.counts, [s.n]);
    assert.deepEqual(s.pct, [100]);
    const e = stationEntry(s, 'a');
    assert.equal(e.bin, 0);
    assert.equal(e.cheaper, null);
    assert.equal(e.dearer, null);
    assert.deepEqual(savings(e, 40), { cheaper: null, dearer: null });
  }
});

test('small samples use few bins; wide ranges never exceed 14 bins', () => {
  assert.ok(priceStats([st('a', 1600), st('b', 1999)], 'e5').counts.length <= 5);
  const wide = priceStats(Array.from({ length: 400 }, (_, i) => st(`s${i}`, 1000 + i * 7)), 'e5');
  assert.ok(wide.counts.length <= 14 && wide.counts.length >= 8, String(wide.counts.length));
  assert.equal(sum(wide.counts), 400);
});

test('savings: X = L(p − highest below), Y = L(p − lowest), A = L(lowest above − p), B = L(highest − p)', () => {
  // prices 1.659, 1.689, 1.689, 1.729 (selected), 1.749, 1.799
  const s = priceStats([st('a', 1659), st('b', 1689), st('c', 1689), st('d', 1729), st('e', 1749), st('f', 1799)], 'e5');
  const e = stationEntry(s, 'd');
  assert.deepEqual(e.cheaper, [40, 70]); // equal-price stations excluded: nearest cheaper is 1.689
  assert.deepEqual(e.dearer, [20, 70]);
  assert.deepEqual(savings(e, 40), { cheaper: [160, 280], dearer: [80, 280] }); // €1.60–€2.80, €0.80–€2.80
  assert.deepEqual(savings(e, 5), { cheaper: [20, 35], dearer: [10, 35] });
  assert.deepEqual(savings(e, 100), { cheaper: [400, 700], dearer: [200, 700] });
});

test('cheapest: no cheaper alternative; most expensive: no dearer alternative; ties excluded', () => {
  const s = priceStats([st('a', 1689), st('b', 1689), st('c', 1729), st('d', 1749), st('e', 1749)], 'e5');
  assert.equal(stationEntry(s, 'a').cheaper, null);
  assert.deepEqual(stationEntry(s, 'a').dearer, [40, 60]);
  assert.equal(stationEntry(s, 'e').dearer, null);
  assert.deepEqual(stationEntry(s, 'e').cheaper, [20, 60]);
});

test('money: rounded once at the end, from exact thousandths (no early rounding of litre prices)', () => {
  assert.equal(litreCents(35, 3), 11); // 35 × 0.003 € = 0.105 € → 0.11 €
  assert.equal(litreCents(5, 1), 1); // 0.005 € → 0.01 €
  assert.equal(litreCents(15, 7), 11); // 0.105 € → 0.11 €
  assert.equal(litreCents(40, 1), 4);
  assert.equal(formatEuroRange([160, 280], 'en'), '€1.60–€2.80');
  assert.equal(formatEuroRange([160, 280], 'de'), '1,60–2,80 €');
  assert.equal(formatEuroRange([80, 80], 'en'), '€0.80');
  assert.equal(formatEuroRange([123456, 123456], 'de'), '1.234,56 €');
  assert.equal(formatEuroCents(5, 'en'), '€0.05');
});

test('cache: statistics are built once per dataset and rebuilt only when it changes', () => {
  let calls = 0;
  const cache = statsCache((stations, fuel) => { calls++; return priceStats(stations, fuel); });
  const data = [st('a', 1700), st('b', 1750), st('c', 1800)];
  const key = (fuel, open = true, r = 20, loc = '48.1,11.5') => `${loc}|${r}|${fuel}|${open}`;
  const first = cache.get(1, key('e5'), data, 'e5');
  for (let i = 0; i < 50; i++) assert.equal(cache.get(1, key('e5'), data, 'e5'), first, 'selections / slider: same object');
  assert.equal(calls, 1);
  cache.get(1, key('e10'), data, 'e10'); // fuel
  cache.get(1, key('e5', false), data, 'e5'); // open-only filter
  cache.get(1, key('e5', true, 10), data, 'e5'); // radius
  cache.get(1, key('e5', true, 20, '48.2,11.6'), data, 'e5'); // location
  assert.equal(calls, 5);
  assert.equal(cache.get(1, key('e10'), data, 'e10').fuel, 'e10');
  assert.equal(calls, 5, 'switching back is a cache hit');
  const fresh = cache.get(2, key('e5'), [st('a', 1600)], 'e5'); // new snapshot: refresh / partial replaced
  assert.equal(calls, 6);
  assert.notEqual(fresh, first);
  assert.equal(fresh.n, 1);
  cache.get(2, key('e10'), data, 'e10');
  assert.equal(calls, 7, 'old snapshot entries were dropped');
  assert.equal(cache.builds, 7);
});
