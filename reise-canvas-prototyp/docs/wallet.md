# Reise-Canvas → Apple Wallet & Google Wallet

On the last step of the Reise-Canvas ("Eure Reisepostkarte ist fertig"), next to "PNG exportieren", families can
add their postcard to Apple Wallet or Google Wallet. The pass shows the family's own postcard as its picture,
plus village, dates, family, wishes and the day plan they picked in "Erlebnisse suchen" (including childcare
hours). It is an overview, **not a ticket**. Its QR code opens the Reise-Canvas home page (captioned "Reise-Canvas
öffnen"), handy for showing the pass in the pitch. Language follows the canvas (Deutsch/English).

**Bookings.** The same buttons also appear in the confirmation of the canvas' demo booking (`dist/booking.js`), next
to the calendar file. Booked activities travel with their booked time and a booked flag, plus the trip's booking
number (`state.tripRef`, e.g. `FZ-AB12CD`). The pass shows the number on the front ("BUCHUNG"), marks booked
activities ("Gebucht (Demo)" / ✓) and says on the back that the demo booking reserves and pays nothing.

**The picture** is the whole postcard, never cropped: on the wide Apple strip it sits centred on the pass's dark
green like a framed card, on Google's taller image on the canvas paper colour.

## How it works

1. On the last step the page asks `api/wallet/status`. The buttons appear whenever the worker answers (not on the
   static GitHub Pages copy), for fitting devices: iPhone/iPad/Safari on the Mac → Apple, Android → Google,
   everything else both. A wallet without credentials says so on tap. Nothing about the trip is sent before a
   button is tapped.
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
| `server/wallet-walletwallet.mjs` | Apple passes signed by WalletWallet (when there is no own Apple certificate) |
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
| `WALLETWALLET_API_KEY` | optional; overrides the prototype key in `server/wallet-walletwallet.mjs` |

PEM values can be pasted as PEM, with escaped `\n`, or base64-encoded. Store them as hosted secrets in the Site
settings, never in `hosting.json` or the repository.

## Apple via WalletWallet (no Apple Developer account needed)

Without an own Apple certificate, Apple passes are signed by [WalletWallet](https://walletwallet.dev), which uses its
own Pass Type ID certificate. This is the current setup of the prototype.

1. The family taps "Zu Apple Wallet hinzufügen". The browser renders the postcard as a store-card strip
   (1125 × 369 px) and uploads it, as above.
2. The worker builds the same content as our own Apple pass (`buildApplePassJson`), maps it onto WalletWallet's
   request (`POST https://api.walletwallet.dev/api/passes`, Bearer key, postcard and logo as PNG data URIs) and
   passes the signed `.pkpass` that comes back straight to Safari. The family only sees Apple's "Add" sheet.
3. Their limits are respected: ≤ 10 fields per area, ≤ 256 characters per value (days become one line per stop;
   long trips merge neighbouring days), ≤ 10 locations, request ≤ 2 MB.
4. Fallbacks: if the plan doesn't allow Pro fields (custom colour, images), the pass is requested again without
   them (free plan: green preset, no postcard picture). If WalletWallet insists on a barcode, it gets a link to the
   canvas. The older `/api/pkpass` endpoint is used if `/api/passes` doesn't exist.

The key: the prototype key sits at the top of `server/wallet-walletwallet.mjs`; the secret `WALLETWALLET_API_KEY`
overrides it. **Anyone who can read the repository can use that key** (free plan: 1,000 passes a month) – if the
repository is public, rotate the key at walletwallet.dev and keep it only as a secret. The family's plan, names and
postcard are sent to WalletWallet to build the pass. Compared with our own signing, WalletWallet passes use the
store-card layout and have no date-based lock-screen relevance (locations only).

Real test from your own machine (the WalletWallet API must be reachable):

```sh
node reise-canvas-prototyp/scripts/sample-walletwallet-pass.mjs   # writes familienzeit-walletwallet.pkpass to the temp folder
```

## Static copy on GitHub Pages (no worker)

GitHub Pages only serves files, so there is no worker to upload the postcard or sign passes. Instead,
`scripts/build-pages.mjs` publishes `wallet-trip`, `wallet-apple` and `wallet-walletwallet` (as `wallet/*.js`) plus
the logo and icon next to the canvas and marks the page with `<meta name="wallet-direct">`. On that page
`dist/wallet.js` skips the worker and, on tap:

1. builds the same pass content in the browser (`decodeTripParam` → `resolveTrip` → `buildApplePassJson`),
   renders the postcard strip (1125 × 369 px) and sends everything to WalletWallet (`createWalletWalletPass`);
2. opens the result:
   - Apple button on iPhone, iPad or Mac Safari: the pass file itself
     (`https://api.walletwallet.dev/p/<serial>/apple.pkpass`, served as `application/vnd.apple.pkpass`), so Apple's
     "Add to Wallet" sheet opens right away on top of the canvas;
     On these devices the pass is prepared first and shown in our own popup ("Eure Wallet-Karte ist fertig", with the
     postcard as preview). Its button is a real link, so Safari opens Apple's sheet on the tap instead of asking
     whether the page may show a pass. On iPhone/iPad the page then asks WalletWallet whether a phone has the pass
     (`walletWalletInstalls`: an update answers with `notifiedDevices`); only then "Karte hinzugefügt" pops up with
     "Wallet öffnen" (`shoebox://`). At most four checks per pass, each counts against the WalletWallet quota;
   - Apple button elsewhere: WalletWallet's install page (`shareUrl`) in a new tab, with a QR code for the phone;
   - Google button: the Save to Google Wallet link in a new tab. Google passes therefore also come from WalletWallet
     on the static copy.

WalletWallet accepts these calls from the browser (checked from dreiforce.github.io). The API key is in the published
`wallet/wallet-walletwallet.js`, so **every visitor of the page can read it**. Fine for the hackathon prototype on the
free plan; rotate it at walletwallet.dev afterwards.

## Apple setup (own certificate)

Needs a paid Apple Developer account; when the five `APPLE_*` secrets are set, they take precedence over WalletWallet. Exact commands are in the header of `scripts/sample-apple-pass.mjs`.

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

Apple works right away through WalletWallet (prototype key). Google needs credentials:

```sh
APPLE_PASS_CERT_FILE=pass-cert.pem APPLE_PASS_KEY_FILE=pass-key.pem APPLE_WWDR_CERT_FILE=wwdr.pem \
GOOGLE_SA_JSON_FILE=service-account.json GOOGLE_ISSUER_ID=3388000000000000000 \
node reise-canvas-prototyp/scripts/dev.mjs
```

Open the "Im selben WLAN" address on a phone in the same Wi-Fi to add the pass there. Postcards live in memory
until the server stops.

## Not verified yet

- A real WalletWallet round trip: the cloud sandbox this was built in cannot reach `api.walletwallet.dev`, so the
  WalletWallet path is tested against a fake API only. Run `scripts/sample-walletwallet-pass.mjs` once.
- A pass signed with a real Apple certificate on a real iPhone (the strip image and lock-screen relevance).
- Google API inserts with a real issuer account, and how the postcard picture renders on Android.
- The ChatGPT Sites deploy as a worker with R2 (the setup mirrors the Familienzeit project).
- Official "Add to Apple Wallet" / "Add to Google Wallet" badges: the buttons are placeholders until the
  official artwork is added (see the TODO in `dist/wallet.js`).
