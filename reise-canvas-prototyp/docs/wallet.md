# Reise-Canvas → Apple Wallet & Google Wallet

On the last step of the Reise-Canvas ("Eure Reisepostkarte ist fertig"), next to "PNG exportieren", families can
add their postcard to Apple Wallet or Google Wallet. The pass shows the family's own postcard as its picture,
plus village, dates, family, wishes and the day plan they picked in "Erlebnisse suchen" (including childcare
hours). It is an overview, **not a ticket, and has no barcode**. Language follows the canvas (Deutsch/English).

## How it works

1. On the last step the page asks `api/wallet/status`. Buttons only appear for wallets the server has
   credentials for, and only for fitting devices: iPhone/iPad/Safari on the Mac → Apple, Android → Google,
   everything else both. Nothing about the trip is sent before a button is tapped.
2. On tap, `dist/wallet.js` renders the **front** of the postcard in the sizes the wallets need (from the status
   response) and uploads them to `POST api/wallet/postcard`. The Apple strip is cropped around the family; the
   Google image shows the whole card on the canvas paper colour.
3. The browser then opens `api/wallet/apple?t=…&p=<postcard id>` (download of the `.pkpass`) or
   `api/wallet/google?t=…&p=<postcard id>` in a new tab (302 to Google's save page).
4. `t` carries the plan in a compact form (format documented in `server/wallet-trip.mjs`): people (kind, age,
   name), village, dates, wish keys and per planned slot the date, time and catalog position. The worker looks
   every activity up in its own copy of `dist/catalog.json`; titles, places and links never come from the browser.

No npm dependencies: zipping, PKCS#7 signing and JWTs use the runtime's WebCrypto and CompressionStream.

## Files

| Path | What |
|---|---|
| `dist/wallet.js` | Buttons, postcard rendering, upload, navigation (plus small hooks in `app.js`, `i18n.js`, `style.css`, `index.html`) |
| `server/worker.mjs` | Serves the canvas and the wallet routes |
| `server/wallet-trip.mjs` | Compact plan format → normalized trip |
| `server/wallet-apple.mjs`, `server/wallet-google.mjs` | Pass builders |
| `server/wallet-assets/` | Fixed pass images (icon, logo, Google logo) |
| `scripts/build.mjs` | Builds the worker bundle `dist/server/index.js` |
| `scripts/dev.mjs` | Local server with in-memory postcard storage |
| `tests/` | `node --test reise-canvas-prototyp/tests/*.test.mjs` |

## Routes

| Route | |
|---|---|
| `GET /api/wallet/status` | `{apple, google, strip: [[w,h]×3], hero: [w,h]}` |
| `POST /api/wallet/postcard` | Same-origin multipart: `strip`, `strip@2x`, `strip@3x`, `hero` (PNG, exact sizes, ≤ 1 MB each) and `end` (trip end). Returns `{id, expires}` |
| `GET /api/wallet/postcards/<id>/hero.png` | Public, so Google can load the picture |
| `GET /api/wallet/apple?t=…&p=…&l=…` | Signed `.pkpass` |
| `GET /api/wallet/google?t=…&p=…&l=…` | 302 to the Google save link |
| `GET /wallet/logo.png` | Fixed Google logo |
| everything else | The canvas files from `dist/` |

Errors on the pass routes come back as a small page in the canvas language (`l=de|en`).

## Postcard storage (R2)

Uploaded postcards are stored in the R2 bucket bound as `BUCKET` under `postcards/<id>/`, with an `expires`
timestamp 30 days after the trip ends. Expired postcards are no longer served and are deleted when someone
requests them; the pass routes then build the pass without the picture. There is no scheduled cleanup yet, so
an R2 lifecycle rule (e.g. delete objects under `postcards/` after 400 days) is a good safety net.

The images show the family figures and, if the family entered names in the person editor, those names above
the figures. Google needs the picture under a public URL; the id in it is a random UUID.

## Deploying

The Reise-Canvas used to be a static site. It is now a worker:

- `.openai/hosting.json` binds R2 as `BUCKET` (the `static` entry is gone).
- Before deploying, build the bundle: `node reise-canvas-prototyp/scripts/build.mjs` → `dist/server/index.js`
  (git-ignored). It embeds every file directly in `dist/`, so rebuild after every change to the canvas.
- The GitHub Pages copy stays static: `scripts/build-pages.mjs` skips `dist/server/`, the status request fails
  there and no wallet buttons appear.

## Secrets

| Variable | Value |
|---|---|
| `APPLE_PASS_TYPE_ID` | e.g. `pass.at.familienzeit.trip` |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_PASS_CERT` | Pass Type ID certificate (PEM) |
| `APPLE_PASS_KEY` | its private key (PKCS#8 PEM, unencrypted) |
| `APPLE_WWDR_CERT` | Apple WWDR G4 intermediate (PEM) |
| `GOOGLE_ISSUER_ID` | Issuer ID from the Google Pay & Wallet Console |
| `GOOGLE_SA_EMAIL` | service account `client_email` |
| `GOOGLE_SA_KEY` | service account `private_key` |

PEM values can be pasted as PEM, with escaped `\n`, or base64-encoded. Store them as hosted secrets in the Site
settings, never in `hosting.json` or the repository.

## Apple setup

Needs a paid Apple Developer account. Exact commands are in the header of `scripts/sample-apple-pass.mjs`.

1. Certificates, Identifiers & Profiles → Identifiers → Pass Type IDs → new ID.
2. Create a key + CSR with openssl, upload the CSR to create the certificate, convert the `.cer` to PEM
   (or export the Keychain `.p12` and convert it).
3. Download "Worldwide Developer Relations – G4" from apple.com/certificateauthority and convert it to PEM.
4. Test without the worker:
   `APPLE_PASS_CERT_FILE=… APPLE_PASS_KEY_FILE=… APPLE_WWDR_CERT_FILE=… node reise-canvas-prototyp/scripts/sample-apple-pass.mjs`
   and AirDrop the sample pass to an iPhone.

## Google setup

Free. New issuer accounts start in **Demo Mode**: passes show "[TEST ONLY]" and only console users and test
accounts can save them. Details in the header of `scripts/sample-google-link.mjs`.

1. Google Pay & Wallet Console → Google Wallet API → accept terms, note the Issuer ID.
2. Add every Google account that should save passes (team, jury) as a test account.
3. Google Cloud: enable the Google Wallet API, create a service account and a JSON key.
4. Wallet Console → Users: invite the service account email as Developer.
5. Test: `GOOGLE_SA_JSON_FILE=… GOOGLE_ISSUER_ID=… WALLET_PUBLIC_ORIGIN=https://<site> node reise-canvas-prototyp/scripts/sample-google-link.mjs`

Google loads the logo and the postcard from the site, so they only appear when the site runs on https. A full
pass does not fit Google's safe link length (1800 characters), so the worker creates the pass through the Wallet
API and redirects to a short link; this needs outbound HTTPS to `oauth2.googleapis.com` and
`walletobjects.googleapis.com`. If that fails it falls back to the long link.

## Try it locally

```sh
node reise-canvas-prototyp/scripts/dev.mjs            # → http://localhost:8788
```

Without credentials no wallet buttons appear. With credentials:

```sh
APPLE_PASS_CERT_FILE=pass-cert.pem APPLE_PASS_KEY_FILE=pass-key.pem APPLE_WWDR_CERT_FILE=wwdr.pem \
GOOGLE_SA_JSON_FILE=service-account.json GOOGLE_ISSUER_ID=3388000000000000000 \
node reise-canvas-prototyp/scripts/dev.mjs
```

Open the "Im selben WLAN" address on a phone in the same Wi-Fi to add the pass there. Postcards live in memory
until the server stops.

## Not verified yet

- A pass signed with a real Apple certificate on a real iPhone (the strip image and lock-screen relevance).
- Google API inserts with a real issuer account, and how the postcard picture renders on Android.
- The ChatGPT Sites deploy as a worker with R2 (the setup mirrors the Familienzeit project).
- Official "Add to Apple Wallet" / "Add to Google Wallet" badges: the buttons are placeholders until the
  official artwork is added (see the TODO in `dist/wallet.js`).
