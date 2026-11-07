// node --test reise-canvas-prototyp/tests/
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeTripParam, resolveTrip} from '../server/wallet-trip.mjs';

const catalog = JSON.parse(readFileSync(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/trip.json', import.meta.url), 'utf8'));
const encode = data => Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)).toString('base64url');
const indexOf = title => {
  const index = catalog.findIndex(activity => activity.title === title);
  assert.ok(index >= 0, `catalog has "${title}"`);
  return index;
};
const advance = catalog.findIndex(activity => activity.advanceBooking);

function sample(overrides = {}) {
  return {
    v: 1, l: 'de', p: 'Serfaus', s: '2027-07-10', e: '2027-07-12',
    f: [['a', null, 'Mama'], ['a', 41, ''], ['c', 9, 'Lena'], ['c', 4, ''], ['d', null, 'Bello']],
    w: ['adventure', 'water'],
    r: [
      ['2027-07-10', 'pm', '', 810, 900, indexOf('Spielstationen am Högsee')],
      ['2027-07-10', 'am', '', 570, 660, indexOf('Murmliwasser am Komperdell')],
      ['2027-07-11', 'am', 'Gruppe 1', 570, 690, advance],
      ['2027-07-11', 'am', 'Betreuung', 540, 720, -1]
    ],
    ...overrides
  };
}
const resolve = (data, id = 'trip-1') => resolveTrip(decodeTripParam(encode(data)), {catalog, id});

// Same keys in the same order and the same value types as the fixture (null stands in for "string or null").
function assertShape(actual, expected, path) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected), `${path}: keys`);
  for (const [key, value] of Object.entries(expected)) {
    const got = actual[key];
    if (value === null || got === null) continue;
    assert.equal(Array.isArray(got), Array.isArray(value), `${path}.${key}: array`);
    assert.equal(typeof got, typeof value, `${path}.${key}: type`);
  }
}

test('round trip resolves to the fixture shape with catalog content', () => {
  const trip = resolve(sample());
  assertShape(trip, fixture, 'trip');
  assertShape(trip.place, fixture.place, 'place');
  assertShape(trip.family, fixture.family, 'family');
  trip.family.members.forEach((member, i) => assertShape(member, fixture.family.members[0], `members[${i}]`));
  assert.equal(trip.days.length, 3);
  trip.days.forEach((day, i) => assertShape(day, fixture.days[0], `days[${i}]`));
  const fixtureActivity = fixture.days[0].stops[0];
  const fixtureCare = fixture.days[1].stops[0];
  for (const day of trip.days) for (const stop of day.stops) assertShape(stop, stop.kind === 'care' ? fixtureCare : fixtureActivity, `stop ${stop.title}`);

  assert.equal(trip.id, 'trip-1');
  assert.equal(trip.card, null);
  assert.equal(trip.prices, false);
  assert.equal(trip.total, null);
  assert.deepEqual(trip.place, fixture.place);
  assert.deepEqual(trip.family.members, [
    {name: 'Mama', kind: 'adult', age: null}, {name: '', kind: 'adult', age: 41},
    {name: 'Lena', kind: 'child', age: 9}, {name: '', kind: 'child', age: 4}, {name: 'Bello', kind: 'dog', age: null}
  ]);
  assert.equal(trip.family.summary, '2 Erwachsene · 2 Kinder · 1 Hund');
  assert.deepEqual([trip.family.adults, trip.family.ages, trip.family.dogs], [2, [9, 4], 1]);
  assert.deepEqual(trip.wishes, ['Abenteuer', 'Wasser']);
  assert.deepEqual(trip.days.map(day => day.label), ['Sa., 10.7.', 'So., 11.7.', 'Mo., 12.7.']);
  assert.deepEqual(trip.days[2].stops, []);

  const [morning, afternoon] = trip.days[0].stops;
  assert.equal(morning.title, 'Murmliwasser am Komperdell', 'stops are sorted by time');
  assert.deepEqual([morning.start, morning.end, morning.group], ['09:30', '11:00', null]);
  assert.deepEqual([morning.latitude, morning.longitude], [47.041, 10.565]);
  assert.equal(morning.booking, 'info');
  assert.equal(morning.bookingLink, catalog[indexOf('Murmliwasser am Komperdell')].sources[0]);
  assert.equal(morning.note, catalog[indexOf('Murmliwasser am Komperdell')].description);
  assert.equal(afternoon.place, 'Serfaus · Högsee');

  const [care, grouped] = trip.days[1].stops;
  assert.deepEqual([care.kind, care.start, care.end, care.title, care.group, care.booking],
    ['care', '09:00', '12:00', 'Kinderbetreuung', 'Betreuung', 'care']);
  assert.match(care.bookingLink, /familiensommer\/kinderbetreuung$/);
  assert.equal(grouped.group, 'Gruppe 1');
  assert.equal(grouped.booking, 'advance');
  assert.equal(grouped.bookingLabel, 'Voranmeldung erforderlich');
  assert.equal(grouped.title, catalog[advance].title);
});

test('English trips use the English catalog texts and labels', () => {
  const trip = resolve(sample({l: 'en'}));
  assert.equal(trip.lang, 'en');
  assert.deepEqual(trip.days.map(day => day.label), ['Sat 10 Jul', 'Sun 11 Jul', 'Mon 12 Jul']);
  assert.equal(trip.family.summary, '2 adults · 2 children · 1 dog');
  assert.deepEqual(trip.wishes, ['Adventure', 'Water']);
  const stop = trip.days[0].stops[0];
  assert.equal(stop.title, catalog[indexOf('Murmliwasser am Komperdell')].titleEn);
  assert.equal(stop.note, catalog[indexOf('Murmliwasser am Komperdell')].descriptionEn);
  assert.equal(trip.days[1].stops[0].title, 'Childcare');
  assert.match(trip.days[1].stops[0].bookingLink, /\/en\/summer-holiday\/family-summer\/child-care$/);
  assert.match(trip.estimateNote, /^Times are suggestions/);
});

test('single-day trips, winter childcare and singular summaries', () => {
  const trip = resolve(sample({s: '2027-01-15', e: '', f: [['a', 72, 'Oma']], w: [],
    r: [['2027-01-15', 'pm', '', 780, 840, -1]]}));
  assert.equal(trip.end, '2027-01-15');
  assert.equal(trip.days.length, 1);
  assert.equal(trip.family.summary, '1 erwachsene Person');
  assert.match(trip.days[0].stops[0].bookingLink, /winterurlaub\/familienwinter\/kinderbetreuung$/);
  assert.equal(trip.days[0].stops[0].group, 'Kinderbetreuung', 'care without label falls back to the care title');
});

test('names are cleaned and titles never come from the client', () => {
  const compact = decodeTripParam(encode(sample({f: [['a', null, '  Ma\u0007ma \n Bär '], ['c', 6, '']]})));
  assert.deepEqual(compact.f[0], ['a', null, 'Mama Bär']);
  const trip = resolveTrip(compact, {catalog, id: 'x'});
  assert.ok(trip.days.flatMap(day => day.stops).every(stop => stop.kind === 'care' ||
    catalog.some(activity => activity.title === stop.title)));
});

test('rejects malformed plans', () => {
  const good = sample();
  const cases = {
    'wrong version': {...good, v: 2},
    'unknown language': {...good, l: 'fr'},
    'unknown village': {...good, p: 'Landeck'},
    'impossible date': {...good, s: '2027-02-30'},
    'end before start': {...good, e: '2027-07-09'},
    'end equals start': {...good, e: '2027-07-10'},
    'more than 14 days': {...good, e: '2027-07-24'},
    'no adult': {...good, f: [['c', 5, '']]},
    'no people': {...good, f: []},
    'eleven people': {...good, f: Array.from({length: 11}, () => ['a', null, ''])},
    'unknown kind': {...good, f: [['a', null, ''], ['x', null, '']]},
    'child without age': {...good, f: [['a', null, ''], ['c', null, '']]},
    'child aged 18': {...good, f: [['a', null, ''], ['c', 18, '']]},
    'dog with age': {...good, f: [['a', null, ''], ['d', 3, '']]},
    'fractional age': {...good, f: [['a', 40.5, '']]},
    'name too long': {...good, f: [['a', null, 'x'.repeat(25)]]},
    'name not a string': {...good, f: [['a', null, 7]]},
    'unknown wish': {...good, w: ['shopping']},
    'duplicate wish': {...good, w: ['water', 'water']},
    'entry outside the trip': {...good, r: [['2027-07-13', 'am', '', 540, 600, 0]]},
    'unknown period': {...good, r: [['2027-07-10', 'eve', '', 540, 600, 0]]},
    'start after end': {...good, r: [['2027-07-10', 'am', '', 600, 540, 0]]},
    'minutes past midnight': {...good, r: [['2027-07-10', 'pm', '', 1400, 1441, 0]]},
    'negative index': {...good, r: [['2027-07-10', 'am', '', 540, 600, -2]]},
    'fractional index': {...good, r: [['2027-07-10', 'am', '', 540, 600, 1.5]]},
    'short entry': {...good, r: [['2027-07-10', 'am', '', 540, 600]]},
    'group label too long': {...good, r: [['2027-07-10', 'am', 'g'.repeat(41), 540, 600, 0]]},
    'too many entries': {...good, r: Array.from({length: 61}, () => ['2027-07-10', 'am', '', 540, 600, 0])}
  };
  for (const [name, data] of Object.entries(cases)) {
    assert.throws(() => decodeTripParam(encode(data)), /Reiseplan/, name);
  }
  for (const [name, t] of Object.entries({
    'missing': undefined, 'empty': '', 'not base64url': 'abc+/=', 'not JSON': encode('{nope'),
    'array': encode([1, 2]), 'invalid UTF-8': Buffer.from([0xff, 0xfe, 0x7b]).toString('base64url')
  })) {
    assert.throws(() => decodeTripParam(t), /Reiseplan/, name);
  }
  assert.throws(() => decodeTripParam('a'.repeat(8001)), /zu lang/);
  assert.throws(() => decodeTripParam(encode({...good, v: 2}), 'en'), /trip plan in this link/);
  assert.throws(() => decodeTripParam(encode({...good, l: 'en', p: 'Landeck'})), /trip plan in this link/,
    'errors after the language is known use the plan language');
});

test('rejects activities the catalog does not have', () => {
  assert.throws(() => resolve(sample({r: [['2027-07-10', 'am', '', 540, 600, catalog.length]]})), /gibt es im Katalog nicht mehr/);
  assert.throws(() => resolve(sample({l: 'en', r: [['2027-07-10', 'am', '', 540, 600, 9999]]})), /no longer in the catalogue/);
});

test('bookings from the canvas: booked times, booked flag and the trip booking number', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
  const index = catalog.findIndex(a => a.region === 'sfl' && a.location[0].startsWith('Serfaus'));
  const raw = {v: 1, l: 'de', p: 'Serfaus', s: '2027-07-10', e: '', f: [['a', null, '']], w: [], b: 'FZ-AB12CD',
    r: [['2027-07-10', 'am', '', 600, 690, index, 1], ['2027-07-10', 'pm', '', 840, 900, index, 0]]};
  const t = Buffer.from(JSON.stringify(raw)).toString('base64url');
  const compact = decodeTripParam(t);
  assert.equal(compact.b, 'FZ-AB12CD');
  const trip = resolveTrip(compact, {catalog, id: 'x'});
  assert.deepEqual(trip.booking, {ref: 'FZ-AB12CD'});
  const [booked, open] = trip.days[0].stops;
  assert.equal(booked.booked, true);
  assert.equal(booked.booking, 'booked');
  assert.equal(booked.bookingLabel, 'Gebucht (Demo)');
  assert.equal(booked.start, '10:00');
  assert.equal(open.booked, false);
  // A booking number without any booked stop is dropped.
  const none = resolveTrip(decodeTripParam(Buffer.from(JSON.stringify({...raw, r: [raw.r[1]]})).toString('base64url')), {catalog, id: 'y'});
  assert.equal(none.booking, null);
  for (const bad of [{...raw, b: 'XX-123456'}, {...raw, b: 'FZ-<script>'}, {...raw, r: [['2027-07-10', 'am', '', 600, 690, index, 2]]}]) {
    assert.throws(() => decodeTripParam(Buffer.from(JSON.stringify(bad)).toString('base64url')));
  }
});
