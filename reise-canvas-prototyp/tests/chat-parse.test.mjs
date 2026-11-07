// The chat's free-text understanding (dist/chat.js): who is coming, and when.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const src = await readFile(new URL('../dist/chat.js', import.meta.url), 'utf8');
const parseFamily = new Function(src.slice(src.indexOf('const numberWords'), src.indexOf('function parseDates')) + ';return parseFamily')();
const parseDates = new Function('todayDate', src.slice(src.indexOf('function parseDates'), src.indexOf('const pickWords')) + ';return parseDates')(() => '2026-11-07');

test('family sentences in German and English', () => {
  const cases = {
    '2 Erwachsene + 2 Kinder (4, 9)': [2, 0, 0, [4, 9], 0],
    '2 adults, kids 4 and 9, grandma and a dog': [2, 1, 1, [4, 9], 0],
    'Mama, Papa, Lena 6 und ein Baby': [2, 0, 0, [6, 0], 0],
    'wir zwei und drei Kinder': [2, 0, 0, [], 3],
    'Oma und Opa mit Enkel 10': [0, 2, 0, [10], 0],
    '2 adults + grandma + dog': [2, 1, 1, [], 0]
  };
  for (const [text, [adults, grand, dogs, ages, missing]] of Object.entries(cases)) {
    const found = parseFamily(text);
    assert.deepEqual([found.adults, found.grand, found.dogs, found.ages, found.missing], [adults, grand, dogs, ages, missing], text);
  }
});

test('dates: ranges, words and past days roll into next year', () => {
  assert.deepEqual(parseDates('14.7. bis 17.7.'), ['2027-07-14', '2027-07-17']);
  assert.deepEqual(parseDates('heute'), ['2026-11-07', '']);
  assert.deepEqual(parseDates('nächste Woche'), ['2026-11-09', '2026-11-15']);
  assert.deepEqual(parseDates('from 5/8 to 9/8'), ['2027-08-05', '2027-08-09']);
  assert.equal(parseDates('irgendwann'), null);
});

test('child names right before an age', () => {
  assert.deepEqual(parseFamily('Mama, Papa, Lena 6 und Max (9)').names, {6: ['Lena'], 9: ['Max']});
  assert.deepEqual(parseFamily('2 Erwachsene + 2 Kinder (4, 9)').names, {});
});
