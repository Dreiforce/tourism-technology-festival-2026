// Prints a "Save to Google Wallet" link for the sample trip (tests/fixtures/trip.json), so the team can try the pass
// on an Android phone before the worker is deployed.
//
//   GOOGLE_SA_JSON_FILE=./familienzeit-wallet.json \
//   GOOGLE_ISSUER_ID=3388000000012345678 \
//   WALLET_PUBLIC_ORIGIN=https://<your-site>.chatgpt.site \
//   node reise-canvas-prototyp/scripts/sample-google-link.mjs
//
// Optional: GOOGLE_WALLET_MODE=auto|api|jwt (default auto; see server/wallet-google.mjs).
// Optional: HERO_IMAGE_URL=https://… public PNG (1032×812) to try the postcard as the pass picture.
// Optional: TRIP_LANG=en for the English pass.
//
// One-time setup (Google Wallet API, Demo Mode is enough for the hackathon):
//  1. Google Pay & Wallet Console (https://pay.google.com/business/console): open "Google Wallet API",
//     accept the terms and copy the Issuer ID.
//  2. Same console, Google Wallet API → Manage → "Set up test accounts": add every Google account that should be
//     able to save the pass. In Demo Mode only these test accounts (and console users with Admin/Developer
//     access) can save passes, and the pass title gets a "[TEST ONLY]" prefix.
//  3. Google Cloud console: pick or create a project and enable the "Google Wallet API".
//  4. IAM & Admin → Service accounts: create one, then Keys → Add key → JSON. Keep the file out of git.
//  5. Back in the Pay & Wallet Console → Users: invite the service account's e-mail (client_email) with
//     Developer or Admin access.
//
// Worker secrets for the same account: GOOGLE_ISSUER_ID, GOOGLE_SA_EMAIL (= client_email) and
// GOOGLE_SA_KEY (= private_key). WALLET_PUBLIC_ORIGIN must serve /wallet/logo.png and /wallet/hero.png over HTTPS,
// because Google loads the images from there; without it the pass is saved without images.
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {buildGoogleSaveUrl, GOOGLE_WALLET_SAFE_JWT_LENGTH} from '../server/wallet-google.mjs';

const {GOOGLE_SA_JSON_FILE: keyFile, GOOGLE_ISSUER_ID: issuerId, WALLET_PUBLIC_ORIGIN: origin = '', GOOGLE_WALLET_MODE: mode = 'auto',
  HERO_IMAGE_URL: heroImageUrl, TRIP_LANG: lang} = process.env;
if (!keyFile || !issuerId) {
  console.error('Please set GOOGLE_SA_JSON_FILE and GOOGLE_ISSUER_ID (see the comment at the top of this file).');
  process.exit(1);
}
if (!origin.startsWith('https://')) console.warn('WALLET_PUBLIC_ORIGIN is not an https origin: the pass will have no logo or image.');

const account = JSON.parse(await readFile(keyFile, 'utf8'));
const trip = JSON.parse(await readFile(new URL('../tests/fixtures/trip.json', import.meta.url), 'utf8'));
trip.id = randomUUID();
if (lang === 'en') trip.lang = 'en';

const url = await buildGoogleSaveUrl(trip, {
  issuerId, serviceAccountEmail: account.client_email, privateKeyPem: account.private_key, origin, mode, heroImageUrl
});
const jwtLength = url.length - 'https://pay.google.com/gp/v/save/'.length;
console.log(url);
console.error(`\nJWT length ${jwtLength} (${jwtLength <= GOOGLE_WALLET_SAFE_JWT_LENGTH ? 'within' : 'over'} Google's safe length of ${GOOGLE_WALLET_SAFE_JWT_LENGTH}). Open the link on an Android phone signed in with a test account.`);
