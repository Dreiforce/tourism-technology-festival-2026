// node --test reise-canvas-prototyp/tests/
// Builds the worker into a temporary copy with stub pass builders, so these tests cover routing, the postcard
// upload and storage, and what the worker hands to the builders. The builders have their own tests.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';

const app = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://canvas.example';
let dir, worker;

const stubApple = `export const APPLE_STRIP_SIZES = [[30, 8], [60, 16], [90, 24]];
export async function buildApplePass(trip, config) {
  (globalThis.walletCalls ||= []).push({kind: 'apple', trip, config});
  return new TextEncoder().encode('PKPASS');
}`;
const stubGoogle = `export const GOOGLE_HERO_SIZE = [40, 30];
export async function buildGoogleSaveUrl(trip, config) {
  (globalThis.walletCalls ||= []).push({kind: 'google', trip, config});
  return 'https://pay.google.com/gp/v/save/stub';
}`;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-worker-'));
  for (const entry of readdirSync(join(app, 'dist'), {withFileTypes: true})) {
    if (entry.isFile()) cpSync(join(app, 'dist', entry.name), join(dir, 'dist', entry.name));
  }
  cpSync(join(app, 'server'), join(dir, 'server'), {recursive: true});
  cpSync(join(app, 'scripts/build.mjs'), join(dir, 'scripts/build.mjs'));
  writeFileSync(join(dir, 'server/wallet-apple.mjs'), stubApple);
  writeFileSync(join(dir, 'server/wallet-google.mjs'), stubGoogle);
  execFileSync(process.execPath, [join(dir, 'scripts/build.mjs')], {stdio: 'pipe'});
});
after(() => rmSync(dir, {recursive: true, force: true}));
const load = async () => (worker ??= (await import(pathToFileURL(join(dir, 'dist/server/index.js')).href)).default);

function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      objects.set(key, {bytes: new Uint8Array(value), httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {}});
    },
    async head(key) {
      const item = objects.get(key);
      return item ? {key, customMetadata: item.customMetadata, httpMetadata: item.httpMetadata} : null;
    },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      return {key, customMetadata: item.customMetadata, httpMetadata: item.httpMetadata,
        get body() { return new Response(item.bytes).body; }, arrayBuffer: async () => item.bytes.slice().buffer};
    },
    async delete(keys) {
      for (const key of [].concat(keys)) objects.delete(key);
    }
  };
}
const pem = label => `-----BEGIN ${label}-----\nAAAA\n-----END ${label}-----`;
const configured = () => ({
  BUCKET: memoryBucket(),
  APPLE_PASS_TYPE_ID: 'pass.test', APPLE_TEAM_ID: 'TEAM123', APPLE_PASS_CERT: pem('CERTIFICATE'),
  APPLE_PASS_KEY: btoa(pem('PRIVATE KEY')), APPLE_WWDR_CERT: pem('CERTIFICATE').replace(/\n/g, '\\n'),
  GOOGLE_ISSUER_ID: '3388000000000000000', GOOGLE_SA_EMAIL: 'wallet@test.iam.gserviceaccount.com', GOOGLE_SA_KEY: pem('PRIVATE KEY')
});

// Smallest valid PNG of the given size (grey pixels).
function png(width, height) {
  const crcTable = Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = bytes => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 0;
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = {strip: [30, 8], 'strip@2x': [60, 16], 'strip@3x': [90, 24], hero: [40, 30]};
function uploadForm({skip, override = {}, end = '2027-07-12'} = {}) {
  const form = new FormData();
  for (const [name, [width, height]] of Object.entries(sizes)) {
    if (name === skip) continue;
    form.append(name, new Blob([override[name] ?? png(width, height)], {type: 'image/png'}), name + '.png');
  }
  if (end !== null) form.append('end', end);
  return form;
}
const upload = (env, form, headers = {Origin: origin}) =>
  load().then(w => w.fetch(new Request(origin + '/api/wallet/postcard', {method: 'POST', body: form, headers}), env));
const get = (env, path, init) => load().then(w => w.fetch(new Request(origin + path, init), env));

const plan = Buffer.from(JSON.stringify({v: 1, l: 'de', p: 'Fiss', s: '2027-07-10', e: '', f: [['a', null, 'Papa'], ['c', 7, '']],
  w: ['play'], r: [['2027-07-10', 'am', '', 600, 690, 2]]})).toString('base64url');

test('serves the canvas files', async () => {
  const env = {};
  const home = await get(env, '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /^text\/html/);
  assert.match(await home.text(), /<script defer src="wallet\.js"><\/script>/);
  for (const [path, type] of [['/app.js', /javascript/], ['/wallet.js', /javascript/], ['/style.css', /css/], ['/catalog.json', /json/]]) {
    const response = await get(env, path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), type, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.ok(Array.isArray(await (await get(env, '/catalog.json')).json()));
  assert.equal((await get(env, '/missing.js')).status, 404);
  assert.equal((await get(env, '/api/missing')).status, 404);
  assert.equal((await get(env, '/', {method: 'POST'})).status, 405);
  assert.equal((await get(env, '/wallet/logo.png')).headers.get('content-type'), 'image/png');
  assert.equal((await get(env, '/wallet/icon.png')).status, 404, 'Apple images are not public');
});

test('status reports configuration and image sizes', async () => {
  assert.deepEqual(await (await get({}, '/api/wallet/status')).json(),
    {apple: false, google: false, strip: [[30, 8], [60, 16], [90, 24]], hero: [40, 30]});
  assert.deepEqual(await (await get(configured(), '/api/wallet/status')).json(),
    {apple: true, google: true, strip: [[30, 8], [60, 16], [90, 24]], hero: [40, 30]});
  assert.equal((await get({}, '/api/wallet/status', {method: 'POST'})).status, 405);
});

test('pass routes answer with pages when something is missing', async () => {
  let response = await get({}, `/api/wallet/apple?t=${plan}`);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Apple Wallet ist auf diesem Server noch nicht eingerichtet/);
  response = await get({}, `/api/wallet/google?l=en&t=${plan}`);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Google Wallet is not set up on this server yet/);
  response = await get(configured(), '/api/wallet/apple?l=en&t=garbage!');
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(await response.text(), /trip plan in this link is invalid/);
  assert.equal((await get(configured(), `/api/wallet/apple?t=${plan}&p=../x`)).status, 400);
  assert.equal((await get(configured(), `/api/wallet/apple?t=${plan}`, {method: 'POST'})).status, 405);
});

test('postcard upload is validated', async () => {
  assert.equal((await upload({BUCKET: memoryBucket()}, uploadForm())).status, 503, 'no wallet configured');
  const env = configured();
  assert.equal((await upload(env, uploadForm(), {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await upload(env, uploadForm(), {})).status, 403, 'missing Origin');
  const jsonBody = await get(env, '/api/wallet/postcard', {method: 'POST', body: '{}', headers: {Origin: origin, 'Content-Type': 'application/json'}});
  assert.equal(jsonBody.status, 415);
  assert.equal((await upload(env, uploadForm({skip: 'hero'}))).status, 400, 'missing image');
  assert.equal((await upload(env, uploadForm({override: {strip: png(31, 8)}}))).status, 400, 'wrong size');
  assert.equal((await upload(env, uploadForm({override: {hero: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])}}))).status, 415, 'not a PNG');
  const big = Buffer.concat([png(40, 30), Buffer.alloc(1024 * 1024)]);
  assert.equal((await upload(env, uploadForm({override: {hero: big}}))).status, 413, 'image over 1 MB');
  assert.equal((await upload(env, uploadForm({end: null}))).status, 400, 'missing end date');
  assert.equal((await upload(env, uploadForm({end: '2020-01-01'}))).status, 400, 'trip already over');
  assert.equal((await upload(env, uploadForm({end: '2027-02-30'}))).status, 400, 'impossible date');
  assert.equal(env.BUCKET.objects.size, 0, 'nothing stored for rejected uploads');
  const tooLong = await get(env, '/api/wallet/postcard', {method: 'POST', body: 'x', headers: {Origin: origin,
    'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(5 * 1024 * 1024)}});
  assert.equal(tooLong.status, 413);
});

test('stored postcards feed both passes and expire', async () => {
  globalThis.walletCalls = [];
  const env = configured();
  const response = await upload(env, uploadForm());
  assert.equal(response.status, 201);
  const {id, expires} = await response.json();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(expires, '2027-08-11T23:59:59.000Z', '30 days after the trip');
  assert.deepEqual([...env.BUCKET.objects.keys()].sort(),
    ['hero', 'strip', 'strip@2x', 'strip@3x'].map(name => `postcards/${id}/${name}.png`));

  const hero = await get(env, `/api/wallet/postcards/${id}/hero.png`);
  assert.equal(hero.status, 200);
  assert.equal(hero.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await hero.arrayBuffer()), png(40, 30));
  assert.equal((await get(env, `/api/wallet/postcards/${id}/strip.png`)).status, 404, 'only the hero is public');

  const apple = await get(env, `/api/wallet/apple?l=de&p=${id}&t=${plan}`);
  assert.equal(apple.status, 200);
  assert.equal(apple.headers.get('content-type'), 'application/vnd.apple.pkpass');
  assert.equal(apple.headers.get('content-disposition'), 'attachment; filename="familienzeit.pkpass"');
  assert.equal(await apple.text(), 'PKPASS');
  const appleCall = globalThis.walletCalls.find(call => call.kind === 'apple');
  assert.deepEqual(Buffer.from(appleCall.config.images['strip@3x.png']), png(90, 24));
  assert.ok(appleCall.config.images['icon.png'] && appleCall.config.images['logo.png'], 'fixed Apple images');
  assert.equal(appleCall.config.passTypeIdentifier, 'pass.test');
  assert.match(appleCall.config.privateKeyPem, /^-----BEGIN PRIVATE KEY-----\nAAAA/, 'base64 secret decoded');
  assert.match(appleCall.config.wwdrPem, /^-----BEGIN CERTIFICATE-----\nAAAA/, 'escaped newlines restored');
  assert.equal(appleCall.trip.place.name, 'Fiss');
  assert.equal(appleCall.trip.days[0].stops[0].title, JSON.parse(await (await get(env, '/catalog.json')).text())[2].title);

  const google = await get(env, `/api/wallet/google?p=${id}&t=${plan}`);
  assert.equal(google.status, 302);
  assert.equal(google.headers.get('location'), 'https://pay.google.com/gp/v/save/stub');
  const googleCall = globalThis.walletCalls.find(call => call.kind === 'google');
  assert.equal(googleCall.config.heroImageUrl, `${origin}/api/wallet/postcards/${id}/hero.png`);
  assert.equal(googleCall.config.origin, origin);

  for (const item of env.BUCKET.objects.values()) item.customMetadata.expires = '2020-01-01T00:00:00.000Z';
  assert.equal((await get(env, `/api/wallet/postcards/${id}/hero.png`)).status, 404, 'expired');
  globalThis.walletCalls = [];
  assert.equal((await get(env, `/api/wallet/apple?p=${id}&t=${plan}`)).status, 200, 'expired postcard → pass without it');
  assert.equal(globalThis.walletCalls[0].config.images['strip.png'], undefined);
  assert.equal((await get(env, `/api/wallet/google?p=${id}&t=${plan}`)).status, 302);
  assert.equal(globalThis.walletCalls[1].config.heroImageUrl, undefined);
  assert.equal(env.BUCKET.objects.size, 0, 'expired postcards are deleted when touched');
});

test('the real build uses the builders’ image sizes', async () => {
  const realDir = mkdtempSync(join(tmpdir(), 'canvas-real-'));
  try {
    for (const entry of readdirSync(join(app, 'dist'), {withFileTypes: true})) {
      if (entry.isFile()) cpSync(join(app, 'dist', entry.name), join(realDir, 'dist', entry.name));
    }
    cpSync(join(app, 'server'), join(realDir, 'server'), {recursive: true});
    cpSync(join(app, 'scripts/build.mjs'), join(realDir, 'scripts/build.mjs'));
    execFileSync(process.execPath, [join(realDir, 'scripts/build.mjs')], {stdio: 'pipe'});
    const real = (await import(pathToFileURL(join(realDir, 'dist/server/index.js')).href)).default;
    const status = await (await real.fetch(new Request(origin + '/api/wallet/status'), {})).json();
    const {APPLE_STRIP_SIZES} = await import(pathToFileURL(join(app, 'server/wallet-apple.mjs')).href);
    const {GOOGLE_HERO_SIZE} = await import(pathToFileURL(join(app, 'server/wallet-google.mjs')).href);
    assert.deepEqual(status, {apple: false, google: false,
      strip: APPLE_STRIP_SIZES ?? [[375, 98], [750, 196], [1125, 294]], hero: GOOGLE_HERO_SIZE ?? [1032, 336]});
  } finally {
    rmSync(realDir, {recursive: true, force: true});
  }
});
