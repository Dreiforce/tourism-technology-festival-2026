// Real test against WalletWallet: builds the sample trip (tests/fixtures/trip.json) as an Apple Wallet pass,
// signed by WalletWallet, and writes the .pkpass file.
//   node reise-canvas-prototyp/scripts/sample-walletwallet-pass.mjs
// Optional: WALLETWALLET_API_KEY (otherwise the prototype key in server/wallet-walletwallet.mjs),
//           STRIP_PNG=/path/to/postcard-strip.png (1125 × 369 px), TRIP_LANG=en, OUT=/path/to/file.pkpass
// Open the file on a Mac (Wallet preview) or AirDrop it to an iPhone.
import {readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApplePassJson} from '../server/wallet-apple.mjs';
import {buildWalletWalletPass, WALLETWALLET_API_KEY} from '../server/wallet-walletwallet.mjs';

const trip = JSON.parse(readFileSync(new URL('../tests/fixtures/trip.json', import.meta.url), 'utf8'));
if (process.env.TRIP_LANG === 'en') trip.lang = 'en';
// Move the sample trip into the future, so the pass doesn't expire right away.
const shift = Math.max(0, Math.ceil((Date.now() - Date.parse(trip.start)) / 86400000) + 14);
const later = date => new Date(Date.parse(date) + shift * 86400000).toISOString().slice(0, 10);
Object.assign(trip, {start: later(trip.start), end: later(trip.end), days: trip.days.map(day => ({...day, date: later(day.date)}))});

const asset = name => readFileSync(new URL(`../server/wallet-assets/apple/${name}`, import.meta.url));
const strip = process.env.STRIP_PNG ? readFileSync(process.env.STRIP_PNG) : null;
const passJson = buildApplePassJson(trip, {images: strip ? {'strip.png': strip} : {}});
const pass = await buildWalletWalletPass(trip, passJson, {
  apiKey: process.env.WALLETWALLET_API_KEY || WALLETWALLET_API_KEY,
  images: {strip3x: strip, logo: asset('logo@3x.png'), icon: asset('icon@3x.png')},
  barcodeUrl: 'https://github.com/Dreiforce/tourism-technology-festival-2026'
});
const out = process.env.OUT || join(tmpdir(), 'familienzeit-walletwallet.pkpass');
writeFileSync(out, pass);
console.log(`Wrote ${out} (${pass.length} bytes), signed by WalletWallet.`);
