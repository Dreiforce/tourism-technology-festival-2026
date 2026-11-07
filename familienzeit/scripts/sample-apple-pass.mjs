// Builds a real, signed sample pass from tests/fixtures/trip.json so you can try it on an iPhone.
// Output: familienzeit/dist/familienzeit-sample.pkpass → AirDrop or mail it to an iPhone, or open it on a Mac.
//
// One-time setup (needs a paid Apple Developer account with access to "Certificates, Identifiers & Profiles"):
//
// 1. Identifiers → "+" → Pass Type IDs → e.g. pass.at.familienzeit.trip
// 2. Make a key and certificate request without Keychain:
//      openssl req -new -newkey rsa:2048 -nodes -keyout pass-key.pem -out pass.csr \
//        -subj "/emailAddress=you@example.com/CN=Familienzeit Wallet/C=AT"
//    Open the Pass Type ID → "Create Certificate" → upload pass.csr → download pass.cer, then:
//      openssl x509 -inform DER -in pass.cer -out pass-cert.pem
//    (If you made the request in Keychain Access instead: export certificate + key as Certificates.p12, then
//      openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -legacy -out pass-cert.pem
//      openssl pkcs12 -in Certificates.p12 -nocerts -nodes -legacy | openssl pkcs8 -topk8 -nocrypt -out pass-key.pem
//     -legacy is needed with OpenSSL 3 for Keychain exports; drop it on LibreSSL/macOS's openssl if it complains.)
// 3. Apple's intermediate: on https://www.apple.com/certificateauthority/ download
//    "Worldwide Developer Relations - G4" (AppleWWDRCAG4.cer), then:
//      openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
// 4. Run from the repo root:
//      APPLE_PASS_CERT_FILE=pass-cert.pem APPLE_PASS_KEY_FILE=pass-key.pem APPLE_WWDR_CERT_FILE=wwdr.pem \
//        node familienzeit/scripts/sample-apple-pass.mjs
//    APPLE_PASS_TYPE_ID and APPLE_TEAM_ID are read from the certificate (UID and OU) unless you set them.
//
// The worker needs the same three PEM files as secrets (see the wallet setup notes); keep pass-key.pem out of git.
import {X509Certificate} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {buildApplePass} from '../server/wallet-apple.mjs';

const file = name => {
  const path = process.env[name];
  if (!path) {
    console.error(`Missing ${name}. See the setup steps at the top of this script.`);
    process.exit(1);
  }
  return readFileSync(path, 'utf8');
};

const certificatePem = file('APPLE_PASS_CERT_FILE');
const privateKeyPem = file('APPLE_PASS_KEY_FILE');
const wwdrPem = file('APPLE_WWDR_CERT_FILE');

const certificate = new X509Certificate(certificatePem);
const subject = Object.fromEntries(certificate.subject.split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)));
const passTypeIdentifier = process.env.APPLE_PASS_TYPE_ID || subject.UID;
const teamIdentifier = process.env.APPLE_TEAM_ID || subject.OU;
if (!passTypeIdentifier || !teamIdentifier) {
  console.error('Could not read the Pass Type ID / Team ID from the certificate. Set APPLE_PASS_TYPE_ID and APPLE_TEAM_ID.');
  process.exit(1);
}
if (subject.UID && subject.UID !== passTypeIdentifier) {
  console.warn(`Warning: the certificate is for ${subject.UID}, not ${passTypeIdentifier}. iOS will reject the pass.`);
}
if (Date.parse(certificate.validTo) < Date.now()) console.warn(`Warning: the certificate expired on ${certificate.validTo}.`);
if (!new X509Certificate(wwdrPem).subject.includes('G4')) {
  console.warn('Warning: wwdr.pem does not look like the WWDR G4 intermediate.');
}

const assets = new URL('../server/wallet-assets/apple/', import.meta.url);
const images = Object.fromEntries(readdirSync(assets).filter(name => name.endsWith('.png'))
  .map(name => [name, new Uint8Array(readFileSync(new URL(name, assets)))]));
const trip = JSON.parse(readFileSync(new URL('../tests/fixtures/trip.json', import.meta.url), 'utf8'));

const bytes = await buildApplePass(trip, {passTypeIdentifier, teamIdentifier, certificatePem, privateKeyPem, wwdrPem, images});
const output = new URL('../dist/', import.meta.url);
mkdirSync(output, {recursive: true});
writeFileSync(new URL('familienzeit-sample.pkpass', output), bytes);
console.log(`Wrote familienzeit/dist/familienzeit-sample.pkpass (${bytes.length} bytes) for ${passTypeIdentifier}, team ${teamIdentifier}.`);
