// Reise-Canvas worker: serves the canvas (embedded from dist/ by scripts/build.mjs) and the wallet export.
// Globals provided by the build: siteAssets, walletAssets, and the exports of server/wallet-*.mjs
// (decodeTripParam, resolveTrip, buildApplePass, buildApplePassJson, buildGoogleSaveUrl, buildWalletWalletPass,
// APPLE_STRIP_SIZES, GOOGLE_HERO_SIZE, WALLETWALLET_STRIP_SIZES, WALLETWALLET_API_KEY).

const securityHeaders = {'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'};
const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store', ...securityHeaders}});

// ---- Static site -----------------------------------------------------------------------------------------

const siteBytes = new Map();
function siteAsset(pathname, method) {
  const asset = Object.hasOwn(siteAssets, pathname) && siteAssets[pathname];
  if (!asset) return null;
  let body = asset.body;
  if (asset.base64 !== undefined) {
    if (!siteBytes.has(pathname)) siteBytes.set(pathname, base64Bytes(asset.base64));
    body = siteBytes.get(pathname);
  }
  return new Response(method === 'HEAD' ? null : body, {headers: {
    'Content-Type': asset.type, 'Cache-Control': 'no-cache', ...securityHeaders
  }});
}
function base64Bytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
let catalogCache;
function canvasCatalog() {
  catalogCache ??= JSON.parse(siteAssets['/catalog.json'].body);
  return catalogCache;
}

// ---- Wallet configuration ---------------------------------------------------------------------------------

const walletAssetCache = new Map();
function walletAsset(key) {
  if (typeof walletAssets === 'undefined' || !Object.hasOwn(walletAssets, key)) return null;
  if (!walletAssetCache.has(key)) walletAssetCache.set(key, base64Bytes(walletAssets[key]));
  return walletAssetCache.get(key);
}
function walletImages(prefix) {
  if (typeof walletAssets === 'undefined') return {};
  return Object.fromEntries(Object.keys(walletAssets).filter(key => key.startsWith(prefix))
    .map(key => [key.slice(prefix.length), walletAsset(key)]));
}
// PEM secrets may be stored as the PEM text itself (also with escaped "\n", as in a service-account JSON)
// or base64-encoded so that line breaks survive the hosting's secret form.
function walletPem(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = value.trim();
  if (text.includes('-----BEGIN')) return text.replace(/\\n/g, '\n');
  try {
    const decoded = atob(text.replace(/\s+/g, ''));
    return decoded.includes('-----BEGIN') ? decoded.trim() : '';
  } catch {
    return '';
  }
}
function appleWalletConfig(env) {
  if (typeof buildApplePass !== 'function') return null;
  const config = {
    passTypeIdentifier: env.APPLE_PASS_TYPE_ID?.trim(), teamIdentifier: env.APPLE_TEAM_ID?.trim(),
    certificatePem: walletPem(env.APPLE_PASS_CERT), privateKeyPem: walletPem(env.APPLE_PASS_KEY),
    wwdrPem: walletPem(env.APPLE_WWDR_CERT)
  };
  return Object.values(config).every(Boolean) ? {...config, images: walletImages('apple/')} : null;
}
function googleWalletConfig(env, origin) {
  if (typeof buildGoogleSaveUrl !== 'function') return null;
  const config = {
    issuerId: env.GOOGLE_ISSUER_ID?.trim(), serviceAccountEmail: env.GOOGLE_SA_EMAIL?.trim(),
    privateKeyPem: walletPem(env.GOOGLE_SA_KEY), origin
  };
  return Object.values(config).every(Boolean) ? config : null;
}
// Without an own Apple certificate, Apple passes can be signed by WalletWallet (server/wallet-walletwallet.mjs).
// Its key comes from the worker secret WALLETWALLET_API_KEY, otherwise from the prototype key in that module.
function walletWalletConfig(env) {
  if (typeof buildWalletWalletPass !== 'function' || typeof buildApplePassJson !== 'function') return null;
  const apiKey = env.WALLETWALLET_API_KEY?.trim() || (typeof WALLETWALLET_API_KEY === 'string' ? WALLETWALLET_API_KEY : '');
  if (!apiKey) return null;
  const image = name => walletAsset('apple/' + name + '@3x.png') || walletAsset('apple/' + name + '@2x.png') || walletAsset('apple/' + name + '.png');
  return {apiKey, images: {logo: image('logo'), icon: image('icon')}};
}
// How Apple passes are signed here: with our own certificate if one is configured, otherwise through WalletWallet.
function appleMode(env) {
  if (appleWalletConfig(env)) return 'certificate';
  return walletWalletConfig(env) ? 'walletwallet' : null;
}

// Image sizes the browser renders from the postcard. The builders define them; the fallbacks keep the worker
// usable if a builder module is missing.
const validSize = size => Array.isArray(size) && size.length === 2 && size.every(n => Number.isInteger(n) && n > 0 && n <= 4096);
const validSizes = sizes => Array.isArray(sizes) && sizes.length === 3 && sizes.every(validSize);
function walletSizes(env = {}) {
  // WalletWallet lays a strip out as a store card (375 × 123 pt), our own pass as an event ticket (375 × 98 pt).
  const viaWalletWallet = appleMode(env) === 'walletwallet';
  const strip = viaWalletWallet
    ? (typeof WALLETWALLET_STRIP_SIZES !== 'undefined' && validSizes(WALLETWALLET_STRIP_SIZES) ? WALLETWALLET_STRIP_SIZES : [[375, 123], [750, 246], [1125, 369]])
    : (typeof APPLE_STRIP_SIZES !== 'undefined' && validSizes(APPLE_STRIP_SIZES) ? APPLE_STRIP_SIZES : [[375, 98], [750, 196], [1125, 294]]);
  const hero = typeof GOOGLE_HERO_SIZE !== 'undefined' && validSize(GOOGLE_HERO_SIZE) ? GOOGLE_HERO_SIZE : [1032, 336];
  return {strip, hero};
}
function postcardFiles(env) {
  const {strip, hero} = walletSizes(env);
  return {strip: strip[0], 'strip@2x': strip[1], 'strip@3x': strip[2], hero};
}

// ---- Wallet pages (browser navigations) -------------------------------------------------------------------

const walletText = {
  de: {
    heading: 'Ins Wallet', back: 'Zurück zum Reise-Canvas',
    notConfigured: label => `${label} ist auf diesem Server noch nicht eingerichtet.`,
    failed: label => `Die Karte für ${label} konnte gerade nicht erstellt werden. Bitte versucht es gleich noch einmal.`,
    method: 'Diese Adresse lässt sich nur öffnen, nicht absenden.',
    postcard: 'Die Postkarte zu dieser Karte ist nicht mehr gespeichert. Bitte erstellt die Karte im Reise-Canvas neu.'
  },
  en: {
    heading: 'Add to Wallet', back: 'Back to the Travel Canvas',
    notConfigured: label => `${label} is not set up on this server yet.`,
    failed: label => `The ${label} pass couldn’t be created right now. Please try again in a moment.`,
    method: 'This address can only be opened, not submitted.',
    postcard: 'The postcard for this pass is no longer stored. Please create the pass again in the Travel Canvas.'
  }
};
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
function walletPage(status, message, lang) {
  const text = walletText[lang] || walletText.de;
  return new Response(`<!doctype html><html lang="${lang === 'en' ? 'en-GB' : 'de-AT'}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
    `<title>${escapeHTML(text.heading)} · Familienzeit</title><style>` +
    `body{margin:0;background:#f4f2e7;color:#173443;font:16px/1.5 system-ui,-apple-system,sans-serif}` +
    `main{max-width:560px;margin:12vh auto;padding:24px;background:#fffdf5;border:1px solid #d6dbcc;border-radius:12px}` +
    `.brand{color:#245748;font-weight:850;letter-spacing:-.04em;font-size:22px;margin:0 0 18px}` +
    `h1{font:700 32px/1.1 Georgia,serif;margin:0 0 10px}p{color:#52676b}a{color:#245748;font-weight:750}` +
    `</style></head><body><main><p class="brand">✳ familienzeit</p><h1>${escapeHTML(text.heading)}</h1>` +
    `<p>${escapeHTML(message)}</p><p><a href="/">${escapeHTML(text.back)}</a></p></main></body></html>`, {
    status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...securityHeaders}
  });
}

// ---- Postcards in R2 --------------------------------------------------------------------------------------

const postcardId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const maxImageBytes = 1024 * 1024;
const maxUploadBytes = 4 * maxImageBytes + 64 * 1024;
const retentionDays = 30;

function pngSize(bytes) {
  if (bytes.length < 24 || !pngSignature.every((value, i) => bytes[i] === value)) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const expired = object => !object?.customMetadata?.expires || Date.parse(object.customMetadata.expires) < Date.now();

async function uploadPostcard(request, env) {
  if (request.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({error: 'Cross-origin uploads are not allowed.'}, 403);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data')) return json({error: 'Expected multipart/form-data.'}, 415);
  if (!env.BUCKET) return json({error: 'Postcard storage is not configured.'}, 503);
  if (!appleMode(env) && !googleWalletConfig(env, new URL(request.url).origin)) return json({error: 'No wallet is configured.'}, 503);
  if (Number(request.headers.get('Content-Length')) > maxUploadBytes) return json({error: 'Upload too large.'}, 413);

  let form;
  try {
    let total = 0;
    const bounded = request.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxUploadBytes) throw new Error('too large');
        controller.enqueue(chunk);
      }
    }));
    form = await new Response(bounded, {headers: {'Content-Type': request.headers.get('Content-Type')}}).formData();
  } catch (error) {
    return error?.message === 'too large' ? json({error: 'Upload too large.'}, 413) : json({error: 'Invalid form data.'}, 400);
  }

  const end = form.get('end');
  const latest = new Date(Date.now() + 2 * 366 * 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (!isoDate(end) || end < yesterday || end > latest) return json({error: 'Invalid trip end date.'}, 400);
  const expires = new Date(Date.parse(end + 'T23:59:59Z') + retentionDays * 86400000).toISOString();

  const files = {};
  for (const [name, [width, height]] of Object.entries(postcardFiles(env))) {
    const file = form.get(name);
    if (!(file instanceof File)) return json({error: `Missing image "${name}".`}, 400);
    if (file.size > maxImageBytes) return json({error: `Image "${name}" is larger than 1 MB.`}, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = pngSize(bytes);
    if (!size) return json({error: `Image "${name}" is not a PNG.`}, 415);
    if (size[0] !== width || size[1] !== height) return json({error: `Image "${name}" must be ${width}×${height} pixels.`}, 400);
    files[name] = bytes;
  }
  const id = crypto.randomUUID();
  try {
    for (const [name, bytes] of Object.entries(files)) {
      await env.BUCKET.put(`postcards/${id}/${name}.png`, bytes, {
        httpMetadata: {contentType: 'image/png'}, customMetadata: {expires}
      });
    }
  } catch (error) {
    console.error('Postcard upload failed', error);
    await env.BUCKET.delete(Object.keys(files).map(name => `postcards/${id}/${name}.png`)).catch(() => {});
    return json({error: 'Postcard storage is not reachable.'}, 503);
  }
  return json({id, expires}, 201);
}

async function postcardObject(env, id, name) {
  if (!env.BUCKET || !postcardId.test(id)) return null;
  const object = await env.BUCKET.get(`postcards/${id}/${name}.png`);
  if (!object) return null;
  if (expired(object)) {
    await env.BUCKET.delete(Object.keys(postcardFiles(env)).map(file => `postcards/${id}/${file}.png`)).catch(() => {});
    return null;
  }
  return object;
}
async function postcardStrip(env, id) {
  const images = {};
  for (const name of ['strip', 'strip@2x', 'strip@3x']) {
    const object = await postcardObject(env, id, name);
    if (!object) return null;
    images[name + '.png'] = new Uint8Array(await object.arrayBuffer());
  }
  return images;
}
async function servePostcardHero(env, id, method) {
  const object = await postcardObject(env, id, 'hero');
  if (!object) return new Response('Not found.', {status: 404, headers: securityHeaders});
  return new Response(method === 'HEAD' ? null : object.body, {headers: {
    'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', ...securityHeaders
  }});
}

// ---- Wallet passes ----------------------------------------------------------------------------------------

async function walletPass(request, env, kind) {
  const url = new URL(request.url);
  let lang = url.searchParams.get('l') === 'en' ? 'en' : 'de';
  const label = kind === 'apple' ? 'Apple Wallet' : 'Google Wallet';
  if (request.method !== 'GET') return walletPage(405, walletText[lang].method, lang);
  const config = kind === 'apple' ? appleWalletConfig(env) || walletWalletConfig(env) : googleWalletConfig(env, url.origin);
  if (!config || typeof decodeTripParam !== 'function') return walletPage(503, walletText[lang].notConfigured(label), lang);

  let trip;
  try {
    const compact = decodeTripParam(url.searchParams.get('t'), lang);
    lang = compact.l;
    trip = resolveTrip(compact, {catalog: canvasCatalog(), id: crypto.randomUUID()});
  } catch (error) {
    return walletPage(400, error.message, lang);
  }
  const postcard = url.searchParams.get('p');
  const home = `${url.origin}/`; // the QR code on the pass opens the Reise-Canvas home page
  if (postcard !== null && !postcardId.test(postcard)) return walletPage(400, walletText[lang].postcard, lang);

  try {
    if (kind === 'apple') {
      const strip = postcard ? await postcardStrip(env, postcard) : null;
      if (postcard && !strip) console.warn('Postcard missing or expired, building the pass without it', postcard);
      const pass = appleMode(env) === 'certificate'
        ? await buildApplePass(trip, {...config, images: {...config.images, ...strip}, barcodeUrl: home})
        : await buildWalletWalletPass(trip, buildApplePassJson(trip, {images: strip ? {'strip.png': strip['strip.png']} : {}, barcodeUrl: home}), {
          apiKey: config.apiKey, barcodeUrl: url.origin + '/',
          images: {...config.images, ...(strip && {strip: strip['strip.png'], strip2x: strip['strip@2x.png'], strip3x: strip['strip@3x.png']})}
        });
      return new Response(pass, {headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'attachment; filename="familienzeit.pkpass"',
        'Cache-Control': 'no-store', ...securityHeaders
      }});
    }
    const hero = postcard ? await postcardObject(env, postcard, 'hero') : null;
    if (postcard && !hero) console.warn('Postcard missing or expired, building the pass without it', postcard);
    const location = await buildGoogleSaveUrl(trip, hero
      ? {...config, barcodeUrl: home, heroImageUrl: `${url.origin}/api/wallet/postcards/${postcard}/hero.png`} : {...config, barcodeUrl: home});
    return new Response(null, {status: 302, headers: {Location: location, 'Cache-Control': 'no-store', ...securityHeaders}});
  } catch (error) {
    console.error(`${label} pass failed`, error);
    return walletPage(500, walletText[lang].failed(label), lang);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const {pathname} = url;
    try {
      if (pathname === '/api/wallet/status') {
        if (request.method !== 'GET') return json({error: 'Method not allowed.'}, 405);
        return json({apple: Boolean(appleMode(env)), appleSigner: appleMode(env), google: Boolean(googleWalletConfig(env, url.origin)), ...walletSizes(env)});
      }
      if (pathname === '/api/wallet/postcard') return await uploadPostcard(request, env);
      if (pathname === '/api/wallet/apple' || pathname === '/api/wallet/google') {
        return await walletPass(request, env, pathname.slice('/api/wallet/'.length));
      }
      const hero = /^\/api\/wallet\/postcards\/([0-9a-f-]{36})\/hero\.png$/.exec(pathname);
      if (hero && ['GET', 'HEAD'].includes(request.method)) return await servePostcardHero(env, hero[1], request.method);
      if (pathname.startsWith('/api/')) return json({error: 'Not found.'}, 404);

      const walletImage = /^\/wallet\/([a-z0-9-]+)\.png$/.exec(pathname);
      if (walletImage && ['GET', 'HEAD'].includes(request.method)) {
        const bytes = walletAsset('google/' + walletImage[1] + '.png');
        if (!bytes) return new Response('Not found.', {status: 404, headers: securityHeaders});
        return new Response(request.method === 'HEAD' ? null : bytes, {headers: {
          'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', ...securityHeaders
        }});
      }
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', {status: 405, headers: securityHeaders});
      return siteAsset(pathname, request.method) ||
        new Response('Seite nicht gefunden.', {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders}});
    } catch (error) {
      console.error('Request failed', error);
      return pathname.startsWith('/api/') ? json({error: 'Server error.'}, 500)
        : new Response('Serverfehler.', {status: 500, headers: {'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders}});
    }
  }
};
