// Tests for the Apple Wallet export. Run: node --test familienzeit/tests/wallet-apple.test.mjs
// Uses a throwaway certificate chain (fake root → fake "WWDR" intermediate → pass certificate) made with openssl,
// so the signature is checked by an independent CMS implementation. Skips when openssl is missing.
import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApplePass, buildApplePassJson, appleTimestamp} from '../server/wallet-apple.mjs';

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;
const hasUnzip = spawnSync('unzip', ['-v']).status === 0;
const assets = new URL('../server/wallet-assets/apple/', import.meta.url);
const trip = JSON.parse(readFileSync(new URL('./fixtures/trip.json', import.meta.url), 'utf8'));
const images = Object.fromEntries(readdirSync(assets).filter(name => name.endsWith('.png'))
  .map(name => [name, new Uint8Array(readFileSync(new URL(name, assets)))]));
const ids = {passTypeIdentifier: 'pass.at.familienzeit.test', teamIdentifier: 'TEAM123456'};
let dir, config;

function sh(command, args, options = {}) {
  const result = spawnSync(command, args, {cwd: dir, encoding: 'utf8', ...options});
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return result;
}

before(() => {
  if (!hasOpenssl) return;
  dir = mkdtempSync(join(tmpdir(), 'familienzeit-apple-'));
  writeFileSync(join(dir, 'ca.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  writeFileSync(join(dir, 'leaf.ext'), 'keyUsage=critical,digitalSignature\n');
  sh('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem',
    '-days', '2', '-subj', '/CN=Fake Apple Root']);
  sh('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'wwdr.key', '-out', 'wwdr.csr',
    '-subj', '/CN=Fake WWDR G4/OU=G4/O=Fake Apple/C=US']);
  sh('openssl', ['x509', '-req', '-in', 'wwdr.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial',
    '-out', 'wwdr.pem', '-days', '2', '-extfile', 'ca.ext']);
  sh('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'pass.key', '-out', 'pass.csr',
    '-subj', '/UID=pass.at.familienzeit.test/CN=Pass Type ID: pass.at.familienzeit.test/OU=TEAM123456/C=AT']);
  sh('openssl', ['x509', '-req', '-in', 'pass.csr', '-CA', 'wwdr.pem', '-CAkey', 'wwdr.key', '-CAcreateserial',
    '-out', 'pass.pem', '-days', '2', '-extfile', 'leaf.ext']);
  const read = name => readFileSync(join(dir, name), 'utf8');
  config = {...ids, certificatePem: read('pass.pem'), privateKeyPem: read('pass.key'), wwdrPem: read('wwdr.pem'), images};
});

async function buildAndExtract(name, tripData = trip, overrides = {}) {
  const bytes = await buildApplePass(tripData, {...config, ...overrides});
  const file = join(dir, `${name}.pkpass`);
  writeFileSync(file, bytes);
  const out = join(dir, name);
  sh('unzip', ['-q', '-o', file, '-d', out]);
  return {bytes, file, out};
}

function cmsSummary(file) {
  const text = sh('openssl', ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', file]).stdout;
  return {
    signedDataVersion: text.match(/d\.signedData:\s*\n\s*version: (\d+)/)?.[1],
    digestAlgorithms: [...text.matchAll(/digestAlgorithms:\s*\n\s*algorithm: (\S+)/g)].map(m => m[1]),
    eContentType: text.match(/eContentType: (\S+)/)?.[1],
    detached: /eContent: <ABSENT>/.test(text),
    certificates: [...text.matchAll(/^\s+subject: (.+)$/gm)].map(m => m[1].trim()),
    signerVersion: text.match(/signerInfos:\s*\n\s*version: (\d+)/)?.[1],
    signerIssuer: text.match(/d\.issuerAndSerialNumber:\s*\n\s*issuer: (.+)/)?.[1],
    signerSerial: text.match(/d\.issuerAndSerialNumber:[\s\S]*?serialNumber: (\S+)/)?.[1],
    signatureAlgorithm: text.match(/signatureAlgorithm:\s*\n\s*algorithm: (\S+)/)?.[1],
    attributes: [...text.matchAll(/object: (\S+) \(1\.2\.840\.113549\.1\.9\.\d+\)/g)].map(m => m[1])
  };
}

test('pkpass is a valid zip with all required files', {skip: !hasOpenssl || !hasUnzip}, async () => {
  const {file, out} = await buildAndExtract('valid');
  assert.match(sh('unzip', ['-t', file]).stdout, /No errors detected/);
  const names = readdirSync(out).sort();
  for (const required of ['pass.json', 'manifest.json', 'signature', 'icon.png', 'icon@2x.png', 'logo.png']) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
});

test('manifest lists the SHA-1 of every other file', {skip: !hasOpenssl || !hasUnzip}, async () => {
  const {out} = await buildAndExtract('manifest');
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const files = readdirSync(out).filter(name => !['manifest.json', 'signature'].includes(name));
  assert.deepEqual(Object.keys(manifest).sort(), files.sort());
  for (const name of files) {
    assert.equal(manifest[name], createHash('sha1').update(readFileSync(join(out, name))).digest('hex'), name);
  }
});

test('signature verifies with openssl and fails for a changed manifest', {skip: !hasOpenssl || !hasUnzip}, async () => {
  const {out} = await buildAndExtract('signature');
  const verify = content => sh('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(out, 'signature'),
    '-content', content, '-CAfile', join(dir, 'root.pem'), '-purpose', 'any', '-out', '/dev/null'], {allowFailure: true});
  assert.equal(verify(join(out, 'manifest.json')).status, 0, verify(join(out, 'manifest.json')).stderr);
  const tampered = join(dir, 'tampered.json');
  writeFileSync(tampered, readFileSync(join(out, 'manifest.json'), 'utf8').replace('pass.json', 'pass.jsom'));
  assert.notEqual(verify(tampered).status, 0);
});

test('signature has the same CMS structure as openssl smime -sign', {skip: !hasOpenssl || !hasUnzip}, async () => {
  const {out} = await buildAndExtract('structure');
  const reference = join(dir, 'reference.der');
  sh('openssl', ['smime', '-sign', '-binary', '-in', join(out, 'manifest.json'), '-signer', join(dir, 'pass.pem'),
    '-inkey', join(dir, 'pass.key'), '-certfile', join(dir, 'wwdr.pem'), '-outform', 'DER', '-out', reference]);
  const ours = cmsSummary(join(out, 'signature'));
  const theirs = cmsSummary(reference);
  assert.deepEqual(ours.attributes, ['contentType', 'signingTime', 'messageDigest']);
  // openssl adds S/MIME capabilities, which wallet passes don't need; everything else must match.
  theirs.attributes = theirs.attributes.filter(name => name !== 'S/MIME');
  assert.deepEqual(ours, theirs);
  assert.equal(ours.eContentType, 'pkcs7-data');
  assert.ok(ours.detached);
  assert.deepEqual(ours.digestAlgorithms, ['sha256']);
  assert.equal(ours.certificates.length, 2);
});

test('pass.json: generic style, no barcode, offsets on every timestamp', () => {
  const pass = buildApplePassJson(trip, ids);
  assert.equal(pass.formatVersion, 1);
  assert.equal(pass.serialNumber, trip.id);
  assert.ok(pass.generic);
  for (const key of ['barcode', 'barcodes', 'relevantDate']) assert.equal(pass[key], undefined, key);
  assert.ok(pass.locations.length > 0 && pass.locations.length <= 10);
  const stamps = [pass.expirationDate, ...pass.relevantDates.flatMap(range => [range.startDate, range.endDate])];
  for (const stamp of stamps) assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[12]:00$/);
  assert.equal(pass.expirationDate, '2027-07-12T23:59:00+02:00');
  assert.deepEqual(pass.relevantDates[0], {startDate: '2027-07-10T08:50:00+02:00', endDate: '2027-07-10T21:00:00+02:00'});
  const front = Object.values(pass.generic).filter(Array.isArray);
  assert.ok(pass.generic.secondaryFields.length + pass.generic.auxiliaryFields.length <= 4);
  const keys = front.flat().map(field => field.key);
  assert.equal(new Set(keys).size, keys.length, 'field keys must be unique');
  const back = pass.generic.backFields.map(field => field.value).join('\n');
  assert.match(back, /Gruppe Mama/);
  assert.match(back, /Freier Tag/);
  assert.match(back, /kein Ticket/);
  assert.match(back, /sunset-dinner_event_399198/);
});

test('Vienna offsets follow EU summer time, cross-checked with Intl', () => {
  assert.equal(appleTimestamp('2027-01-15', 600), '2027-01-15T10:00:00+01:00');
  assert.equal(appleTimestamp('2027-03-28', 90), '2027-03-28T01:30:00+01:00');
  assert.equal(appleTimestamp('2027-03-28', 210), '2027-03-28T03:30:00+02:00');
  assert.equal(appleTimestamp('2027-10-31', 90), '2027-10-31T01:30:00+02:00');
  assert.equal(appleTimestamp('2027-10-31', 210), '2027-10-31T03:30:00+01:00');
  assert.equal(appleTimestamp('2027-07-10', 1440), '2027-07-11T00:00:00+02:00');
  const format = new Intl.DateTimeFormat('en-US', {timeZone: 'Europe/Vienna', timeZoneName: 'longOffset'});
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2031, 0, 1); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const stamp = appleTimestamp(date, 12 * 60);
    const expected = format.formatToParts(new Date(stamp)).find(part => part.type === 'timeZoneName').value;
    assert.equal(`GMT${stamp.slice(-6)}`, expected, date);
  }
});

test('long trip: 14 days × 3 stops stays within limits', {skip: !hasOpenssl || !hasUnzip}, async () => {
  const template = trip.days[0].stops;
  const long = {...trip, start: '2027-08-01', end: '2027-08-14', days: Array.from({length: 14}, (_, i) => {
    const date = `2027-08-${String(i + 1).padStart(2, '0')}`;
    return {date, label: `Tag ${i + 1}, ${i + 1}.8.`, stops: template.map((stop, j) => ({
      ...stop, latitude: stop.latitude + i * 0.001 + j * 0.0001, title: `${stop.title} ${i + 1}`
    }))};
  })};
  const pass = buildApplePassJson(long, ids);
  assert.equal(pass.locations.length, 10);
  assert.equal(pass.relevantDates.length, 14);
  for (const {startDate, endDate} of pass.relevantDates) {
    assert.ok(Date.parse(endDate) - Date.parse(startDate) <= 24 * 3600000);
  }
  assert.equal(pass.generic.backFields.filter(field => field.key.startsWith('day-')).length, 14);
  const {bytes, out} = await buildAndExtract('long', long);
  assert.ok(bytes.length < 100_000, `pkpass is ${bytes.length} bytes`);
  assert.ok(readFileSync(join(out, 'pass.json')).length < 40_000);
});

test('PKCS#1 keys are accepted; EC, encrypted and mismatched keys get clear errors', {skip: !hasOpenssl}, async () => {
  const pkcs1 = sh('openssl', ['rsa', '-in', 'pass.key', '-traditional']).stdout;
  assert.match(pkcs1, /BEGIN RSA PRIVATE KEY/);
  assert.ok((await buildApplePass(trip, {...config, privateKeyPem: pkcs1})).length > 1000);

  sh('openssl', ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', 'ec.key']);
  await assert.rejects(buildApplePass(trip, {...config, privateKeyPem: readFileSync(join(dir, 'ec.key'), 'utf8')}), /RSA/);

  const encrypted = sh('openssl', ['pkcs8', '-topk8', '-in', 'pass.key', '-passout', 'pass:secret']).stdout;
  await assert.rejects(buildApplePass(trip, {...config, privateKeyPem: encrypted}), /encrypted/);

  sh('openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', 'other.key']);
  await assert.rejects(buildApplePass(trip, {...config, privateKeyPem: readFileSync(join(dir, 'other.key'), 'utf8')}),
    /does not belong/);

  const {['icon.png']: _icon, ...noIcon} = images;
  await assert.rejects(buildApplePass(trip, {...config, images: noIcon}), /icon\.png/);
});
