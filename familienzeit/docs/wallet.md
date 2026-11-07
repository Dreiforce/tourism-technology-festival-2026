# Plan mitnehmen – Apple Wallet & Google Wallet

At the end of planning, the booking dialog ("Zu den Buchungsoptionen") offers the plan as a wallet card.
The card is an overview for the family: dates, family, guest card (information only), one section per day with
times, places, booking way and estimated price. **It is not a ticket and has no barcode.**

## How it works

1. The dialog renders two links (iPhone/Mac → Apple only, Android → Google only, otherwise both).
   Nothing is sent anywhere until someone taps one.
2. The link carries the plan in `?t=` (compact format v1, base64url JSON, see `server/wallet-trip.mjs`).
3. The worker resolves every activity id against its own catalog (titles, addresses, coordinates never come
   from the browser) and builds the card on the fly. Nothing is stored.
   - `GET /api/wallet/apple?t=…` → signed `.pkpass` (`server/wallet-apple.mjs`)
   - `GET /api/wallet/google?t=…` → 302 to `pay.google.com/gp/v/save/…` (`server/wallet-google.mjs`)
   - `GET /wallet/logo.png`, `/wallet/hero.png` → public images Google loads for the card
4. No npm dependencies: signing, zipping and JWTs use the runtime's WebCrypto/CompressionStream.

The GitHub Pages edition is static and cannot sign. It shows the wallet section only when the repository
variable `WALLET_URL` points to the worker's wallet base, e.g. `https://<site>/api/wallet`
(passed to `scripts/build-pages.mjs` as `PAGES_WALLET_URL`). Activity ids must then exist in the worker's
catalog too.

## Try it locally

```sh
node familienzeit/scripts/dev.mjs            # → http://localhost:8787
```

Runs the real worker with the catalog from `server/catalog.json`. Plan a trip, open "Zu den
Buchungsoptionen" and scroll to "Plan mitnehmen". Without credentials the buttons open a
"noch nicht eingerichtet" page. With credentials:

```sh
APPLE_PASS_CERT_FILE=pass-cert.pem APPLE_PASS_KEY_FILE=pass-key.pem APPLE_WWDR_CERT_FILE=wwdr.pem \
GOOGLE_SA_JSON_FILE=service-account.json GOOGLE_ISSUER_ID=3388000000000000000 \
node familienzeit/scripts/dev.mjs
```

To add the pass on a phone, open the "Im selben WLAN" address the script prints on the phone (same Wi-Fi).
Google only shows the logo and hero image when the site runs on https, so locally the card has no images.

## Worker secrets

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

PEM values can be pasted as PEM, with escaped `\n`, or base64-encoded. Without them, the routes answer
"… ist auf diesem Server noch nicht eingerichtet." (503).

## Apple setup

Needs a paid Apple Developer account. Exact commands are in the header of `scripts/sample-apple-pass.mjs`.

1. Certificates, Identifiers & Profiles → Identifiers → Pass Type IDs → new ID.
2. Create a key + CSR with openssl, upload the CSR to create the certificate, convert the `.cer` to PEM.
3. Download "Worldwide Developer Relations – G4" from apple.com/certificateauthority and convert it to PEM.
4. Test without the worker:
   `APPLE_PASS_CERT_FILE=… APPLE_PASS_KEY_FILE=… APPLE_WWDR_CERT_FILE=… node scripts/sample-apple-pass.mjs`
   → `dist/familienzeit-sample.pkpass`, AirDrop it to an iPhone.

## Google setup

Free. New issuer accounts start in **Demo Mode**: cards show "[TEST ONLY]" and only console users and test
accounts can save them. Details in the header of `scripts/sample-google-link.mjs`.

1. Google Pay & Wallet Console → Google Wallet API → accept terms, note the Issuer ID.
2. Add every Google account that should save cards (team, jury) as a test account.
3. Google Cloud: enable the Google Wallet API, create a service account and a JSON key.
4. Wallet Console → Users: invite the service account email as Developer.
5. Test: `GOOGLE_SA_JSON_FILE=… GOOGLE_ISSUER_ID=… WALLET_PUBLIC_ORIGIN=https://<site> node scripts/sample-google-link.mjs`

A full card does not fit Google's safe link length (1800 characters for the token). The worker therefore
creates the card through the Wallet API and redirects to a short link; this needs outbound HTTPS to
`oauth2.googleapis.com` and `walletobjects.googleapis.com`. If that fails it falls back to the long link.

## Tests

```sh
cd familienzeit
node --test tests/*.test.mjs
```

The Apple tests build a throwaway certificate chain with openssl and verify the signature; the Google tests
verify the JWT with a generated key and fake the Wallet API.

## Not verified yet

- A pass signed with a real Apple certificate on a real iPhone, and lock-screen relevance (`relevantDates`, iOS 18+).
- Google API inserts with a real issuer account, and how the card renders on Android.
- Official "Add to Apple Wallet" / "Add to Google Wallet" badges: the buttons are placeholders until the
  official artwork from Apple's and Google's brand pages is added (see the TODO in `site/app.js`).
