import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeTripParam, resolveTrip} from '../server/wallet-trip.mjs';
import {localPlaces} from '../site/region.js';
import {guestCards} from '../site/guest-cards.js';

const catalogList = JSON.parse(await readFile(new URL('../static/catalog.json', import.meta.url), 'utf8'));
const catalog = new Map(catalogList.map(entry => [entry.id, entry]));
const fixture = JSON.parse(await readFile(new URL('./fixtures/trip.json', import.meta.url), 'utf8'));

const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const options = {catalog, places: localPlaces, cards: guestCards, id: fixture.id};

const compact = {
  v: 1, s: '2027-07-10', e: '2027-07-12', p: 0, a: 2, k: [4, 9], d: 0, c: 'sfl',
  r: [
    ['2027-07-10', 590, 680, 'sfl-murmliwasser', '', 1, 0],
    ['2027-07-10', 810, 870, 'sfl-playin', '', 0, 34],
    ['2027-07-10', 1080, 1230, 'sfl-shop-399198', '', 0, null],
    ['2027-07-11', 615, 705, 'sfl-wolfsee', 'Papa', 0, 0],
    ['2027-07-11', 600, 690, 'sfl-hoeg-spiel', 'Mama', 1, 0]
  ]
};

function shape(value) {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, shape(value[key])]));
  return typeof value;
}

test('round-trips a compact trip from the static catalogue', () => {
  const decoded = decodeTripParam(encode(compact));
  assert.deepEqual(decoded, compact);
  const trip = resolveTrip(decoded, options);
  assert.equal(trip.days.length, 3);
  assert.deepEqual(trip.days.map(day => day.label), ['Sa., 10.7.', 'So., 11.7.', 'Mo., 12.7.']);
  assert.equal(trip.days[2].stops.length, 0);
  assert.deepEqual(trip.days[1].stops.map(stop => stop.group), ['Mama', 'Papa'], 'stops are sorted by start time');
  assert.equal(trip.family.summary, '2 Erwachsene · 2 Kinder');
  assert.equal(trip.card.name, 'Super. Sommer. Card.');
  assert.equal(trip.total, 34);
  assert.equal(trip.totalLabel, 'Summe der bekannten Eintrittspreise');
});

test('takes content from the catalogue, not from the link', () => {
  const trip = resolveTrip(decodeTripParam(encode(compact)), options);
  const first = trip.days[0].stops[0];
  const source = catalog.get('sfl-murmliwasser');
  assert.equal(first.title, source.title);
  assert.equal(first.latitude, source.location[1]);
  assert.equal(first.booking, 'pass');
  assert.equal(first.note, source.passes[0].note);
  assert.equal(trip.days[0].stops[2].bookingLink, catalog.get('sfl-shop-399198').bookingLink);
  assert.equal(trip.days[0].stops[1].bookingLink, null);
});

test('resolved trip has the same shape as the fixture', () => {
  const trip = resolveTrip(decodeTripParam(encode(compact)), options);
  const nullable = value => JSON.parse(JSON.stringify(shape(value)).replaceAll('"object"', '"string"'));
  // null fields (card link, group, price) show up as "object" — compare against the fixture with the same rule.
  assert.deepEqual(nullable(trip), nullable(fixture));
  assert.deepEqual(Object.keys(trip).sort(), Object.keys(fixture).sort());
  assert.deepEqual(Object.keys(trip.days[0].stops[0]).sort(), Object.keys(fixture.days[0].stops[0]).sort());
});

test('drops a guest-card claim the catalogue does not support', () => {
  const trip = resolveTrip(decodeTripParam(encode({...compact, r: [['2027-07-10', 810, 870, 'sfl-playin', '', 1, 34]]})), options);
  assert.equal(trip.days[0].stops[0].booking, 'onsite');
  const winter = resolveTrip(decodeTripParam(encode({...compact, s: '2027-01-10', e: '2027-01-10',
    r: [['2027-01-10', 590, 680, 'sfl-murmliwasser', '', 1, 0]]})), options);
  assert.equal(winter.days[0].stops[0].booking, 'onsite', 'card is out of season');
});

test('rejects invalid links', () => {
  const bad = [
    undefined, '', 'a'.repeat(8001), 'not base64!', encode({...compact, v: 2}),
    encode({...compact, e: '2027-07-30'}),
    encode({...compact, e: '2027-07-09'}),
    encode({...compact, s: '2027-02-30'}),
    encode({...compact, a: 0}),
    encode({...compact, k: [18]}),
    encode({...compact, d: 6}),
    encode({...compact, r: [['2027-07-13', 590, 680, 'sfl-murmliwasser', '', 0, 0]]}),
    encode({...compact, r: [['2027-07-10', 680, 590, 'sfl-murmliwasser', '', 0, 0]]}),
    encode({...compact, r: [['2027-07-10', 590, 1441, 'sfl-murmliwasser', '', 0, 0]]}),
    encode({...compact, r: [['2027-07-10', 590, 680, '<script>', '', 0, 0]]}),
    encode({...compact, r: [['2027-07-10', 590, 680, 'sfl-murmliwasser', 'x'.repeat(41), 0, 0]]}),
    encode({...compact, r: [['2027-07-10', 590, 680, 'sfl-murmliwasser', '', 2, 0]]}),
    encode({...compact, r: [['2027-07-10', 590, 680, 'sfl-murmliwasser', '', 0, -1]]}),
    encode({...compact, r: Array.from({length: 61}, () => ['2027-07-10', 590, 680, 'sfl-murmliwasser', '', 0, 0])})
  ];
  for (const value of bad) assert.throws(() => decodeTripParam(value), /Reiseplan im Link ist ungültig/);
});

test('rejects unknown activities, places and cards when resolving', () => {
  assert.throws(() => resolveTrip(decodeTripParam(encode({...compact, r: [['2027-07-10', 590, 680, 'gibt-es-nicht', '', 0, 0]]})), options),
    /nicht mehr verfügbar/);
  assert.throws(() => resolveTrip(decodeTripParam(encode({...compact, p: 9})), options), /Startort/);
  assert.throws(() => resolveTrip(decodeTripParam(encode({...compact, c: 'unbekannt'})), options), /Gästekarte/);
});

test('cleans group labels and handles umlauts', () => {
  const trip = resolveTrip(decodeTripParam(encode({...compact, r: [['2027-07-10', 590, 680, 'sfl-murmliwasser', 'Oma\nGrüße', 0, 0]]})), options);
  assert.equal(trip.days[0].stops[0].group, 'Oma Grüße');
});
