// Apple Wallet export: turns a normalized Reise-Canvas trip into a signed .pkpass.
// Dependency-free on purpose (the worker build has no npm step): WebCrypto for hashing and RSA signing,
// CompressionStream for deflate, and a small hand-written DER encoder for the PKCS#7 signature.
// Runs in Workers-style runtimes and in Node 22.
//
// Two layouts:
//  - With 'strip.png' in config.images (the family's own postcard): style `eventTicket`. The strip sits behind the
//    primary fields; we leave the primary row empty so the postcard stays readable, and Wallet doesn't allow a
//    thumbnail or background next to a strip, so those images are dropped.
//  - Without a strip: style `generic` with the fixed mountain thumbnail.
// Not a ticket. With config.barcodeUrl the pass gets a QR code that opens the Reise-Canvas home page (for the pitch),
// captioned as such so nobody mistakes it for an entry code.

// Event-ticket strip image: 375 × 98 points (1x/2x/3x pixels). The browser renders the postcard crop in these sizes.
export const APPLE_STRIP_SIZES = [[375, 98], [750, 196], [1125, 294]];

const appleUtf8 = new TextEncoder();
const appleColors = {background:'rgb(41, 78, 65)', foreground:'rgb(248, 247, 241)', label:'rgb(230, 186, 142)'};
const appleText = {
  de: {
    months: ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
    description: 'Familienzeit Urlaubsplan',
    holiday: 'URLAUB', familyTimeIn: 'FAMILIENZEIT IN', place: 'ORT', family: 'FAMILIE', activities: 'ERLEBNISSE',
    firstStop: 'ERSTER STOPP', wishes: 'WÜNSCHE', guestCard: 'GÄSTEKARTE', plan: 'EUER URLAUBSPLAN', note: 'HINWEIS',
    booking: 'BUCHUNG', openCanvas: 'Reise-Canvas öffnen',
    demoBooking: ref => `${ref} – im Reise-Canvas gebucht (Demo): nichts ist reserviert oder bezahlt.`,
    about: (place, range, members) => `Familienzeit in ${place}, ${range}. ${members}. Diese Karte ist eure Übersicht und kein Ticket.`,
    nothingPlanned: 'Noch nichts geplant',
    adult: 'Erwachsene Person', child: 'Kind', dog: 'Hund', underOne: 'unter 1',
    namedDog: name => `Hund ${name}`,
    priceAtProvider: 'Preis beim Anbieter', estimated: amount => `${amount} geschätzt`, freeEntry: 'Eintritt frei',
    pricesAtProvider: 'Preise beim Anbieter',
    cardInfo: (name, source) => `${name} – laut eurer Angabe dabei. Zeigt bei Bergbahnen und Partnern bitte die ` +
      `Originalkarte vor, diese Wallet-Karte ersetzt sie nicht.\nBedingungen: ${source}`
  },
  en: {
    months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    description: 'Familienzeit holiday plan',
    holiday: 'HOLIDAY', familyTimeIn: 'FAMILY TIME IN', place: 'PLACE', family: 'FAMILY', activities: 'ACTIVITIES',
    firstStop: 'FIRST STOP', wishes: 'WISHES', guestCard: 'GUEST CARD', plan: 'YOUR HOLIDAY PLAN', note: 'NOTE',
    booking: 'BOOKING', openCanvas: 'Open the Travel Canvas',
    demoBooking: ref => `${ref} – booked in the Travel Canvas (demo): nothing is reserved or paid.`,
    about: (place, range, members) => `Family time in ${place}, ${range}. ${members}. This card is your overview, not a ticket.`,
    nothingPlanned: 'Nothing planned yet',
    adult: 'Adult', child: 'Child', dog: 'Dog', underOne: 'under 1',
    namedDog: name => `${name} (dog)`,
    priceAtProvider: 'Price at the provider', estimated: amount => `${amount} estimated`, freeEntry: 'Free entry',
    pricesAtProvider: 'Prices at the provider',
    cardInfo: (name, source) => `${name} – you said you have it. Please show the original card at lifts and partners; ` +
      `this Wallet card doesn't replace it.\nConditions: ${source}`
  }
};

function appleLang(trip) {
  return appleText[trip.lang] || appleText.de;
}

export async function buildApplePass(trip, config) {
  appleCheckConfig(config);
  const images = appleImages(config.images);
  const files = new Map([['pass.json', appleUtf8.encode(JSON.stringify(buildApplePassJson(trip, {...config, images}), null, 2))]]);
  for (const [name, data] of Object.entries(images)) files.set(name, appleBytes(data));
  if (!files.has('icon.png')) throw new Error('Apple Wallet: icon.png is required.');
  const manifest = {};
  for (const [name, bytes] of files) manifest[name] = appleHex(await crypto.subtle.digest('SHA-1', bytes));
  const manifestBytes = appleUtf8.encode(JSON.stringify(manifest, null, 2));
  files.set('manifest.json', manifestBytes);
  files.set('signature', await appleSign(manifestBytes, config));
  return appleZip(files);
}

// Wallet ignores unknown files but a strip can't be combined with a thumbnail or background image.
function appleImages(images = {}) {
  const names = Object.keys(images);
  for (const name of names) {
    if (!/^(icon|logo|thumbnail|strip|background|footer)(@[23]x)?\.png$/.test(name)) {
      throw new Error(`Apple Wallet: unexpected image name "${name}".`);
    }
  }
  const strip = names.includes('strip.png');
  return Object.fromEntries(Object.entries(images)
    .filter(([name]) => !strip || !/^(thumbnail|background)(@[23]x)?\.png$/.test(name))
    .filter(([name]) => strip || !/^strip@[23]x\.png$/.test(name)));
}

export function buildApplePassJson(trip, config) {
  const text = appleLang(trip);
  const withStrip = Boolean(config.images && Object.hasOwn(config.images, 'strip.png'));
  const stops = trip.days.flatMap(day => [...day.stops]
    .sort((a, b) => appleMinutes(a.start) - appleMinutes(b.start))
    .map(stop => ({...stop, day})));
  const activities = stops.filter(stop => stop.kind !== 'care');
  const first = activities[0];
  const firstField = first && {key: 'first', label: text.firstStop, value: `${appleWeekday(first.day)} ${first.start} · ${first.title}`};
  const extraField = trip.booking
    ? {key: 'booking', label: text.booking, value: trip.booking.ref}
    : trip.card
    ? {key: 'card', label: text.guestCard, value: trip.card.name}
    : trip.wishes?.length ? {key: 'wishes', label: text.wishes, value: trip.wishes.join(' · ')} : null;
  const header = [{key: 'dates', label: text.holiday, value: appleShortRange(trip.start, trip.end, text)}];
  // At most four secondary + auxiliary fields together, so every layout stays within Wallet's front limits.
  const fields = withStrip
    ? {
      headerFields: header,
      primaryFields: [], // keep the postcard strip free of text
      secondaryFields: [
        {key: 'place', label: text.place, value: trip.place.name},
        {key: 'family', label: text.family, value: trip.family.summary}
      ],
      auxiliaryFields: [firstField || {key: 'stops', label: text.activities, value: '0'}, extraField].filter(Boolean)
    }
    : {
      headerFields: header,
      primaryFields: [{key: 'place', label: text.familyTimeIn, value: trip.place.name}],
      secondaryFields: [
        {key: 'family', label: text.family, value: trip.family.summary},
        {key: 'stops', label: text.activities, value: String(activities.length)}
      ],
      auxiliaryFields: [firstField, extraField].filter(Boolean)
    };
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeIdentifier,
    teamIdentifier: config.teamIdentifier,
    serialNumber: trip.id,
    organizationName: 'Familienzeit',
    description: text.description,
    logoText: 'familienzeit.',
    backgroundColor: appleColors.background,
    foregroundColor: appleColors.foreground,
    labelColor: appleColors.label,
    expirationDate: appleTimestamp(trip.end, 23 * 60 + 59),
    [withStrip ? 'eventTicket' : 'generic']: {...fields, backFields: appleBackFields(trip, text)}
  };
  if (config.barcodeUrl && /^https?:\/\//.test(config.barcodeUrl)) {
    pass.barcodes = [{format: 'PKBarcodeFormatQR', message: String(config.barcodeUrl), messageEncoding: 'iso-8859-1', altText: text.openCanvas}];
  }
  // Lock screen relevance. With date AND location relevance the system shows the pass when both match; one interval
  // per planned day (each under 24 h, iOS 18+ `relevantDates`) keeps location relevance alive on every trip day.
  // The deprecated single `relevantDate` is left out on purpose: on older iOS it would restrict location relevance to
  // the first day; without it those devices fall back to location-only relevance, bounded by expirationDate.
  const locations = appleLocations(activities);
  if (locations.length) {
    pass.locations = locations;
    pass.relevantDates = trip.days.filter(day => day.stops.length).map(day => {
      const times = day.stops.flatMap(stop => [appleMinutes(stop.start), appleMinutes(stop.end)]);
      return {
        startDate: appleTimestamp(day.date, Math.max(0, Math.min(...times) - 60)),
        endDate: appleTimestamp(day.date, Math.min(23 * 60 + 59, Math.max(...times) + 30))
      };
    });
  }
  return pass;
}

function appleMembers(trip, text) {
  const members = trip.family.members || [];
  if (!members.length) return trip.family.summary;
  return members.map(member => {
    const name = String(member.name || '').trim();
    if (member.kind === 'dog') return name ? text.namedDog(name) : text.dog;
    const age = member.age === null || member.age === undefined ? '' : ` (${member.age === 0 ? text.underOne : member.age})`;
    return (name || (member.kind === 'child' ? text.child : text.adult)) + age;
  }).join(' · ');
}

function appleBackFields(trip, text) {
  const prices = trip.prices !== false;
  const fields = [
    {key: 'about', label: text.plan, value: text.about(trip.place.name, appleLongRange(trip.start, trip.end, text), trip.family.summary)},
    {key: 'members', label: text.family, value: appleMembers(trip, text)}
  ];
  if (trip.booking) fields.push({key: 'booking-info', label: text.booking, value: text.demoBooking(trip.booking.ref)});
  if (trip.wishes?.length) fields.push({key: 'wish-list', label: text.wishes, value: trip.wishes.join(' · ')});
  for (const day of trip.days) {
    const stops = [...day.stops].sort((a, b) => appleMinutes(a.start) - appleMinutes(b.start));
    fields.push({
      key: `day-${day.date}`,
      label: day.label.toUpperCase(),
      value: stops.length ? stops.map(stop => appleStopText(stop, text, prices, trip.lang)).join('\n\n') : text.nothingPlanned
    });
  }
  if (prices && trip.totalLabel) {
    fields.push({
      key: 'total', label: trip.totalLabel.toUpperCase(),
      value: trip.total === null || trip.total === undefined ? text.pricesAtProvider : appleMoney(trip.total, trip.lang)
    });
  }
  if (trip.card) fields.push({key: 'card-info', label: text.guestCard, value: text.cardInfo(trip.card.name, trip.card.source)});
  if (trip.estimateNote) fields.push({key: 'note', label: text.note, value: trip.estimateNote});
  return fields;
}

function appleStopText(stop, text, prices, lang) {
  if (stop.kind === 'care') {
    return [`${stop.title} ${stop.start}–${stop.end}`, stop.bookingLabel, stop.note, stop.bookingLink].filter(Boolean).join('\n');
  }
  // Price only where it adds something: card-covered and ticket-free stops already say so in the label.
  const price = !prices ? ''
    : stop.price === null || stop.price === undefined ? text.priceAtProvider
    : stop.price > 0 ? text.estimated(appleMoney(stop.price, lang))
    : ['pass', 'free'].includes(stop.booking) ? '' : text.freeEntry;
  return [
    `${stop.start}–${stop.end} ${stop.title}`,
    [stop.group, stop.address].filter(Boolean).join(' · '),
    [stop.bookingLabel, price].filter(Boolean).join(' · '),
    stop.note,
    stop.bookingLink
  ].filter(Boolean).join('\n');
}

function appleLocations(stops) {
  const seen = new Set();
  const locations = [];
  for (const stop of stops) {
    if (!Number.isFinite(Number(stop.latitude)) || !Number.isFinite(Number(stop.longitude))) continue;
    const key = `${Number(stop.latitude).toFixed(5)},${Number(stop.longitude).toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({
      latitude: Number(stop.latitude), longitude: Number(stop.longitude),
      relevantText: `${stop.day.label} · ${stop.start} ${stop.title}`
    });
    if (locations.length === 10) break; // Wallet honours at most 10 locations.
  }
  return locations;
}

// ---------- dates (Europe/Vienna, EU summer-time rule, no libraries) ----------

function appleMinutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function appleLastSunday(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

export function appleViennaOffset(date, minutes) {
  const [year, month, day] = date.split('-').map(Number);
  // Treat the local time as standard time (UTC+1) and check whether that instant falls inside EU summer
  // time, which runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October.
  const instant = Date.UTC(year, month - 1, day, 0, minutes) - 60 * 60000;
  const start = Date.UTC(year, 2, appleLastSunday(year, 2), 1);
  const end = Date.UTC(year, 9, appleLastSunday(year, 9), 1);
  return instant >= start && instant < end ? 120 : 60;
}

export function appleTimestamp(date, minutes) {
  let day = date;
  if (minutes >= 1440) { // "24:00" belongs to the next day
    day = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    minutes -= 1440;
  }
  const offset = appleViennaOffset(day, minutes);
  const pad = n => String(n).padStart(2, '0');
  return `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00+${pad(offset / 60)}:00`;
}

function appleParts(date) {
  const [year, month, day] = date.split('-').map(Number);
  return {year, month, day};
}

// de: "10.–12. Juli", en: "10–12 July"
function appleShortRange(start, end, text) {
  const a = appleParts(start), b = appleParts(end);
  const en = text === appleText.en;
  const month = p => text.months[p.month - 1];
  if (start === end) return en ? `${a.day} ${month(a)}` : `${a.day}. ${month(a)}`;
  if (a.year === b.year && a.month === b.month) return en ? `${a.day}–${b.day} ${month(b)}` : `${a.day}.–${b.day}. ${month(b)}`;
  return en ? `${a.day} ${month(a).slice(0, 3)} – ${b.day} ${month(b).slice(0, 3)}` : `${a.day}.${a.month}.–${b.day}.${b.month}.`;
}

function appleLongRange(start, end, text) {
  const a = appleParts(start), b = appleParts(end);
  const en = text === appleText.en;
  const dayMonth = p => en ? `${p.day} ${text.months[p.month - 1]}` : `${p.day}. ${text.months[p.month - 1]}`;
  const full = p => `${dayMonth(p)} ${p.year}`;
  if (start === end) return full(a);
  if (a.year === b.year && a.month === b.month) return en ? `${a.day}–${full(b)}` : `${a.day}.–${full(b)}`;
  if (a.year === b.year) return `${dayMonth(a)} – ${full(b)}`;
  return `${full(a)} – ${full(b)}`;
}

function appleWeekday(day) {
  // day.label looks like "Sa., 10.7." or "Sat, 10 Jul" – keep the weekday part.
  return day.label.split(',')[0];
}

function appleMoney(value, lang) {
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-AT', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2}).format(value);
}

// ---------- signing (CMS / PKCS#7 SignedData, detached, SHA-256) ----------

const appleOid = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  ecPublicKey: '1.2.840.10045.2.1'
};

function appleCheckConfig(config) {
  for (const key of ['passTypeIdentifier', 'teamIdentifier', 'certificatePem', 'privateKeyPem', 'wwdrPem']) {
    if (typeof config?.[key] !== 'string' || !config[key].trim()) throw new Error(`Apple Wallet: config.${key} is missing.`);
  }
}

async function appleSign(manifestBytes, config) {
  const signerChain = applePemBlocks(config.certificatePem, 'CERTIFICATE');
  const wwdr = applePemBlocks(config.wwdrPem, 'CERTIFICATE');
  if (!signerChain.length) throw new Error('Apple Wallet: certificatePem contains no certificate.');
  if (!wwdr.length) throw new Error('Apple Wallet: wwdrPem contains no certificate.');
  const signer = appleCertificateParts(signerChain[0]);
  const key = await appleImportKey(config.privateKeyPem);

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', manifestBytes));
  const attributes = [
    appleSeq(appleOidDer(appleOid.contentType), appleSet(appleOidDer(appleOid.data))),
    appleSeq(appleOidDer(appleOid.signingTime), appleSet(appleUtcTime(new Date()))),
    appleSeq(appleOidDer(appleOid.messageDigest), appleSet(appleTlv(0x04, digest)))
  ];
  const signedAttributes = appleSetOf(attributes); // DER: SET OF is sorted
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, signedAttributes));

  // Catch a certificate/key mix-up here instead of on the phone, where Safari only says "cannot download".
  const publicKey = await crypto.subtle.importKey('spki', signer.spki,
    {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signedAttributes)) {
    throw new Error('Apple Wallet: the private key does not belong to the pass certificate.');
  }

  const sha256 = appleSeq(appleOidDer(appleOid.sha256), appleNull());
  const signerInfo = appleSeq(
    appleInt(1),
    appleSeq(signer.issuer, signer.serial),
    sha256,
    appleTlv(0xa0, signedAttributes.subarray(appleHeaderLength(signedAttributes))), // [0] IMPLICIT
    appleSeq(appleOidDer(appleOid.rsaEncryption), appleNull()),
    appleTlv(0x04, signature)
  );
  const certificates = [signerChain[0], ...wwdr, ...signerChain.slice(1).filter(cert => !wwdr.some(w => appleSameBytes(w, cert)))];
  const signedData = appleSeq(
    appleInt(1),
    appleSet(sha256),
    appleSeq(appleOidDer(appleOid.data)), // detached: no eContent
    appleTlv(0xa0, appleConcat(appleDerSort(certificates))), // [0] IMPLICIT SET OF
    appleSet(signerInfo)
  );
  return appleSeq(appleOidDer(appleOid.signedData), appleTlv(0xa0, signedData));
}

async function appleImportKey(pem) {
  if (/BEGIN ENCRYPTED PRIVATE KEY/.test(pem)) {
    throw new Error('Apple Wallet: the private key is encrypted. Export it without a passphrase (openssl ... -nodes).');
  }
  if (/BEGIN EC PRIVATE KEY/.test(pem)) throw new Error('Apple Wallet: pass certificates use RSA keys, got an EC key.');
  let der = applePemBlocks(pem, 'PRIVATE KEY')[0];
  const pkcs1 = applePemBlocks(pem, 'RSA PRIVATE KEY')[0];
  if (!der && pkcs1) { // wrap PKCS#1 into PKCS#8
    der = appleSeq(appleInt(0), appleSeq(appleOidDer(appleOid.rsaEncryption), appleNull()), appleTlv(0x04, pkcs1));
  }
  if (!der) throw new Error('Apple Wallet: privateKeyPem contains no private key.');
  const info = appleChildren(appleValue(der));
  const algorithm = appleReadOid(appleChildren(info[1].value)[0].value);
  if (algorithm === appleOid.ecPublicKey) throw new Error('Apple Wallet: pass certificates use RSA keys, got an EC key.');
  if (algorithm !== appleOid.rsaEncryption) throw new Error(`Apple Wallet: unsupported private key type ${algorithm}.`);
  return crypto.subtle.importKey('pkcs8', der, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']);
}

function appleCertificateParts(der) {
  const tbs = appleChildren(appleChildren(appleValue(der))[0].value);
  let index = tbs[0].tag === 0xa0 ? 1 : 0; // optional [0] version
  const serial = tbs[index].raw;
  const issuer = tbs[index + 2].raw;
  const spki = tbs[index + 5].raw;
  return {serial, issuer, spki};
}

function applePemBlocks(pem, label) {
  const pattern = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`, 'g');
  return [...String(pem).matchAll(pattern)].map(match => appleBase64(match[1]));
}

function appleBase64(text) {
  const binary = atob(text.replace(/[^A-Za-z0-9+/=]/g, ''));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// Minimal DER encoder/reader.
function appleLength(length) {
  if (length < 0x80) return [length];
  const bytes = [];
  for (let n = length; n > 0; n >>>= 8) bytes.unshift(n & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function appleTlv(tag, content) {
  const head = [tag, ...appleLength(content.length)];
  const out = new Uint8Array(head.length + content.length);
  out.set(head);
  out.set(content, head.length);
  return out;
}

function appleConcat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function appleSeq(...items) { return appleTlv(0x30, appleConcat(items)); }
function appleSet(...items) { return appleTlv(0x31, appleConcat(items)); }
function appleNull() { return new Uint8Array([0x05, 0x00]); }

function appleDerSort(items) { // DER orders the members of a SET OF by their encodings
  return [...items].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  });
}

function appleSetOf(items) { return appleSet(...appleDerSort(items)); }

function appleInt(value) {
  const bytes = [];
  for (let n = value; ; n >>>= 8) { bytes.unshift(n & 0xff); if (n < 0x80) break; }
  return appleTlv(0x02, new Uint8Array(bytes));
}

function appleOidDer(oid) {
  const parts = oid.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let n = part >>> 7; n > 0; n >>>= 7) chunk.unshift(0x80 | (n & 0x7f));
    bytes.push(...chunk);
  }
  return appleTlv(0x06, new Uint8Array(bytes));
}

function appleReadOid(bytes) {
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) { parts.push(value); value = 0; }
  }
  return parts.join('.');
}

function appleUtcTime(date) {
  const pad = n => String(n).padStart(2, '0');
  const text = pad(date.getUTCFullYear() % 100) + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) +
    pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
  return appleTlv(0x17, appleUtf8.encode(text));
}

function appleHeaderLength(der) {
  return der[1] < 0x80 ? 2 : 2 + (der[1] & 0x7f);
}

function appleValue(der) {
  const head = appleHeaderLength(der);
  return der.subarray(head, head + appleReadLength(der));
}

function appleChildren(content) {
  // Splits the content bytes of a constructed value into its TLV children.
  const items = [];
  for (let offset = 0; offset < content.length;) {
    const view = content.subarray(offset);
    const head = appleHeaderLength(view);
    const length = appleReadLength(view);
    items.push({tag: view[0], value: view.subarray(head, head + length), raw: view.subarray(0, head + length)});
    offset += head + length;
  }
  return items;
}

function appleReadLength(der) {
  if (der[1] < 0x80) return der[1];
  let length = 0;
  for (let i = 0; i < (der[1] & 0x7f); i++) length = length * 256 + der[2 + i];
  return length;
}

// ---------- zip ----------
// Entries are deflated like `zip -r` does (what Apple's own build instructions produce); an entry is
// stored instead when deflate would not make it smaller (PNGs) or CompressionStream is unavailable.

const appleCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function appleCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = appleCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function appleDeflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function appleZip(files) {
  const now = new Date();
  const dosTime = (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | Math.floor(now.getUTCSeconds() / 2);
  const dosDate = ((now.getUTCFullYear() - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = appleUtf8.encode(name);
    const deflated = await appleDeflate(data);
    const method = deflated && deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const crc = appleCrc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, method, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, method, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    const entry = [new Uint8Array(local.buffer), nameBytes, body];
    locals.push(...entry);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += entry.reduce((sum, part) => sum + part.length, 0);
  }
  const directory = appleConcat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.size, true);
  end.setUint16(10, files.size, true);
  end.setUint32(12, directory.length, true);
  end.setUint32(16, offset, true);
  return appleConcat([...locals, directory, new Uint8Array(end.buffer)]);
}

// ---------- small helpers ----------

function appleBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return appleBase64(data);
  throw new Error('Apple Wallet: images must be Uint8Array, ArrayBuffer or base64 strings.');
}

function appleSameBytes(a, b) {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function appleHex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
