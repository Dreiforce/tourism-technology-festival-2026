// node --test reise-canvas-prototyp/tests/wallet-walletwallet.test.mjs
// Apple passes via WalletWallet: request mapping and the API round trip, against a fake WalletWallet.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildApplePassJson} from '../server/wallet-apple.mjs';
import {buildWalletWalletPass, createWalletWalletPass, walletWalletBody, WALLETWALLET_API_KEY, WALLETWALLET_STRIP_SIZES} from '../server/wallet-walletwallet.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/trip.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-11-07T20:00:00Z');
const strip = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const passJsonFor = (trip, withStrip = true) => buildApplePassJson(trip, {images: withStrip ? {'strip.png': strip} : {}});
const fakePass = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]);

function longTrip() {
  const days = Array.from({length: 14}, (_, i) => {
    const date = new Date(Date.parse('2027-07-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    const stop = (start, end, n) => ({...fixture.days[0].stops[0], start, end,
      title: `Ein ziemlich langer Erlebnisname Nummer ${n} mit noch mehr Text dahinter`, group: n % 2 ? 'Gruppe 1' : null});
    return {date, label: `Tag ${i + 1}`, stops: [stop('09:00', '10:30', 1), stop('13:00', '14:30', 2), stop('18:00', '19:30', 3)]};
  });
  return {...fixture, start: days[0].date, end: days.at(-1).date, days};
}

test('the prototype key and the store-card strip sizes are exported', () => {
  assert.match(WALLETWALLET_API_KEY, /^ww_live_[0-9a-f]{32}$/);
  assert.deepEqual(WALLETWALLET_STRIP_SIZES, [[375, 123], [750, 246], [1125, 369]]);
});

test('the request body keeps WalletWallet’s limits and our content', () => {
  const body = walletWalletBody(fixture, passJsonFor(fixture), {images: {strip3x: strip, logo: strip, icon: strip}, now});
  assert.equal(body.logoText, 'familienzeit.');
  assert.equal(body.organizationName, 'Familienzeit');
  assert.equal(body.colorPreset, 'green');
  assert.equal(body.color, '#294e41');
  assert.equal(body.sharingProhibited, false);
  assert.equal(body.barcodeValue, undefined, 'no barcode');
  assert.equal(body.stripURL, 'data:image/png;base64,' + Buffer.from(strip).toString('base64'));
  assert.ok(body.logoURL && body.iconURL);
  assert.deepEqual(body.headerFields, [{label: 'URLAUB', value: '10.–12. Juli'}]);
  assert.deepEqual(body.primaryFields, [], 'nothing on top of the postcard');
  assert.deepEqual(body.secondaryFields.map(field => field.label), ['ORT', 'FAMILIE', 'ERSTER STOPP', 'WÜNSCHE']);
  assert.ok(body.backFields.length <= 10);
  for (const field of [...body.headerFields, ...body.secondaryFields, ...body.backFields]) {
    assert.ok(field.label.length <= 64 && field.value.length <= 256, field.label);
  }
  const saturday = body.backFields.find(field => field.label === 'SA., 10.7.');
  assert.equal(saturday.value, '09:30–11:00 Murmliwasser am Komperdell\n13:30–15:00 Spielstationen am Högsee');
  const sunday = body.backFields.find(field => field.label === 'SO., 11.7.');
  assert.equal(sunday.value, '09:00–12:00 Kinderbetreuung\n09:30–11:30 Spaziergang und Spiel am Wolfsee (Gruppe 1)');
  assert.equal(body.backFields.find(field => field.label === 'MO., 12.7.').value, 'Noch nichts geplant');
  assert.ok(body.locations.length >= 1 && body.locations.length <= 10);
  for (const location of body.locations) assert.ok(!location.relevantText || location.relevantText.length <= 128);
  assert.equal(body.expirationDays, 248, 'until the day after the trip');
  assert.doesNotMatch(JSON.stringify(body), /€|Preis/, 'no prices');
});

test('English trips and the free plan', () => {
  const trip = {...fixture, lang: 'en', days: fixture.days.map(day => ({...day, label: day.label.replace('Sa.', 'Sat').replace('So.', 'Sun').replace('Mo.', 'Mon')}))};
  const body = walletWalletBody(trip, passJsonFor(trip), {images: {strip3x: strip}, now, pro: false});
  assert.deepEqual(body.headerFields, [{label: 'HOLIDAY', value: '10–12 July'}]);
  assert.equal(body.backFields.at(-1).label, 'NOTE');
  for (const name of ['color', 'stripURL', 'logoURL', 'iconURL']) assert.equal(body[name], undefined, name);
});

test('a 14-day trip with three stops a day fits into ten back fields', () => {
  const trip = longTrip();
  const body = walletWalletBody(trip, passJsonFor(trip), {now});
  assert.equal(body.backFields.length, 10);
  assert.ok(body.backFields.every(field => field.value.length <= 256 && field.label.length <= 64));
  assert.ok(body.backFields.some(field => field.label.includes(' / ')), 'neighbouring days are merged');
  assert.ok(!body.backFields.some(field => field.label === 'EUER URLAUBSPLAN'), 'the intro makes room first');
  assert.ok(body.locations.length <= 10);
  assert.ok(JSON.stringify(body).length < 1.9 * 1024 * 1024);
});

function fakeApi(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({url, body: JSON.parse(init.body), headers: init.headers});
    const next = responses.shift();
    return typeof next === 'function' ? next() : next;
  };
  return {calls, fetch};
}
const passJson = passJsonFor(fixture);
const config = extra => ({apiKey: 'ww_live_test', images: {strip3x: strip, logo: strip}, now, barcodeUrl: 'https://canvas.example/', ...extra});

test('reads the pass from the JSON answer (newer API)', async () => {
  const api = fakeApi([Response.json({serialNumber: 's', applePass: Buffer.from(fakePass).toString('base64'), googleSaveUrl: 'https://pay.google.com/x'})]);
  const pass = await buildWalletWalletPass(fixture, passJson, config({fetch: api.fetch}));
  assert.deepEqual(pass, fakePass);
  assert.equal(api.calls[0].url, 'https://api.walletwallet.dev/api/passes');
  assert.equal(api.calls[0].headers.Authorization, 'Bearer ww_live_test');
});

test('falls back to the older binary endpoint', async () => {
  const api = fakeApi([new Response('Not found', {status: 404}),
    new Response(fakePass, {headers: {'Content-Type': 'application/vnd.apple.pkpass', 'X-Serial-Number': 's'}})]);
  assert.deepEqual(await buildWalletWalletPass(fixture, passJson, config({fetch: api.fetch})), fakePass);
  assert.deepEqual(api.calls.map(call => call.url), ['https://api.walletwallet.dev/api/passes', 'https://api.walletwallet.dev/api/pkpass']);
});

test('drops Pro-only fields when the plan doesn’t allow them, adds a barcode only if required', async () => {
  const api = fakeApi([
    Response.json({error: 'stripURL requires the Pro plan'}, {status: 403}),
    Response.json({error: 'barcodeValue is required'}, {status: 400}),
    Response.json({applePass: Buffer.from(fakePass).toString('base64')})
  ]);
  assert.deepEqual(await buildWalletWalletPass(fixture, passJson, config({fetch: api.fetch})), fakePass);
  assert.ok(api.calls[0].body.stripURL && api.calls[0].body.color);
  assert.equal(api.calls[1].body.stripURL, undefined);
  assert.equal(api.calls[1].body.color, undefined);
  assert.equal(api.calls[1].body.barcodeValue, undefined);
  assert.equal(api.calls[2].body.barcodeValue, 'https://canvas.example/');
  assert.equal(api.calls[2].body.barcodeFormat, 'QR');
});

test('clear errors for a wrong key, the monthly limit and broken answers', async () => {
  await assert.rejects(buildWalletWalletPass(fixture, passJson, config({fetch: fakeApi([new Response('no', {status: 401})]).fetch})), /API key was rejected/);
  await assert.rejects(buildWalletWalletPass(fixture, passJson, config({fetch: fakeApi([new Response('no', {status: 429})]).fetch})), /monthly pass limit/);
  await assert.rejects(buildWalletWalletPass(fixture, passJson, config({fetch: fakeApi([Response.json({applePass: btoa('not a zip')})]).fetch})), /no \.pkpass/);
  await assert.rejects(buildWalletWalletPass(fixture, passJson, config({fetch: fakeApi([new Response('boom', {status: 500})]).fetch})), /500 boom/);
  await assert.rejects(buildWalletWalletPass(fixture, passJson, {fetch: () => {}}), /API key missing/);
});

test('returns the install page and the Google link for the static copy', async () => {
  const api = fakeApi([Response.json({serialNumber: 's', applePass: Buffer.from(fakePass).toString('base64'),
    shareUrl: 'https://pass.walletwallet.dev/p/abc', googleSaveUrl: 'https://pay.google.com/gp/v/save/jwt', credentials: {}})]);
  const result = await createWalletWalletPass(fixture, passJson, config({fetch: api.fetch}));
  assert.deepEqual(result.pass, fakePass);
  assert.equal(result.shareUrl, 'https://pass.walletwallet.dev/p/abc');
  assert.equal(result.googleSaveUrl, 'https://pay.google.com/gp/v/save/jwt');

  const legacy = fakeApi([new Response('Not found', {status: 404}), new Response(fakePass, {headers: {
    'Content-Type': 'application/vnd.apple.pkpass', 'X-Pass-Url': 'https://pass.walletwallet.dev/p/old', 'X-Google-Save-Url': 'javascript:alert(1)'}})]);
  const old = await createWalletWalletPass(fixture, passJson, config({fetch: legacy.fetch}));
  assert.equal(old.shareUrl, 'https://pass.walletwallet.dev/p/old');
  assert.equal(old.googleSaveUrl, null, 'only https links are passed on');
});
