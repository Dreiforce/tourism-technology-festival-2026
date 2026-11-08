// Tests for the Apple Wallet export. Run: node --test reise-canvas-prototyp/tests/wallet-apple.test.mjs
// Uses a throwaway certificate chain (fake root → fake "WWDR" intermediate → pass certificate) made with openssl,
// so the signature is checked by an independent CMS implementation. Skips when openssl is missing.
import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {buildApplePass, buildApplePassJson, appleTimestamp, APPLE_STRIP_SIZES} from '../server/wallet-apple.mjs';

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;
const hasUnzip = spawnSync('unzip', ['-v']).status === 0;
const assets = new URL('../server/wallet-assets/apple/', import.meta.url);
const trip = JSON.parse(readFileSync(new URL('./fixtures/trip.json', import.meta.url), 'utf8'));
const images = Object.fromEntries(readdirSync(assets).filter(name => name.endsWith('.png'))
  .map(name => [name, new Uint8Array(readFileSync(new URL(name, assets)))]));
const ids = {passTypeIdentifier: 'pass.at.familienzeit.test', teamIdentifier: 'TEAM123456'};
let dir, config;

// Minimal PNG encoder for test images of exact sizes (RGB, one colour band per row).
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set([200, 100 + (y % 100), 60], row + 1 + x * 3);
  }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const strips = Object.fromEntries(APPLE_STRIP_SIZES.map(([w, h], i) => [`strip${i ? `@${i + 1}x` : ''}.png`, png(w, h)]));
const allText = pass => JSON.stringify(pass);

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

test('pass.json: generic style without strip, no barcode, offsets on every timestamp', () => {
  const pass = buildApplePassJson(trip, ids);
  assert.equal(pass.formatVersion, 1);
  assert.equal(pass.serialNumber, trip.id);
  assert.ok(pass.generic);
  assert.equal(pass.eventTicket, undefined);
  for (const key of ['barcode', 'barcodes', 'relevantDate']) assert.equal(pass[key], undefined, key);
  // Childcare happens at the village centre and isn't a place to surface the pass: activities only.
  assert.equal(pass.locations.length, 3);
  assert.ok(pass.locations.every(location => !/Kinderbetreuung/.test(location.relevantText)));
  const stamps = [pass.expirationDate, ...pass.relevantDates.flatMap(range => [range.startDate, range.endDate])];
  for (const stamp of stamps) assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[12]:00$/);
  assert.equal(pass.expirationDate, '2027-07-12T23:59:00+02:00');
  assert.deepEqual(pass.relevantDates, [
    {startDate: '2027-07-10T08:30:00+02:00', endDate: '2027-07-10T15:30:00+02:00'},
    {startDate: '2027-07-11T08:00:00+02:00', endDate: '2027-07-11T12:30:00+02:00'}
  ]);
  assert.equal(pass.generic.headerFields[0].value, '10.–12. Juli');
  assert.ok(pass.generic.secondaryFields.length + pass.generic.auxiliaryFields.length <= 4);
  for (const style of [pass, buildApplePassJson(trip, {...ids, images: strips})]) {
    const fields = style.generic || style.eventTicket;
    const keys = Object.values(fields).filter(Array.isArray).flat().map(field => field.key);
    assert.equal(new Set(keys).size, keys.length, 'field keys must be unique across front and back');
  }
  const back = Object.fromEntries(pass.generic.backFields.map(field => [field.key, field.value]));
  assert.equal(back.members, 'Mama · Papa · Lena (9) · Kind (4) · Hund Bello');
  assert.equal(back['wish-list'], 'Abenteuer · Wasser');
  assert.match(back['day-2027-07-11'], /^Kinderbetreuung 09:00–12:00$/m);
  assert.match(back['day-2027-07-11'], /Gruppe 1 · Fiss/);
  assert.equal(back['day-2027-07-12'], 'Noch nichts geplant');
  assert.match(back.about, /kein Ticket/);
  assert.match(back['day-2027-07-10'], /murmlis-und-bertas-bergabenteuer/);
});

test('prices === false: no price lines, no total anywhere', () => {
  for (const lang of ['de', 'en']) {
    for (const images of [undefined, strips]) {
      const text = allText(buildApplePassJson({...trip, lang}, {...ids, images}));
      assert.doesNotMatch(text, /€|EUR|Preis|Eintritt|[Pp]rice|[Ee]ntry|SUMME|TOTAL/, `${lang} ${images ? 'strip' : 'generic'}`);
    }
  }
  // The price path still works for trips that do carry prices.
  const priced = structuredClone(trip);
  priced.prices = true;
  priced.total = 34;
  priced.totalLabel = 'Summe der bekannten Eintrittspreise';
  priced.days[0].stops[1].price = 34;
  const text = allText(buildApplePassJson(priced, ids));
  assert.match(text, /€\s34,00 geschätzt/);
  assert.match(text, /SUMME DER BEKANNTEN EINTRITTSPREISE/);
  assert.match(text, /Preis beim Anbieter/);
});

test('with the postcard strip: eventTicket, empty primary row, no thumbnail', () => {
  const pass = buildApplePassJson(trip, {...ids, images: strips});
  assert.equal(pass.generic, undefined);
  const ticket = pass.eventTicket;
  assert.ok(ticket);
  assert.deepEqual(ticket.primaryFields, [], 'nothing is drawn over the postcard');
  assert.deepEqual(ticket.secondaryFields.map(field => field.key), ['place', 'family']);
  assert.deepEqual(ticket.auxiliaryFields.map(field => field.key), ['first', 'wishes']);
  assert.ok(ticket.secondaryFields.length + ticket.auxiliaryFields.length <= 4);
  assert.equal(ticket.auxiliaryFields[0].value, 'Sa. 09:30 · Murmliwasser am Komperdell');
  assert.ok(ticket.backFields.length >= 6);
  assert.deepEqual(APPLE_STRIP_SIZES, [[375, 98], [750, 196], [1125, 294]]);
});

test('English labels for lang "en"', () => {
  const english = structuredClone(trip);
  english.lang = 'en';
  for (const images of [undefined, strips]) {
    const pass = buildApplePassJson(english, {...ids, images});
    const fields = pass.generic || pass.eventTicket;
    assert.equal(pass.description, 'Familienzeit holiday plan');
    assert.equal(fields.headerFields[0].label, 'HOLIDAY');
    assert.equal(fields.headerFields[0].value, '10–12 July');
    const back = Object.fromEntries(fields.backFields.map(field => [field.key, field]));
    assert.equal(back.members.label, 'FAMILY');
    assert.equal(back.members.value, 'Mama · Papa · Lena (9) · Child (4) · Bello (dog)');
    assert.match(back.about.value, /^Family time in Serfaus, 10–12 July 2027\./);
    assert.match(back.about.value, /not a ticket/);
    assert.equal(back['day-2027-07-12'].value, 'Nothing planned yet');
    assert.equal(back.note.label, 'NOTE');
    assert.doesNotMatch(allText({...pass, ...{organizationName: ''}}).replace(trip.estimateNote, ''),
      /URLAUB|FAMILIE|ERSTER|WÜNSCHE|Noch nichts|kein Ticket|Jänner|Juli/);
  }
  const winter = {...english, start: '2027-01-02', end: '2027-01-03', days: [{date: '2027-01-02', label: 'Sat, 2 Jan', stops: []}]};
  assert.equal(buildApplePassJson(winter, ids).generic.headerFields[0].value, '2–3 January');
  assert.equal(buildApplePassJson({...winter, lang: 'de'}, ids).generic.headerFields[0].value, '2.–3. Jänner');
});

test('eventTicket .pkpass: strip files signed, thumbnail dropped', {skip: !hasOpenssl || !hasUnzip}, async () => {
  const {file, out} = await buildAndExtract('strip', trip, {images: {...images, ...strips}});
  assert.match(sh('unzip', ['-t', file]).stdout, /No errors detected/);
  const names = readdirSync(out).sort();
  for (const name of ['strip.png', 'strip@2x.png', 'strip@3x.png', 'icon.png', 'logo.png']) assert.ok(names.includes(name), name);
  assert.ok(!names.some(name => name.startsWith('thumbnail')), 'Wallet does not combine a strip with a thumbnail');
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest['strip@3x.png'], createHash('sha1').update(strips['strip@3x.png']).digest('hex'));
  assert.ok(JSON.parse(readFileSync(join(out, 'pass.json'), 'utf8')).eventTicket);
  const verify = sh('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(out, 'signature'),
    '-content', join(out, 'manifest.json'), '-CAfile', join(dir, 'root.pem'), '-purpose', 'any', '-out', '/dev/null'], {allowFailure: true});
  assert.equal(verify.status, 0, verify.stderr);
});

test('unknown image names are rejected', async () => {
  await assert.rejects(buildApplePass(trip, {...ids, certificatePem: 'x', privateKeyPem: 'x', wwdrPem: 'x',
    images: {'icon.png': new Uint8Array(1), 'evil.png': new Uint8Array(1)}}), /unexpected image name/);
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
  assert.ok(buildApplePassJson(long, {...ids, images: strips}).eventTicket.backFields.length >= 14);
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

test('QR code to the Reise-Canvas home page and the booking number', () => {
  const trip0 = trip;
  const booked = {...trip0, booking: {ref: 'FZ-AB12CD'},
    days: trip0.days.map((day, i) => ({...day, stops: day.stops.map((stop, j) => i === 0 && j === 0
      ? {...stop, booked: true, booking: 'booked', bookingLabel: 'Gebucht (Demo)'} : stop)}))};
  const pass = buildApplePassJson(booked, {passTypeIdentifier: 'pass.test', teamIdentifier: 'T', images: {'strip.png': new Uint8Array(1)},
    barcodeUrl: 'https://dreiforce.github.io/tourism-technology-festival-2026/reise-canvas-prototyp/'});
  assert.deepEqual(pass.barcodes, [{format: 'PKBarcodeFormatQR', message: 'https://dreiforce.github.io/tourism-technology-festival-2026/reise-canvas-prototyp/',
    messageEncoding: 'iso-8859-1', altText: 'Familienzeit öffnen'}]);
  assert.deepEqual(pass.eventTicket.auxiliaryFields.at(-1), {key: 'booking', label: 'BUCHUNG', value: 'FZ-AB12CD'});
  assert.match(pass.eventTicket.backFields.find(field => field.key === 'booking-info').value, /FZ-AB12CD – bei Familienzeit gebucht \(Demo\)/);
  assert.match(pass.eventTicket.backFields.find(field => field.key === 'day-2027-07-10').value, /Gebucht \(Demo\)/);
  const keys = [...Object.values(pass.eventTicket).flat().map(field => field.key)];
  assert.equal(new Set(keys).size, keys.length, 'field keys stay unique');
  assert.equal(buildApplePassJson(trip0, {images: {}}).barcodes, undefined, 'no QR code without a home address');
});
