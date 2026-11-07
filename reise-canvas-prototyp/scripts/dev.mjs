// Runs the Reise-Canvas worker locally, including the wallet export:
//   node reise-canvas-prototyp/scripts/dev.mjs [port]        → http://localhost:8788
// Postcards are kept in memory (instead of R2) until the server stops.
//
// Wallet credentials are optional. Without them no wallet buttons appear on the last step.
//   Apple:  APPLE_PASS_CERT_FILE, APPLE_PASS_KEY_FILE, APPLE_WWDR_CERT_FILE  (PEM files, see docs/wallet.md)
//           APPLE_PASS_TYPE_ID / APPLE_TEAM_ID are read from the certificate when not set.
//   Google: GOOGLE_SA_JSON_FILE (service-account JSON key) and GOOGLE_ISSUER_ID
// Every secret can also be passed directly under its worker name (APPLE_PASS_CERT, GOOGLE_SA_KEY, …).
import http from 'node:http';
import os from 'node:os';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
const port = Number(process.argv[2] || process.env.PORT || 8788);

execFileSync(process.execPath, [fileURLToPath(new URL('scripts/build.mjs', root))], {stdio: 'inherit'});
const worker = (await import(new URL('dist/server/index.js', root).href)).default;

// Minimal in-memory stand-in for the R2 bucket binding (put, get, head, delete).
function memoryBucket() {
  const objects = new Map();
  const toBytes = async value => {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (typeof value === 'string') return new TextEncoder().encode(value);
    return new Uint8Array(await new Response(value).arrayBuffer());
  };
  const describe = (key, item) => ({key, size: item.bytes.length, httpMetadata: {...item.httpMetadata}, customMetadata: {...item.customMetadata}});
  return {
    objects,
    async put(key, value, options = {}) {
      objects.set(key, {bytes: await toBytes(value), httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {}});
      return describe(key, objects.get(key));
    },
    async head(key) {
      const item = objects.get(key);
      return item ? describe(key, item) : null;
    },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      return {...describe(key, item), get body() { return new Response(item.bytes).body; },
        arrayBuffer: async () => item.bytes.slice().buffer, text: async () => new TextDecoder().decode(item.bytes)};
    },
    async delete(keys) {
      for (const key of [].concat(keys)) objects.delete(key);
    }
  };
}

const env = {BUCKET: memoryBucket()};
const secrets = ['APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_PASS_CERT', 'APPLE_PASS_KEY', 'APPLE_WWDR_CERT',
  'GOOGLE_ISSUER_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY', 'WALLETWALLET_API_KEY'];
for (const name of secrets) {
  const file = process.env[name + '_FILE'];
  const value = process.env[name] || (file && readFileSync(file, 'utf8'));
  if (value) env[name] = value;
}
if (process.env.GOOGLE_SA_JSON_FILE) {
  const account = JSON.parse(readFileSync(process.env.GOOGLE_SA_JSON_FILE, 'utf8'));
  env.GOOGLE_SA_EMAIL ??= account.client_email;
  env.GOOGLE_SA_KEY ??= account.private_key;
}
if (env.APPLE_PASS_CERT && (!env.APPLE_PASS_TYPE_ID || !env.APPLE_TEAM_ID)) {
  const subject = Object.fromEntries(new X509Certificate(env.APPLE_PASS_CERT).subject.split('\n')
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  env.APPLE_PASS_TYPE_ID ??= subject.UID;
  env.APPLE_TEAM_ID ??= subject.OU;
}

http.createServer(async (req, res) => {
  try {
    const headers = new Headers(Object.entries(req.headers)
      .flatMap(([key, value]) => (Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]])));
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : req;
    const request = new Request(`http://${req.headers.host || 'localhost:' + port}${req.url}`,
      {method: req.method, headers, body, duplex: 'half'});
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Lokaler Serverfehler – siehe Terminal.');
  }
}).listen(port, '0.0.0.0', async () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal).map(entry => `http://${entry.address}:${port}`);
  const status = await (await worker.fetch(new Request(`http://localhost:${port}/api/wallet/status`), env)).json();
  console.log(`\nReise-Canvas läuft auf http://localhost:${port}`);
  if (lan.length) console.log(`Im selben WLAN (z. B. am Handy): ${lan.join('  ')}`);
  console.log(`Apple Wallet:  ${status.appleSigner === 'certificate' ? 'eigenes Zertifikat (' + env.APPLE_PASS_TYPE_ID + ')'
    : status.appleSigner === 'walletwallet' ? 'über WalletWallet' + (env.WALLETWALLET_API_KEY ? '' : ' (Prototyp-Schlüssel aus server/wallet-walletwallet.mjs)')
    : 'nicht eingerichtet'}`);
  console.log(`Google Wallet: ${status.google ? 'eingerichtet (Issuer ' + env.GOOGLE_ISSUER_ID + ')' : 'nicht eingerichtet'}`);
  console.log('Beenden mit Strg+C.\n');
});
