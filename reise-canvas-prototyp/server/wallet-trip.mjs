// Reise-Canvas → wallet pass: the compact plan format the browser puts into `?t=` and the step that turns it
// into the normalized trip the Apple/Google builders expect (see tests/fixtures/trip.json).
// No imports: the worker build wraps this file in its own scope and only exposes the exported names.
//
// Compact format v1 = base64url(UTF-8 JSON), at most 8000 characters:
// {
//   v: 1,
//   l: 'de' | 'en',                              UI language of the canvas
//   p: 'Serfaus' | 'Fiss' | 'Ladis',             village on the postcard
//   s: 'YYYY-MM-DD', e: 'YYYY-MM-DD' | '',       first and last day ('' = single day), at most 14 days
//   f: [[kind, age, name], …]                    1–10 people; kind 'a' adult | 'c' child | 'd' dog,
//                                                age integer or null, name ≤ 24 characters or ''
//   w: ['adventure', …]                          wish keys of the whole family (≤ 8)
//   r: [[date, period, group, startMin, endMin, index], …]
//                                                planned entries (≤ 60): period 'am' | 'pm', group label
//                                                ('' = everyone together), minutes 0–1440, index = position
//                                                in dist/catalog.json or -1 for childcare hours
// }

const tripVillages = {
  Serfaus: [47.0408, 10.6061],
  Fiss: [47.0562, 10.6174],
  Ladis: [47.0744, 10.6494]
};
// Coordinates for the catalog's location strings (from the Familienzeit region and catalog data).
const tripLocations = {
  ...tripVillages,
  'Serfaus · Komperdell': [47.041, 10.565],
  'Serfaus · Högsee': [47.03758, 10.58068],
  'Fiss · Möseralm': [47.059, 10.589],
  'Fiss · Wolfsee': [47.0576, 10.6347],
  'Fiss · Rabuschl': [47.074, 10.608],
  'Ladis · Neuegg': [47.0815, 10.6355]
};
const tripWishKeys = ['adventure', 'water', 'play', 'discover', 'calm', 'sport', 'wellness', 'food'];
const tripChildcareLinks = {
  summer: {de: 'https://www.serfaus-fiss-ladis.at/de/sommerurlaub/familiensommer/kinderbetreuung',
    en: 'https://www.serfaus-fiss-ladis.at/en/summer-holiday/family-summer/child-care'},
  winter: {de: 'https://www.serfaus-fiss-ladis.at/de/winterurlaub/familienwinter/kinderbetreuung',
    en: 'https://www.serfaus-fiss-ladis.at/en/winter-holiday/family-winter/child-care'}
};
const tripText = {
  de: {
    invalid: 'Der Reiseplan in diesem Link ist ungültig oder unvollständig.',
    tooLong: 'Der Reiseplan in diesem Link ist zu lang.',
    unknownActivity: 'Ein Erlebnis aus eurem Plan gibt es im Katalog nicht mehr. Bitte sucht die Erlebnisse noch einmal.',
    wishes: {adventure: 'Abenteuer', water: 'Wasser', play: 'Spielen', discover: 'Entdecken', calm: 'Ruhe',
      sport: 'Sport', wellness: 'Wellness', food: 'Kulinarik'},
    adults: n => n === 1 ? '1 erwachsene Person' : `${n} Erwachsene`,
    children: n => n === 1 ? '1 Kind' : `${n} Kinder`,
    dogs: n => n === 1 ? '1 Hund' : `${n} Hunde`,
    advance: 'Voranmeldung erforderlich',
    info: 'Infos beim Anbieter',
    careTitle: 'Kinderbetreuung',
    careLabel: 'Betreuungszeit selbst eingetragen',
    estimateNote: 'Zeiten sind Vorschläge aus dem Reise-Canvas. Öffnungszeiten und Anmeldung bitte beim Anbieter prüfen.',
    locale: 'de-AT',
    dayFormat: {weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC'}
  },
  en: {
    invalid: 'The trip plan in this link is invalid or incomplete.',
    tooLong: 'The trip plan in this link is too long.',
    unknownActivity: 'An activity from your plan is no longer in the catalogue. Please search for activities again.',
    wishes: {adventure: 'Adventure', water: 'Water', play: 'Play', discover: 'Explore', calm: 'Relax',
      sport: 'Sport', wellness: 'Wellness', food: 'Food & drink'},
    adults: n => n === 1 ? '1 adult' : `${n} adults`,
    children: n => n === 1 ? '1 child' : `${n} children`,
    dogs: n => n === 1 ? '1 dog' : `${n} dogs`,
    advance: 'Advance booking required',
    info: 'Details from the provider',
    careTitle: 'Childcare',
    careLabel: 'Childcare hours you entered',
    estimateNote: 'Times are suggestions from the Travel Canvas. Please check opening hours and booking with the provider.',
    locale: 'en-GB',
    dayFormat: {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'}
  }
};
const tripMaxLength = 8000;
const tripMaxDays = 14;
const tripMaxEntries = 60;
const tripDayMs = 86400000;

function tripFail(lang, key = 'invalid') {
  return new Error((tripText[lang] || tripText.de)[key]);
}
function tripIsDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function tripAddDays(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * tripDayMs).toISOString().slice(0, 10);
}
function tripDates(start, end) {
  const dates = [];
  for (let date = start; date <= end; date = tripAddDays(date, 1)) dates.push(date);
  return dates;
}
// Names come from the person editor: plain text, no control characters, at most 24 characters.
function tripCleanText(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : null;
}
function tripBase64UrlDecode(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

// Parses and strictly validates `?t=`. `lang` ('de'|'en', e.g. from `?l=`) only picks the error language.
export function decodeTripParam(t, lang = 'de') {
  const errorLang = lang === 'en' ? 'en' : 'de';
  if (typeof t !== 'string' || !t) throw tripFail(errorLang);
  if (t.length > tripMaxLength) throw tripFail(errorLang, 'tooLong');
  if (!/^[A-Za-z0-9_-]+$/.test(t)) throw tripFail(errorLang);
  let data;
  try {
    data = JSON.parse(tripBase64UrlDecode(t));
  } catch {
    throw tripFail(errorLang);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) throw tripFail(errorLang);
  const l = data.l === 'en' ? 'en' : data.l === 'de' ? 'de' : null;
  if (!l) throw tripFail(errorLang);
  const fail = (key) => tripFail(l, key);

  if (!Object.hasOwn(tripVillages, data.p)) throw fail();
  if (!tripIsDate(data.s)) throw fail();
  if (data.e !== '' && (!tripIsDate(data.e) || data.e <= data.s)) throw fail();
  const end = data.e || data.s;
  const dates = tripDates(data.s, end);
  if (dates.length > tripMaxDays) throw fail();

  if (!Array.isArray(data.f) || data.f.length < 1 || data.f.length > 10) throw fail();
  const family = data.f.map(person => {
    if (!Array.isArray(person) || person.length !== 3 || !['a', 'c', 'd'].includes(person[0])) throw fail();
    const [kind, age, rawName] = person;
    const maxAge = kind === 'c' ? 17 : 120;
    if (kind === 'd' ? age !== null : !(age === null || (Number.isInteger(age) && age >= 0 && age <= maxAge))) throw fail();
    if (kind === 'c' && age === null) throw fail();
    const name = tripCleanText(rawName, 24);
    if (name === null) throw fail();
    return [kind, age, name];
  });
  if (!family.some(([kind]) => kind === 'a')) throw fail();

  if (!Array.isArray(data.w) || data.w.length > tripWishKeys.length ||
      new Set(data.w).size !== data.w.length || !data.w.every(key => tripWishKeys.includes(key))) throw fail();

  if (!Array.isArray(data.r) || data.r.length > tripMaxEntries) throw fail();
  const entries = data.r.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 6) throw fail();
    const [date, period, rawGroup, start, finish, index] = entry;
    if (!dates.includes(date) || !['am', 'pm'].includes(period)) throw fail();
    const group = tripCleanText(rawGroup, 40);
    if (group === null) throw fail();
    if (!Number.isInteger(start) || !Number.isInteger(finish) || start < 0 || finish > 1440 || start >= finish) throw fail();
    if (!Number.isInteger(index) || index < -1) throw fail();
    return [date, period, group, start, finish, index];
  });
  return {v: 1, l, p: data.p, s: data.s, e: data.e, f: family, w: [...data.w], r: entries};
}

function tripClock(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
function tripCoordinates(location, fallback) {
  const exact = tripLocations[location];
  if (exact) return exact;
  return tripVillages[String(location).split(' · ')[0]] || fallback;
}
function tripHttps(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}
const tripIsWinter = date => [11, 12, 1, 2, 3, 4].includes(Number(date.slice(5, 7)));

// Turns a decoded compact plan into the normalized trip. Activity titles, places and links always come from
// `catalog` (the array in dist/catalog.json), never from the browser.
export function resolveTrip(compact, {catalog, id}) {
  const lang = compact.l === 'en' ? 'en' : 'de';
  const text = tripText[lang];
  const [villageLat, villageLon] = tripVillages[compact.p];
  const end = compact.e || compact.s;

  const members = compact.f.map(([kind, age, name]) => ({
    name,
    kind: kind === 'a' ? 'adult' : kind === 'c' ? 'child' : 'dog',
    age: kind === 'd' ? null : age
  }));
  const adults = members.filter(p => p.kind === 'adult').length;
  const ages = members.filter(p => p.kind === 'child').map(p => p.age);
  const dogs = members.filter(p => p.kind === 'dog').length;
  const summary = [text.adults(adults), ages.length && text.children(ages.length), dogs && text.dogs(dogs)]
    .filter(Boolean).join(' · ');

  const dayFormat = new Intl.DateTimeFormat(text.locale, text.dayFormat);
  const days = tripDates(compact.s, end).map(date => ({
    date,
    label: dayFormat.format(new Date(date + 'T12:00:00Z')),
    stops: []
  }));
  const byDate = new Map(days.map(day => [day.date, day]));

  for (const [date, period, group, start, finish, index] of compact.r) {
    const order = {period, kind: index === -1 ? 0 : 1};
    if (index === -1) {
      byDate.get(date).stops.push({order, stop: {
        kind: 'care', start: tripClock(start), end: tripClock(finish),
        title: text.careTitle, operator: '',
        address: compact.p, place: compact.p,
        latitude: villageLat, longitude: villageLon,
        group: group || text.careTitle,
        booking: 'care', bookingLabel: text.careLabel,
        bookingLink: tripChildcareLinks[tripIsWinter(date) ? 'winter' : 'summer'][lang],
        note: '', price: null
      }});
      continue;
    }
    const activity = Array.isArray(catalog) ? catalog[index] : undefined;
    if (!activity || activity.region !== 'sfl' || !Array.isArray(activity.location) ||
        typeof activity.title !== 'string') throw tripFail(lang, 'unknownActivity');
    const location = String(activity.location[0] || compact.p);
    const [latitude, longitude] = tripCoordinates(location, [villageLat, villageLon]);
    const title = (lang === 'en' && activity.titleEn) || activity.title;
    const description = (lang === 'en' && activity.descriptionEn) || activity.description || '';
    byDate.get(date).stops.push({order, stop: {
      kind: 'activity', start: tripClock(start), end: tripClock(finish),
      title: String(title).slice(0, 120), operator: '',
      address: location, place: location,
      latitude, longitude,
      group: group || null,
      booking: activity.advanceBooking ? 'advance' : 'info',
      bookingLabel: activity.advanceBooking ? text.advance : text.info,
      bookingLink: tripHttps(activity.sources?.[0]),
      note: String(description).slice(0, 200), price: null
    }});
  }
  for (const day of days) {
    day.stops = day.stops
      .sort((a, b) => a.stop.start.localeCompare(b.stop.start) || a.order.kind - b.order.kind ||
        a.order.period.localeCompare(b.order.period))
      .map(item => item.stop);
  }

  const wishes = compact.w.map(key => text.wishes[key]);
  return {
    id,
    lang,
    start: compact.s,
    end,
    place: {name: compact.p, latitude: villageLat, longitude: villageLon},
    family: {adults, ages, dogs, summary, members},
    wishes,
    card: null,
    prices: false,
    days,
    total: null,
    totalLabel: '',
    estimateNote: text.estimateNote
  };
}
