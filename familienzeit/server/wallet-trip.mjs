// Wallet export: the browser sends the planned trip as `?t=` (base64url of UTF-8 JSON, compact format v1).
// The worker decodes it here and resolves every activity against its own catalog, so titles, addresses,
// coordinates and booking links in a signed pass never come from the client.
//
// Compact format v1:
// {v:1, s:'YYYY-MM-DD', e:'YYYY-MM-DD', p:<index into localPlaces>, a:<adults>, k:[child ages], d:<dogs>,
//  c:'sfl'|'', r:[[date, startMin, endMin, activityId, groupLabel|'', covered 0|1, price|null], ...]}

const maxParamLength = 8000;
const maxDays = 14;
const maxStops = 60;

const bookingLabels = {
  pass: 'Mit Gästekarte einlösen',
  online: 'Online beim Anbieter buchen',
  office: 'Im Tourismusbüro buchen',
  onsite: 'Direkt vor Ort kaufen',
  free: 'Kein Ticket nötig'
};

const estimateNote = 'Wegezeiten und Eintrittskosten sind Schätzungen. Gebucht und bezahlt wird beim jeweiligen Anbieter.';

const dayFormat = new Intl.DateTimeFormat('de-AT', {timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'numeric'});

function fail(detail) {
  throw new Error('Der Reiseplan im Link ist ungültig' + (detail ? ': ' + detail : '') + '.');
}

function isoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

function addDays(date, days) {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function clock(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

function plainText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function base64urlToText(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

export function decodeTripParam(t) {
  if (typeof t !== 'string' || !t) fail('der Link enthält keinen Plan');
  if (t.length > maxParamLength) fail('der Plan ist zu lang');
  if (!/^[A-Za-z0-9_-]+$/.test(t)) fail('unerwartete Zeichen');
  let data;
  try {
    data = JSON.parse(base64urlToText(t));
  } catch {
    fail('der Plan ist nicht lesbar');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) fail('unbekanntes Format');
  const {s, e, p, a, k, d, c, r} = data;
  if (!isoDate(s) || !isoDate(e) || e < s) fail('Reisezeitraum');
  const dayCount = (Date.parse(e) - Date.parse(s)) / 86400000 + 1;
  if (dayCount > maxDays) fail('höchstens 14 Tage');
  if (!integer(p, 0, 99)) fail('Startort');
  if (!integer(a, 1, 10)) fail('Anzahl der Erwachsenen');
  if (!Array.isArray(k) || k.length > 12 || !k.every(age => integer(age, 0, 17))) fail('Alter der Kinder');
  if (!integer(d, 0, 5)) fail('Anzahl der Hunde');
  if (typeof c !== 'string' || (c && !/^[a-z]{1,20}$/.test(c))) fail('Gästekarte');
  if (!Array.isArray(r) || r.length > maxStops) fail('höchstens 60 Erlebnisse');
  const rows = r.map(row => {
    if (!Array.isArray(row) || row.length !== 7) fail('Erlebniszeile');
    const [date, start, end, id, group, covered, price] = row;
    if (!isoDate(date) || date < s || date > e) fail('Datum außerhalb des Zeitraums');
    if (!integer(start, 0, 1440) || !integer(end, 0, 1440) || start >= end) fail('Uhrzeit');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(id)) fail('Erlebnis');
    if (typeof group !== 'string' || group.length > 40) fail('Gruppenname');
    if (covered !== 0 && covered !== 1) fail('Gästekarte beim Erlebnis');
    if (price !== null && !(typeof price === 'number' && Number.isFinite(price) && price >= 0 && price <= 100000)) fail('Preis');
    return [date, start, end, id, group, covered, price];
  });
  return {v: 1, s, e, p, a, k: [...k], d, c, r: rows};
}

function familySummary(adults, ages, dogs) {
  const children = ages.length;
  return [
    `${adults} Erwachsene`,
    children && `${children} ${children === 1 ? 'Kind' : 'Kinder'}`,
    dogs && `${dogs} ${dogs === 1 ? 'Hund' : 'Hunde'}`
  ].filter(Boolean).join(' · ');
}

function passRule(activity, key, card, date) {
  if (!card || !key) return null;
  const monthDay = date.slice(5);
  if (card.start && (monthDay < card.start || monthDay > card.end)) return null;
  return activity.passes?.find(rule => rule.card === key && (!rule.from || rule.from <= date) && (!rule.to || date <= rule.to)) || null;
}

export function resolveTrip(compact, {catalog, places, cards, id} = {}) {
  if (!(catalog instanceof Map) || !Array.isArray(places) || !cards) throw new Error('Wallet-Export ist falsch konfiguriert.');
  const place = places[compact.p];
  if (!place) fail('Startort');
  const card = compact.c ? cards[compact.c] : null;
  if (compact.c && !card) fail('Gästekarte');

  const dates = [];
  for (let date = compact.s; date <= compact.e; date = addDays(date, 1)) dates.push(date);

  const stopsByDate = new Map(dates.map(date => [date, []]));
  for (const [date, start, end, activityId, group, covered, price] of compact.r) {
    const activity = catalog.get(activityId);
    if (!activity) throw new Error('Ein Erlebnis aus eurem Plan ist im Katalog nicht mehr verfügbar. Bitte plant den Tag neu.');
    const rule = covered ? passRule(activity, compact.c, card, date) : null;
    const booking = rule ? 'pass' : activity.booking;
    if (!Object.hasOwn(bookingLabels, booking)) fail('Buchungsweg');
    const [placeName, latitude, longitude] = activity.location;
    stopsByDate.get(date).push({
      start: clock(start),
      end: clock(end),
      title: plainText(activity.title, 120),
      operator: plainText(activity.operator, 120),
      address: plainText(activity.address, 200),
      place: plainText(placeName, 120),
      latitude,
      longitude,
      group: plainText(group, 40) || null,
      booking,
      bookingLabel: bookingLabels[booking],
      bookingLink: booking === 'online' && activity.bookingLink ? activity.bookingLink : null,
      note: plainText(rule ? rule.note : activity.bookingNote, 350),
      price: price === null ? null : Math.round(price * 100) / 100,
      sortKey: start
    });
  }

  const days = dates.map(date => ({
    date,
    label: dayFormat.format(new Date(date + 'T12:00:00Z')),
    stops: stopsByDate.get(date).sort((x, y) => x.sortKey - y.sortKey).map(({sortKey, ...stop}) => stop)
  }));
  const prices = days.flatMap(day => day.stops.map(stop => stop.price));
  const known = prices.filter(price => price !== null);

  return {
    id: id || crypto.randomUUID(),
    start: compact.s,
    end: compact.e,
    place: {name: place.name, latitude: place.latitude, longitude: place.longitude},
    family: {adults: compact.a, ages: [...compact.k], dogs: compact.d, summary: familySummary(compact.a, compact.k, compact.d)},
    card: card ? {name: card.name, source: card.source} : null,
    days,
    total: known.length ? Math.round(known.reduce((sum, price) => sum + price, 0) * 100) / 100 : null,
    totalLabel: prices.some(price => price === null) ? 'Summe der bekannten Eintrittspreise' : 'Geschätzter Eintritt gesamt',
    estimateNote
  };
}
