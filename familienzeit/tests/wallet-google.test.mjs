// node --test tests/wallet-google.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey, generateKeyPairSync, verify} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildGooglePass, buildGoogleSaveUrl, GOOGLE_WALLET_SAFE_JWT_LENGTH} from '../server/wallet-google.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/trip.json', import.meta.url), 'utf8'));
const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const pem = privateKey.export({type: 'pkcs8', format: 'pem'});
const publicKey = createPublicKey(privateKey);
const saveBase = 'https://pay.google.com/gp/v/save/';
const origin = 'https://familienzeit.example.chatgpt.site';
let issuerCounter = 3388000000022000000n;
const config = (extra = {}) => ({
  issuerId: String(issuerCounter++),
  serviceAccountEmail: `wallet${issuerCounter}@familienzeit-ttf.iam.gserviceaccount.com`,
  privateKeyPem: pem, origin, now: '2026-11-07T19:40:00Z', ...extra
});
const clone = value => structuredClone(value);

function decode(token) {
  const [header, payload, signature] = token.split('.');
  const ok = verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'));
  return {ok, header: JSON.parse(Buffer.from(header, 'base64url')), claims: JSON.parse(Buffer.from(payload, 'base64url'))};
}
const tokenOf = url => {
  assert.ok(url.startsWith(saveBase), url.slice(0, 60));
  return url.slice(saveBase.length);
};

function assertWithinLimits(object) {
  assert.ok(object.textModulesData.length <= 10, `${object.textModulesData.length} text modules`);
  for (const module of object.textModulesData) {
    assert.match(module.id, /^[A-Za-z0-9_-]+$/);
    assert.ok(module.header.length <= 35, module.header);
    assert.ok(module.body.length <= 500, `${module.id}: ${module.body.length}`);
  }
  for (const link of object.linksModuleData?.uris ?? []) assert.match(link.uri, /^https:\/\//);
  assert.ok((object.linksModuleData?.uris ?? []).length <= 10);
  assert.ok(object.header.defaultValue.value.length <= 47);
  assert.ok(object.subheader.defaultValue.value.length <= 88);
}

function longTrip(days = 14, perDay = 3) {
  const trip = clone(fixture);
  const long = 'Erlebnis mit einem sehr langen Namen für die ganze Familie am Bergsee';
  trip.start = '2027-07-01';
  trip.end = `2027-07-${String(days).padStart(2, '0')}`;
  trip.days = Array.from({length: days}, (_, i) => {
    const date = `2027-07-${String(i + 1).padStart(2, '0')}`;
    return {date, label: `Tag ${i + 1}`, stops: Array.from({length: perDay}, (_, j) => ({
      ...fixture.days[0].stops[2], start: `${10 + j * 3}:00`, end: `${11 + j * 3}:30`,
      title: `${long} ${i + 1}.${j + 1}`, place: 'Serfaus · Komperdell · Mittelstation',
      group: j === 1 ? 'Oma Gertraud' : null,
      bookingLink: `https://www.serfaus-fiss-ladis.at/de/events-und-erlebnisse/erlebnisprogramm/event_${i}_${j}`,
      note: 'Termin, Treffpunkt und Verfügbarkeit bitte vorab im offiziellen Ticketshop prüfen. Ausrüstung kann extra kosten.'
    }))};
  });
  return trip;
}

test('fat JWT: signed RS256 save link with class and object', async t => {
  const cfg = config();
  const url = await buildGoogleSaveUrl(fixture, {...cfg, mode: 'jwt'});
  const {ok, header, claims} = decode(tokenOf(url));
  assert.ok(ok, 'signature verifies with the public key');
  assert.deepEqual(header, {alg: 'RS256', typ: 'JWT'});
  assert.equal(claims.iss, cfg.serviceAccountEmail);
  assert.equal(claims.aud, 'google');
  assert.equal(claims.typ, 'savetowallet');
  assert.equal(claims.iat, Date.parse(cfg.now) / 1000);
  assert.deepEqual(claims.origins, [origin]);

  const [genericClass] = claims.payload.genericClasses;
  const [object] = claims.payload.genericObjects;
  assert.equal(genericClass.id, `${cfg.issuerId}.familienzeit_urlaubsplan`);
  assert.equal(object.classId, genericClass.id);
  assert.equal(object.id, `${cfg.issuerId}.${fixture.id}`);
  assert.match(object.id, /^\d+\.[A-Za-z0-9._-]+$/);
  assert.equal(object.state, 'ACTIVE');
  assert.equal(object.barcode, undefined);
  assert.equal(object.rotatingBarcode, undefined);
  assert.equal(object.hexBackgroundColor, '#294e41');
  assert.equal(object.cardTitle.defaultValue.value, 'familienzeit.');
  assert.equal(object.cardTitle.defaultValue.language, 'de');
  assert.equal(object.subheader.defaultValue.value, '10.–12. Juli 2027 · Serfaus');
  assert.equal(object.header.defaultValue.value, '2 Erwachsene · 2 Kinder');
  assert.equal(object.logo.sourceUri.uri, `${origin}/wallet/logo.png`);
  assert.equal(object.heroImage.sourceUri.uri, `${origin}/wallet/hero.png`);
  assert.deepEqual(object.validTimeInterval, {start: {date: '2026-11-07T19:40:00Z'}, end: {date: '2027-07-12T23:59:59+02:00'}});

  const ids = object.textModulesData.map(module => module.id);
  assert.deepEqual(ids, ['row2left', 'row2right', 'tag-20270710', 'tag-20270711', 'tag-20270712', 'hinweise']);
  const byId = Object.fromEntries(object.textModulesData.map(module => [module.id, module]));
  assert.equal(byId.row2left.body, '5 an 2 Tagen');
  assert.equal(byId.row2right.body, '€ 34 + offen');
  assert.match(byId['tag-20270711'].body, /10:00–11:30 Mama: Spielstationen am Högsee/);
  assert.match(byId['tag-20270711'].body, /Papa: Spaziergang/);
  assert.equal(byId['tag-20270712'].body, 'Freier Tag');
  assert.match(byId.hinweise.body, /Originalkarte vorzeigen/);
  assert.match(byId.hinweise.body, /kein Ticket/);
  assert.deepEqual(object.linksModuleData.uris.map(link => link.id), ['buchen1', 'gaestekarte']);
  assertWithinLimits(object);

  t.diagnostic(`fixture fat link: ${url.length} chars (JWT ${url.length - saveBase.length}, safe length ${GOOGLE_WALLET_SAFE_JWT_LENGTH})`);
});

test('accepts a service-account key with escaped \\n like in the JSON file', async () => {
  const escaped = JSON.stringify(pem).slice(1, -1);
  assert.ok(escaped.includes('\\n'));
  const url = await buildGoogleSaveUrl(fixture, {...config(), privateKeyPem: escaped, mode: 'jwt'});
  assert.ok(decode(tokenOf(url)).ok);
});

test('rejects PKCS#1 keys with a clear message', async () => {
  const pkcs1 = privateKey.export({type: 'pkcs1', format: 'pem'});
  await assert.rejects(buildGoogleSaveUrl(fixture, {...config(), privateKeyPem: pkcs1, mode: 'jwt'}), /PKCS#8/);
});

test('validity starts at the trip once the trip has begun', () => {
  const {genericObject} = buildGooglePass(fixture, config({now: '2027-07-11T08:00:00Z'}));
  assert.equal(genericObject.validTimeInterval.start.date, '2027-07-10T00:00:00+02:00');
});

test('Vienna offsets: winter +01:00, summer +02:00, DST switch days', () => {
  const end = date => {
    const trip = {...clone(fixture), start: date, end: date, days: [{date, label: 'x', stops: []}]};
    return buildGooglePass(trip, config()).genericObject.validTimeInterval.end.date;
  };
  assert.equal(end('2027-01-15'), '2027-01-15T23:59:59+01:00');
  assert.equal(end('2027-03-27'), '2027-03-27T23:59:59+01:00');
  assert.equal(end('2027-03-28'), '2027-03-28T23:59:59+02:00');
  assert.equal(end('2027-10-30'), '2027-10-30T23:59:59+02:00');
  assert.equal(end('2027-10-31'), '2027-10-31T23:59:59+01:00');

  const intl = new Intl.DateTimeFormat('en', {timeZone: 'Europe/Vienna', timeZoneName: 'longOffset'});
  for (let day = Date.UTC(2026, 0, 1); day <= Date.UTC(2030, 11, 31); day += 86400e3) {
    const date = new Date(day).toISOString().slice(0, 10);
    const iso = end(date);
    const zone = intl.formatToParts(new Date(iso)).find(part => part.type === 'timeZoneName').value;
    assert.equal(zone.replace('GMT', ''), iso.slice(-6), date);
  }
});

test('worst case: 14 days × 3 stops stays within module limits', async t => {
  const trip = longTrip();
  const {genericObject} = buildGooglePass(trip, config());
  assertWithinLimits(genericObject);
  assert.equal(genericObject.textModulesData.length, 10);
  const bodies = genericObject.textModulesData.map(module => module.body).join('\n');
  for (const day of trip.days) assert.ok(bodies.includes(day.label), `${day.label} is listed`);
  assert.equal(genericObject.linksModuleData.uris.length, 10);
  const url = await buildGoogleSaveUrl(trip, {...config(), mode: 'jwt'});
  t.diagnostic(`worst-case fat link: ${url.length} chars`);
  assert.ok(url.length < 16000, 'fat fallback stays below common server URL limits');
});

test('auto mode inserts via the REST API and returns a short link when the fat JWT is too long', async t => {
  const cfg = config();
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({url, init});
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const {ok, claims} = decode(body.get('assertion'));
      assert.ok(ok);
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/wallet_object.issuer');
      assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
      assert.equal(claims.exp - claims.iat, 3600);
      return Response.json({access_token: 'ya29.test', expires_in: 3599});
    }
    assert.equal(init.headers.Authorization, 'Bearer ya29.test');
    return Response.json(JSON.parse(init.body), {status: 200});
  };
  const url = await buildGoogleSaveUrl(fixture, {...cfg, fetch: fakeFetch});
  assert.deepEqual(calls.map(call => call.url), [
    'https://oauth2.googleapis.com/token',
    'https://walletobjects.googleapis.com/walletobjects/v1/genericClass',
    'https://walletobjects.googleapis.com/walletobjects/v1/genericObject'
  ]);
  const inserted = JSON.parse(calls[2].init.body);
  assert.equal(inserted.id, `${cfg.issuerId}.${fixture.id}`);
  assert.equal(inserted.textModulesData.length, 6);

  const token = tokenOf(url);
  assert.ok(token.length <= GOOGLE_WALLET_SAFE_JWT_LENGTH, `${token.length}`);
  const {ok, claims} = decode(token);
  assert.ok(ok);
  assert.deepEqual(claims.payload, {genericObjects: [{id: inserted.id, classId: inserted.classId}]});
  t.diagnostic(`short link after API insert: ${url.length} chars`);

  calls.length = 0;
  await buildGoogleSaveUrl({...fixture, id: '2b0e7a40-1111-4c1f-9a7b-2e5d8c9f0a11'}, {...cfg, fetch: fakeFetch});
  assert.deepEqual(calls.map(call => call.url), ['https://walletobjects.googleapis.com/walletobjects/v1/genericObject'],
    'token and class are reused within one worker isolate');
});

test('auto mode treats 409 on the class as "already exists"', async () => {
  const cfg = config();
  const fakeFetch = async url => url.endsWith('/token') ? Response.json({access_token: 't'})
    : url.endsWith('/genericClass') ? new Response('{"error":{"code":409}}', {status: 409}) : Response.json({});
  const url = await buildGoogleSaveUrl(fixture, {...cfg, fetch: fakeFetch, mode: 'api'});
  assert.ok(tokenOf(url).length <= GOOGLE_WALLET_SAFE_JWT_LENGTH);
});

test('auto mode falls back to the long link when the API is unreachable; api mode throws', async () => {
  const failing = async () => { throw new Error('network down'); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const url = await buildGoogleSaveUrl(fixture, {...config(), fetch: failing});
    assert.ok(decode(tokenOf(url)).claims.payload.genericClasses, 'fat JWT with class + object');
  } finally {
    console.warn = warn;
  }
  await assert.rejects(buildGoogleSaveUrl(fixture, {...config(), fetch: failing, mode: 'api'}), /network down/);
});

test('local origin: no image URLs (Google needs public https), localhost kept in origins', async () => {
  const cfg = config({origin: 'http://localhost:8000'});
  const url = await buildGoogleSaveUrl(fixture, {...cfg, mode: 'jwt'});
  const {claims} = decode(tokenOf(url));
  const [object] = claims.payload.genericObjects;
  assert.equal(object.logo, undefined);
  assert.equal(object.heroImage, undefined);
  assert.deepEqual(claims.origins, ['http://localhost:8000']);
});

test('missing configuration fails loudly', async () => {
  assert.throws(() => buildGooglePass(fixture, {issuerId: ''}), /issuerId/);
  await assert.rejects(buildGoogleSaveUrl(fixture, {...config(), serviceAccountEmail: ''}), /serviceAccountEmail/);
});
