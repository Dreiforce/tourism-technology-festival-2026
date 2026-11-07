// Google Wallet "Save to Google Wallet" link for a Reise-Canvas trip (Generic pass).
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
// The pass is an overview for the family, not a ticket; a guest card is shown as information only. With
// config.barcodeUrl it gets a QR code that opens the Reise-Canvas home page, captioned as such.
// The hero image is the family's own postcard when config.heroImageUrl is given (uploaded by the browser), otherwise
// the fixed mountain artwork served by the worker at /wallet/hero.png.

export const GOOGLE_WALLET_SAFE_JWT_LENGTH = 1800;
// Google's generic pass brand guidelines recommend a 1032 × 812 px hero image (about 5:4, PNG).
export const GOOGLE_HERO_SIZE = [1032, 812];

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
const googleTexts = {
  de: {
    months: ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
    activities: 'Erlebnisse', count: (n, d) => n ? `${n} an ${d} ${d === 1 ? 'Tag' : 'Tagen'}` : 'noch keine',
    entry: 'Eintritt ca.', atProvider: 'beim Anbieter', open: ' + offen',
    wishes: 'Wünsche', days: 'Tage',
    goodToKnow: 'Gut zu wissen', family: 'Familie',
    notTicket: 'Diese Karte im Wallet ist eine Übersicht und kein Ticket.',
    card: name => `Gästekarte ${name} – bei euch dabei. Bitte die Originalkarte vorzeigen, diese Karte im Wallet ist kein Ticket.`,
    nothingPlanned: 'Noch nichts geplant', yourPlan: 'Euer Urlaubsplan',
    priceAtProvider: 'Preis beim Anbieter', noEntry: 'kein Eintritt',
    adult: 'Erwachsene Person', child: 'Kind', dog: 'Hund', underOne: 'unter 1', namedDog: name => `Hund ${name}`,
    link: {advance: 'anmelden', info: 'Infos', care: 'Infos', online: 'buchen', pass: 'Infos', office: 'Infos', onsite: 'Infos', free: 'Infos'},
    cardConditions: 'Bedingungen',
    logo: 'familienzeit. Logo', postcard: 'Eure Reisepostkarte', mountains: 'Berge mit Sonne',
    booking: 'Buchung', openCanvas: 'Reise-Canvas öffnen',
    demoBooking: ref => `Buchung ${ref} – im Reise-Canvas gebucht (Demo), nichts ist reserviert oder bezahlt.`
  },
  en: {
    months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    activities: 'Activities', count: (n, d) => n ? `${n} on ${d} ${d === 1 ? 'day' : 'days'}` : 'none yet',
    entry: 'Entry approx.', atProvider: 'at the provider', open: ' + open',
    wishes: 'Wishes', days: 'Days',
    goodToKnow: 'Good to know', family: 'Family',
    notTicket: 'This Wallet card is an overview, not a ticket.',
    card: name => `Guest card ${name} – you have it with you. Please show the original card; this Wallet card is not a ticket.`,
    nothingPlanned: 'Nothing planned yet', yourPlan: 'Your holiday plan',
    priceAtProvider: 'Price at the provider', noEntry: 'free entry',
    adult: 'Adult', child: 'Child', dog: 'Dog', underOne: 'under 1', namedDog: name => `${name} (dog)`,
    link: {advance: 'register', info: 'info', care: 'info', online: 'book', pass: 'info', office: 'info', onsite: 'info', free: 'info'},
    cardConditions: 'conditions',
    logo: 'familienzeit. logo', postcard: 'Your travel postcard', mountains: 'Mountains with sun',
    booking: 'Booking', openCanvas: 'Open the Travel Canvas',
    demoBooking: ref => `Booking ${ref} – booked in the Travel Canvas (demo), nothing is reserved or paid.`
  }
};

const googleKeyCache = new Map();
const googleTokenCache = new Map();
const googleKnownClasses = new Set();

export function buildGooglePass(trip, config) {
  const issuerId = String(config?.issuerId ?? '').trim();
  if (!/^\d+$/.test(issuerId)) throw new Error('Google Wallet: issuerId fehlt oder ist ungültig.');
  const origin = String(config?.origin ?? '').replace(/\/+$/, '');
  const now = googleNow(config);
  const lang = trip.lang === 'en' ? 'en' : 'de';
  const text = googleTexts[lang];
  const localized = value => googleText(value, lang);
  const prices = trip.prices !== false;
  const classId = `${issuerId}.${googleClassSuffix}`;
  const objectId = `${issuerId}.${String(trip.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)}`;

  const stops = trip.days.flatMap(day => day.stops);
  const activities = stops.filter(stop => stop.kind !== 'care');
  const activeDays = trip.days.filter(day => day.stops.some(stop => stop.kind !== 'care')).length;
  const unknownPrice = activities.some(stop => stop.price === null);
  const wishes = (trip.wishes || []).join(' · ');

  const front = [
    {id: 'row2left', header: text.activities, body: text.count(activities.length, activeDays)},
    prices
      ? {id: 'row2right', header: text.entry,
        body: trip.total === null || trip.total === undefined ? text.atProvider : googleEuro(trip.total) + (unknownPrice ? text.open : '')}
      : trip.booking
        ? {id: 'row2right', header: text.booking, body: trip.booking.ref}
      : wishes
        ? {id: 'row2right', header: text.wishes, body: googleCut(wishes, 60)}
        : {id: 'row2right', header: text.days, body: String(trip.days.length)}
  ];
  const notes = [
    `${text.family}: ${googleMembers(trip, text)}`,
    wishes && `${text.wishes}: ${wishes}`,
    trip.booking && text.demoBooking(trip.booking.ref),
    trip.card ? text.card(trip.card.name) : text.notTicket,
    prices && trip.total !== null && trip.total !== undefined && trip.totalLabel ? `${trip.totalLabel}: ${googleEuro(trip.total)}` : '',
    trip.estimateNote
  ].filter(Boolean).join('\n');
  const closing = {id: 'hinweise', header: text.goodToKnow, body: googleFit([notes], googleMaxBody)};

  const dayBudget = googleMaxModules - front.length - 1;
  const chunkSize = Math.max(1, Math.ceil(trip.days.length / dayBudget));
  const dayModules = [];
  for (let i = 0; i < trip.days.length; i += chunkSize) {
    const chunk = trip.days.slice(i, i + chunkSize);
    const header = chunk.length === 1 ? chunk[0].label : `${chunk[0].label} – ${chunk.at(-1).label}`;
    dayModules.push({
      id: 'tag-' + chunk[0].date.replaceAll('-', ''),
      header: googleCut(header, googleMaxHeader),
      body: googleDaysBody(chunk, chunk.length > 1, text, prices)
    });
  }

  const links = [];
  const seen = new Set();
  const addLink = (uri, description, id) => {
    if (links.length >= googleMaxLinks || !googleHttps(uri) || seen.has(uri)) return;
    seen.add(uri);
    links.push({uri, description: googleCut(description, 60), id});
  };
  stops.filter(stop => stop.bookingLink)
    .forEach((stop, i) => addLink(stop.bookingLink, `${stop.title} – ${text.link[stop.booking] || text.link.info}`, 'link' + (i + 1)));
  if (trip.card?.source) addLink(trip.card.source, `${trip.card.name} – ${text.cardConditions}`, 'gaestekarte');

  const tripStart = googleIso(trip.start, '00:00');
  const genericObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    cardTitle: localized('familienzeit.'),
    subheader: localized(googleCut(`${googleRange(trip.start, trip.end, lang)} · ${trip.place.name}`, 88)),
    header: localized(googleCut(trip.family.summary || text.yourPlan, 47)),
    hexBackgroundColor: googleBackground,
    validTimeInterval: {
      // Valid from the moment of saving (so it never sits in a "not yet valid" state) until the end of the last day.
      start: {date: now.getTime() < Date.parse(tripStart) ? now.toISOString().slice(0, 19) + 'Z' : tripStart},
      end: {date: googleIso(trip.end, '23:59', '59')}
    },
    textModulesData: [...front, ...dayModules, closing],
    ...(links.length && {linksModuleData: {uris: links}})
  };
  if (config?.barcodeUrl && /^https?:\/\//.test(config.barcodeUrl)) {
    genericObject.barcode = {type: 'QR_CODE', value: String(config.barcodeUrl), alternateText: googleCut(text.openCanvas, 40)};
  }
  // Google loads images from public https URLs only.
  if (googleHttps(origin)) {
    genericObject.logo = {sourceUri: {uri: `${origin}/wallet/logo.png`}, contentDescription: localized(text.logo)};
  }
  if (googleHttps(config?.heroImageUrl)) {
    genericObject.heroImage = {sourceUri: {uri: String(config.heroImageUrl)}, contentDescription: localized(text.postcard)};
  } else if (googleHttps(origin)) {
    genericObject.heroImage = {sourceUri: {uri: `${origin}/wallet/hero.png`}, contentDescription: localized(text.mountains)};
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

function googleText(value, lang = 'de') {
  return {defaultValue: {language: lang, value}};
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

function googlePrice(stop, text) {
  if (stop.price === null || stop.price === undefined) return text.priceAtProvider;
  if (stop.price === 0) return text.noEntry;
  return googleEuro(stop.price);
}

function googleMembers(trip, text) {
  const members = trip.family.members || [];
  if (!members.length) return trip.family.summary;
  return members.map(member => {
    const name = String(member.name || '').trim();
    if (member.kind === 'dog') return name ? text.namedDog(name) : text.dog;
    const age = member.age === null || member.age === undefined ? '' : ` (${member.age === 0 ? text.underOne : member.age})`;
    return (name || (member.kind === 'child' ? text.child : text.adult)) + age;
  }).join(' · ');
}

function googleStopText(stop, detail, text, prices) {
  if (stop.kind === 'care') {
    return [`${stop.title} ${stop.start}–${stop.end}`, detail >= 1 ? stop.bookingLabel : ''].filter(Boolean).join('\n');
  }
  const title = `${stop.start}–${stop.end} ${stop.group ? stop.group + ': ' : ''}${stop.title}`;
  const price = prices ? googlePrice(stop, text) : '';
  const facts = detail >= 1 ? [stop.place, stop.bookingLabel, price] : [price];
  const lines = [title, facts.filter(Boolean).join(' · ')];
  if (detail >= 2 && stop.note) lines.push(googleCut(stop.note, 90));
  return lines.filter(Boolean).join('\n');
}

function googleDaysBody(days, withLabels, text, prices) {
  const render = detail => days.map(day => {
    const stops = day.stops.length
      ? day.stops.map(stop => googleStopText(stop, detail, text, prices)).join('\n\n') : text.nothingPlanned;
    return withLabels ? `${day.label}\n${stops}` : stops;
  }).join('\n\n');
  return googleFit([render(2), render(1), render(0)], googleMaxBody);
}

// de: "10.–12. Juli 2027", en: "10–12 July 2027"
function googleRange(start, end, lang = 'de') {
  const months = googleTexts[lang].months;
  const en = lang === 'en';
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const dm = (d, m) => en ? `${d} ${months[m - 1]}` : `${d}. ${months[m - 1]}`;
  if (start === end) return `${dm(d1, m1)} ${y1}`;
  if (y1 === y2 && m1 === m2) return en ? `${d1}–${d2} ${months[m2 - 1]} ${y2}` : `${d1}.–${d2}. ${months[m2 - 1]} ${y2}`;
  if (y1 === y2) return `${dm(d1, m1)} – ${dm(d2, m2)} ${y2}`;
  return `${dm(d1, m1)} ${y1} – ${dm(d2, m2)} ${y2}`;
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
