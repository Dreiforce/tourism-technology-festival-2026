// Google Wallet "Save to Google Wallet" link for a Familienzeit trip (Generic pass).
//
// No imports and no npm dependencies: this file is bundled into the worker by scripts/build.mjs and also runs in
// Node 22 for tests. It only uses WebCrypto (crypto.subtle), TextEncoder, atob/btoa and fetch.
//
// Two ways to hand the pass to Google (config.mode):
//   'jwt'  – the class and the whole object travel inside the signed JWT ("fat" JWT). No server call, but Google
//            names 1800 characters as the safe length of an encoded JWT; longer links may fail or get truncated.
//   'api'  – the worker first inserts class + object through the Wallet REST API, then signs a short JWT that only
//            references the object id. Needs outbound HTTPS to oauth2.googleapis.com and walletobjects.googleapis.com.
//   'auto' – (default) 'jwt' when the fat JWT fits into 1800 characters, otherwise 'api'; if the API call fails,
//            it falls back to the fat JWT so the family still gets a (possibly too long) link instead of an error.
//
// The pass is an overview for the family, not a ticket: no barcode, and the guest card is shown as information only.

export const GOOGLE_WALLET_SAFE_JWT_LENGTH = 1800;

const googleSaveBase = 'https://pay.google.com/gp/v/save/';
const googleApiBase = 'https://walletobjects.googleapis.com/walletobjects/v1/';
const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const googleScope = 'https://www.googleapis.com/auth/wallet_object.issuer';
const googleClassSuffix = 'familienzeit_urlaubsplan';
const googleBackground = '#294e41';
// Documented display limits: 10 text modules and 10 links per object; text module header ~35, body ~500 characters.
const googleMaxModules = 10;
const googleMaxLinks = 10;
const googleMaxHeader = 35;
const googleMaxBody = 500;
const googleMonths = ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

const googleKeyCache = new Map();
const googleTokenCache = new Map();
const googleKnownClasses = new Set();

export function buildGooglePass(trip, config) {
  const issuerId = String(config?.issuerId ?? '').trim();
  if (!/^\d+$/.test(issuerId)) throw new Error('Google Wallet: issuerId fehlt oder ist ungültig.');
  const origin = String(config?.origin ?? '').replace(/\/+$/, '');
  const now = googleNow(config);
  const classId = `${issuerId}.${googleClassSuffix}`;
  const objectId = `${issuerId}.${String(trip.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)}`;

  const stops = trip.days.flatMap(day => day.stops);
  const activeDays = trip.days.filter(day => day.stops.length).length;
  const unknownPrice = stops.some(stop => stop.price === null);

  const front = [
    {id: 'row2left', header: 'Erlebnisse',
      body: stops.length ? `${stops.length} an ${activeDays} ${activeDays === 1 ? 'Tag' : 'Tagen'}` : '–'},
    {id: 'row2right', header: 'Eintritt ca.',
      body: trip.total === null ? 'beim Anbieter' : googleEuro(trip.total) + (unknownPrice ? ' + offen' : '')}
  ];
  const notes = [
    trip.card
      ? `Gästekarte ${trip.card.name} – bei euch dabei. Bitte die Originalkarte vorzeigen, diese Karte im Wallet ist kein Ticket.`
      : 'Diese Karte im Wallet ist eine Übersicht und kein Ticket.',
    trip.total === null ? '' : `${trip.totalLabel}: ${googleEuro(trip.total)}`,
    trip.estimateNote
  ].filter(Boolean).join('\n');
  const closing = {id: 'hinweise', header: 'Gut zu wissen', body: googleFit([notes], googleMaxBody)};

  const dayBudget = googleMaxModules - front.length - 1;
  const chunkSize = Math.max(1, Math.ceil(trip.days.length / dayBudget));
  const dayModules = [];
  for (let i = 0; i < trip.days.length; i += chunkSize) {
    const chunk = trip.days.slice(i, i + chunkSize);
    const header = chunk.length === 1 ? chunk[0].label : `${chunk[0].label} – ${chunk.at(-1).label}`;
    dayModules.push({
      id: 'tag-' + chunk[0].date.replaceAll('-', ''),
      header: googleCut(header, googleMaxHeader),
      body: googleDaysBody(chunk, chunk.length > 1)
    });
  }

  const links = [];
  const seen = new Set();
  const addLink = (uri, description, id) => {
    if (links.length >= googleMaxLinks || !googleHttps(uri) || seen.has(uri)) return;
    seen.add(uri);
    links.push({uri, description: googleCut(description, 60), id});
  };
  stops.filter(stop => stop.booking === 'online' && stop.bookingLink)
    .forEach((stop, i) => addLink(stop.bookingLink, `${stop.title} – buchen`, 'buchen' + (i + 1)));
  if (trip.card?.source) addLink(trip.card.source, `${trip.card.name} – Bedingungen`, 'gaestekarte');

  const tripStart = googleIso(trip.start, '00:00');
  const genericObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    cardTitle: googleText('familienzeit.'),
    subheader: googleText(googleCut(`${googleRange(trip.start, trip.end)} · ${trip.place.name}`, 88)),
    header: googleText(googleCut(trip.family.summary || 'Euer Urlaubsplan', 47)),
    hexBackgroundColor: googleBackground,
    validTimeInterval: {
      // Valid from the moment of saving (so it never sits in a "not yet valid" state) until the end of the last day.
      start: {date: now.getTime() < Date.parse(tripStart) ? now.toISOString().slice(0, 19) + 'Z' : tripStart},
      end: {date: googleIso(trip.end, '23:59', '59')}
    },
    textModulesData: [...front, ...dayModules, closing],
    ...(links.length && {linksModuleData: {uris: links}})
  };
  if (googleHttps(origin)) {
    genericObject.logo = {sourceUri: {uri: `${origin}/wallet/logo.png`}, contentDescription: googleText('familienzeit. Logo')};
    genericObject.heroImage = {sourceUri: {uri: `${origin}/wallet/hero.png`}, contentDescription: googleText('Berge mit Sonne')};
  }
  return {genericClass: {id: classId}, genericObject};
}

export async function buildGoogleSaveUrl(trip, config) {
  const email = String(config?.serviceAccountEmail ?? '').trim();
  if (!email) throw new Error('Google Wallet: serviceAccountEmail fehlt.');
  const {genericClass, genericObject} = buildGooglePass(trip, config);
  const key = await googleKey(config.privateKeyPem);
  const iat = Math.floor(googleNow(config).getTime() / 1000);
  const origins = googleHttps(config.origin) || /^http:\/\/localhost(:\d+)?\/?$/.test(String(config.origin ?? ''))
    ? [String(config.origin).replace(/\/+$/, '')] : [];
  const claims = payload => ({iss: email, aud: 'google', typ: 'savetowallet', iat, origins, payload});

  const mode = config.mode || 'auto';
  const fat = await googleSign(claims({genericClasses: [genericClass], genericObjects: [genericObject]}), key);
  if (mode === 'jwt' || (mode === 'auto' && fat.length <= GOOGLE_WALLET_SAFE_JWT_LENGTH)) return googleSaveBase + fat;

  try {
    const fetchImpl = config.fetch || ((...args) => fetch(...args));
    const token = await googleAccessToken(email, key, iat, fetchImpl);
    if (!googleKnownClasses.has(genericClass.id)) {
      await googleInsert('genericClass', genericClass, token, fetchImpl);
      googleKnownClasses.add(genericClass.id);
    }
    await googleInsert('genericObject', genericObject, token, fetchImpl);
    const skinny = await googleSign(claims({genericObjects: [{id: genericObject.id, classId: genericObject.classId}]}), key);
    return googleSaveBase + skinny;
  } catch (error) {
    if (mode === 'api') throw error;
    console.warn('Google Wallet API not reachable, falling back to a long save link.', error?.message || error);
    return googleSaveBase + fat;
  }
}

function googleNow(config) {
  const now = config?.now === undefined ? new Date() : new Date(config.now);
  if (!Number.isFinite(now.getTime())) throw new Error('Google Wallet: ungültige Zeit.');
  return now;
}

function googleText(value) {
  return {defaultValue: {language: 'de', value}};
}

function googleHttps(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function googleCut(text, max) {
  text = String(text ?? '').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s·,–-]+$/, '') + '…';
}

// Try the given variants from richest to leanest and return the first that fits; cut the last one if needed.
function googleFit(variants, max) {
  for (const variant of variants) if (variant.length <= max) return variant;
  return googleCut(variants.at(-1), max);
}

// Formatted by hand (de-AT style "€ 1.234,50") so it doesn't depend on the runtime's ICU locale data.
function googleEuro(value) {
  const cents = Math.round(Math.abs(value) * 100);
  const whole = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const rest = cents % 100;
  return `€ ${value < 0 ? '-' : ''}${whole}${rest ? ',' + String(rest).padStart(2, '0') : ''}`;
}

function googlePrice(stop) {
  if (stop.price === null) return 'Preis beim Anbieter';
  if (stop.price === 0) return 'kein Eintritt';
  return googleEuro(stop.price);
}

function googleStopText(stop, detail) {
  const title = `${stop.start}–${stop.end} ${stop.group ? stop.group + ': ' : ''}${stop.title}`;
  const facts = detail >= 1 ? [stop.place, stop.bookingLabel, googlePrice(stop)] : [googlePrice(stop)];
  const lines = [title, facts.filter(Boolean).join(' · ')];
  if (detail >= 2 && stop.note) lines.push(googleCut(stop.note, 90));
  return lines.join('\n');
}

function googleDaysBody(days, withLabels) {
  const render = detail => days.map(day => {
    const stops = day.stops.length ? day.stops.map(stop => googleStopText(stop, detail)).join('\n\n') : 'Freier Tag';
    return withLabels ? `${day.label}\n${stops}` : stops;
  }).join('\n\n');
  return googleFit([render(2), render(1), render(0)], googleMaxBody);
}

function googleRange(start, end) {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  if (start === end) return `${d1}. ${googleMonths[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}.–${d2}. ${googleMonths[m2 - 1]} ${y2}`;
  if (y1 === y2) return `${d1}. ${googleMonths[m1 - 1]} – ${d2}. ${googleMonths[m2 - 1]} ${y2}`;
  return `${d1}. ${googleMonths[m1 - 1]} ${y1} – ${d2}. ${googleMonths[m2 - 1]} ${y2}`;
}

// Europe/Vienna follows the EU rule: CEST from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC.
function googleLastSunday(year, monthIndex) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

function googleViennaOffset(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const utcIfWinter = Date.UTC(y, m - 1, d, hh, mm) - 3600e3;
  const summerStart = Date.UTC(y, 2, googleLastSunday(y, 2), 1);
  const summerEnd = Date.UTC(y, 9, googleLastSunday(y, 9), 1);
  return utcIfWinter >= summerStart && utcIfWinter < summerEnd ? '+02:00' : '+01:00';
}

function googleIso(date, time, seconds = '00') {
  return `${date}T${time}:${seconds}${googleViennaOffset(date, time)}`;
}

function googleBase64Url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function googleKey(pem) {
  const text = String(pem ?? '').replace(/\\n/g, '\n').trim();
  if (!googleKeyCache.has(text)) {
    if (/BEGIN RSA PRIVATE KEY/.test(text)) {
      throw new Error('Google Wallet: Schlüssel muss PKCS#8 sein ("BEGIN PRIVATE KEY"), wie in der Service-Account-JSON.');
    }
    const match = text.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
    if (!match) throw new Error('Google Wallet: privater Schlüssel fehlt.');
    const der = Uint8Array.from(atob(match[1].replace(/\s+/g, '')), char => char.charCodeAt(0));
    const key = crypto.subtle.importKey('pkcs8', der, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']);
    key.catch(() => googleKeyCache.delete(text));
    googleKeyCache.set(text, key);
  }
  return googleKeyCache.get(text);
}

async function googleSign(claims, key) {
  const unsigned = googleBase64Url(JSON.stringify({alg: 'RS256', typ: 'JWT'})) + '.' + googleBase64Url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + googleBase64Url(signature);
}

async function googleAccessToken(email, key, iat, fetchImpl) {
  const cached = googleTokenCache.get(email);
  if (cached && cached.expires - 120 > iat) return cached.token;
  const assertion = await googleSign({iss: email, scope: googleScope, aud: googleTokenUrl, iat, exp: iat + 3600}, key);
  const response = await fetchImpl(googleTokenUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}).toString()
  });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const {access_token: token, expires_in: expiresIn = 3600} = await response.json();
  if (!token) throw new Error('Google OAuth: kein Zugriffstoken erhalten.');
  googleTokenCache.set(email, {token, expires: iat + Number(expiresIn)});
  return token;
}

async function googleInsert(resource, body, token, fetchImpl) {
  const response = await fetchImpl(googleApiBase + resource, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  if (response.status === 409) return 'exists';
  if (!response.ok) throw new Error(`Google Wallet API ${resource} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return 'created';
}
