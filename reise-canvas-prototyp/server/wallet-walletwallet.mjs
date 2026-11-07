// WalletWallet API key for the prototype (free plan, 1,000 passes a month). The worker secret / environment variable
// WALLETWALLET_API_KEY overrides it. Anyone who can read this repository can use this key – rotate it at
// walletwallet.dev if the repository is or becomes public.
export const WALLETWALLET_API_KEY = 'ww_live_098ba507c6b2ad58dd197d4d777df15a';

// Apple Wallet via WalletWallet (https://walletwallet.dev): for teams without their own Apple Developer account.
// WalletWallet signs the pass with its own Pass Type ID certificate. The worker builds the same content as our own
// Apple pass (buildApplePassJson), maps it onto WalletWallet's request format and hands the signed .pkpass that comes
// back straight to the browser. The family never sees WalletWallet.
//
// Request format (docs at walletwallet.dev): POST https://api.walletwallet.dev/api/passes, Bearer API key, JSON with
// logoText, organizationName, description, header/primary/secondary/backFields (≤ 10 each, label ≤ 64, value ≤ 256),
// locations (≤ 10, relevantText ≤ 128), colorPreset, expirationDays and – on Pro plans – color and image fields that
// take PNG data URIs (≤ 1 MB each, request ≤ 2 MB). A strip image switches the pass to the store-card layout.
// The docs we could read exist in two versions: the newer one answers JSON with a base64 `applePass`, the older one
// (/api/pkpass) answers the .pkpass bytes and says a barcode is required. This module handles both.
//
// No imports and no dependencies: the worker build wraps this file in its own scope.

// Store-card strip image: 375 × 123 points (1x/2x/3x pixels). The browser renders the postcard crop in these sizes.
export const WALLETWALLET_STRIP_SIZES = [[375, 123], [750, 246], [1125, 369]];

const wwBase = 'https://api.walletwallet.dev';
const wwProFields = ['color', 'logoURL', 'wideLogoURL', 'thumbnailURL', 'stripURL', 'iconURL'];
const wwMaxImage = 1024 * 1024;

function wwClip(value, max) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  // Cut at the last line break or space that keeps the text readable, then mark the cut.
  const cut = text.slice(0, max - 1);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd() + '…';
}
function wwField(field) {
  return {label: wwClip(field.label, 64), value: wwClip(field.value, 256)};
}
function wwMinutes(time) {
  const [hour, minute] = String(time).split(':').map(Number);
  return hour * 60 + minute;
}
function wwBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function wwBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
const wwDataUri = bytes => bytes && bytes.length && bytes.length <= wwMaxImage ? 'data:image/png;base64,' + wwBase64(bytes) : null;

// One short line per stop, so a day fits into WalletWallet's 256 characters per back field.
function wwDayText(day) {
  return [...day.stops].sort((a, b) => wwMinutes(a.start) - wwMinutes(b.start))
    .map(stop => `${stop.start}–${stop.end} ${stop.title}${stop.group && stop.kind !== 'care' ? ` (${stop.group})` : ''}`)
    .join('\n');
}

// Back fields: the same order as our own Apple pass, with the days shortened to one line per stop. At most 10 fields:
// if a long trip needs more, the family line and the intro go first (both are on the front as well), then
// neighbouring days are merged.
function wwBackFields(trip, passJson) {
  const style = passJson.eventTicket || passJson.generic || passJson.storeCard || {};
  const source = style.backFields || [];
  const days = new Map(trip.days.map(day => [`day-${day.date}`, day]));
  let fields = source.map(field => {
    const day = days.get(field.key);
    return {key: field.key, label: field.label, value: day && day.stops.length ? wwDayText(day) : field.value};
  });
  for (const key of ['members', 'about']) {
    if (fields.length > 10) fields = fields.filter(field => field.key !== key);
  }
  while (fields.length > 10) {
    const index = fields.findIndex((field, i) => field.key.startsWith('day-') && fields[i + 1]?.key.startsWith('day-'));
    if (index < 0) {
      fields = fields.slice(0, 10);
      break;
    }
    const [first, second] = [fields[index], fields[index + 1]];
    fields.splice(index, 2, {key: first.key, label: `${first.label} / ${second.label}`, value: `${first.value}\n\n${second.label}\n${second.value}`});
  }
  return fields.map(wwField);
}

// The request body for one pass. `images` holds PNG bytes: strip (the postcard crop), logo and icon.
export function walletWalletBody(trip, passJson, {images = {}, now = Date.now(), pro = true} = {}) {
  const style = passJson.eventTicket || passJson.generic || passJson.storeCard || {};
  const front = [...(style.secondaryFields || []), ...(style.auxiliaryFields || [])].slice(0, 4).map(wwField);
  const tripEnd = Date.parse(`${trip.end}T23:59:00Z`);
  const body = {
    logoText: wwClip(passJson.logoText || 'familienzeit.', 64),
    organizationName: wwClip(passJson.organizationName || 'Familienzeit', 64),
    description: wwClip(passJson.description || 'Familienzeit', 128),
    headerFields: (style.headerFields || []).slice(0, 10).map(wwField),
    primaryFields: (style.primaryFields || []).slice(0, 10).map(wwField),
    secondaryFields: front,
    backFields: wwBackFields(trip, passJson),
    colorPreset: 'green',
    sharingProhibited: false,
    // Whole days from now, rounded up: the pass leaves the Wallet within a day after the trip ends.
    expirationDays: Math.min(3650, Math.max(1, Math.ceil((tripEnd - now) / 86400000)))
  };
  if (Array.isArray(passJson.locations) && passJson.locations.length) {
    body.locations = passJson.locations.slice(0, 10).map(({latitude, longitude, relevantText}) =>
      ({latitude, longitude, ...(relevantText ? {relevantText: wwClip(relevantText, 128)} : {})}));
  }
  if (pro) {
    body.color = '#294e41';
    const strip = wwDataUri(images.strip3x) || wwDataUri(images.strip2x) || wwDataUri(images.strip);
    const logo = wwDataUri(images.logo);
    const icon = wwDataUri(images.icon);
    if (strip) body.stripURL = strip;
    if (logo) body.logoURL = logo;
    if (icon) body.iconURL = icon;
    // Keep the whole request under WalletWallet's 2 MB: drop the extras first, the postcard last.
    for (const name of ['iconURL', 'logoURL', 'stripURL']) {
      if (JSON.stringify(body).length > 1.9 * 1024 * 1024) delete body[name];
    }
  }
  return body;
}

async function wwRead(response) {
  const type = response.headers.get('content-type') || '';
  if (/pkpass|octet-stream|zip/.test(type)) {
    // Older endpoint: the pass itself, links in (CORS-exposed) headers.
    return {pass: new Uint8Array(await response.arrayBuffer()),
      json: {shareUrl: response.headers.get('x-pass-url'), googleSaveUrl: response.headers.get('x-google-save-url')}};
  }
  const text = await response.text();
  try {
    return {json: JSON.parse(text), text};
  } catch {
    return {text};
  }
}
const wwIsZip = bytes => bytes instanceof Uint8Array && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
const wwHttps = value => typeof value === 'string' && /^https:\/\//.test(value) ? value : null;

// Creates the pass at WalletWallet. Returns {pass, shareUrl, googleSaveUrl}: the signed .pkpass bytes, WalletWallet's
// hosted install page (Add to Apple Wallet on iPhone, Save to Google Wallet on Android, a QR code on desktops) and
// the Save to Google Wallet link. Runs in the worker and in the browser (the static GitHub Pages copy).
// config: {apiKey, images?, fetch?, now?, barcodeUrl? (used only if WalletWallet insists on a barcode), baseUrl?}
export async function createWalletWalletPass(trip, passJson, config) {
  if (!config?.apiKey) throw new Error('WalletWallet: API key missing.');
  const doFetch = config.fetch || ((...args) => fetch(...args));
  const base = config.baseUrl || wwBase;
  let pro = true, barcode = false, legacy = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const body = walletWalletBody(trip, passJson, {images: config.images, now: config.now, pro});
    if (barcode && config.barcodeUrl) Object.assign(body, {barcodeValue: config.barcodeUrl, barcodeFormat: 'QR', barcodeAltText: 'Reise-Canvas'});
    const response = await doFetch(base + (legacy ? '/api/pkpass' : '/api/passes'), {
      method: 'POST',
      headers: {'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json, application/vnd.apple.pkpass'},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    const result = await wwRead(response);
    if (response.ok) {
      const pass = result.pass || (typeof result.json?.applePass === 'string' ? wwBytes(result.json.applePass) : null);
      if (!wwIsZip(pass)) throw new Error('WalletWallet: the answer contained no .pkpass.');
      return {pass, shareUrl: wwHttps(result.json?.shareUrl), googleSaveUrl: wwHttps(result.json?.googleSaveUrl)};
    }
    const message = (result.json?.error || result.json?.message || result.text || '').toString().slice(0, 300);
    if (response.status === 404 && !legacy) {
      legacy = true;
      continue;
    }
    if ([400, 402, 403].includes(response.status) && pro && /pro|plan|upgrade|paid|color|logo|strip|icon|image/i.test(message)) {
      pro = false;
      continue;
    }
    if (response.status === 400 && !barcode && config.barcodeUrl && /barcode/i.test(message)) {
      barcode = true;
      continue;
    }
    if (response.status === 401) throw new Error('WalletWallet: the API key was rejected (401).');
    if (response.status === 429) throw new Error('WalletWallet: monthly pass limit reached (429).');
    throw new Error(`WalletWallet: ${response.status} ${message}`.trim());
  }
  throw new Error('WalletWallet: no pass after several attempts.');
}

// The worker only needs the signed .pkpass bytes.
export async function buildWalletWalletPass(trip, passJson, config) {
  return (await createWalletWalletPass(trip, passJson, config)).pass;
}
