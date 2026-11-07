// Runs the Familienzeit worker locally, including the wallet routes:
//   node familienzeit/scripts/dev.mjs [port]        → http://localhost:8787
// The catalog comes from server/catalog.json (read-only, no D1 needed); photos uploaded in the admin are not available.
//
// Wallet credentials are optional. Without them the wallet buttons open a "noch nicht eingerichtet" page.
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
const port = Number(process.argv[2] || process.env.PORT || 8787);

execFileSync(process.execPath, [fileURLToPath(new URL('scripts/build.mjs', root))], {stdio: 'inherit'});
const worker = (await import(new URL('dist/server/index.js', root).href)).default;

const catalog = JSON.parse(readFileSync(new URL('server/catalog.json', root), 'utf8')).filter(entry => entry.region === 'sfl');
const rows = catalog.map(({id, ...details}) => ({id, revision: 'local', active: details.active === false ? 0 : 1, details: JSON.stringify(details)}));
const DB = {
  prepare(sql) {
    const statement = {
      bind: () => statement,
      // Pretend the catalog imports already ran, so the worker never writes.
      first: async () => (/catalog_imports/.test(sql) ? {name: 'local'} : null),
      all: async () => ({results: /active=1/.test(sql) ? rows.filter(row => row.active) : rows}),
      run: async () => { throw new Error('Der lokale Katalog ist schreibgeschützt.'); }
    };
    return statement;
  },
  batch: async () => []
};

const env = {DB, BUCKET: {get: async () => null}};
const secrets = ['APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_PASS_CERT', 'APPLE_PASS_KEY', 'APPLE_WWDR_CERT',
  'GOOGLE_ISSUER_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY'];
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
}).listen(port, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal).map(entry => `http://${entry.address}:${port}`);
  const ready = names => names.every(name => env[name]);
  console.log(`\nFamilienzeit läuft auf http://localhost:${port}`);
  if (lan.length) console.log(`Im selben WLAN (z. B. am Handy): ${lan.join('  ')}`);
  console.log(`Apple Wallet:  ${ready(secrets.slice(0, 5)) ? 'eingerichtet (' + env.APPLE_PASS_TYPE_ID + ')' : 'nicht eingerichtet'}`);
  console.log(`Google Wallet: ${ready(secrets.slice(5)) ? 'eingerichtet (Issuer ' + env.GOOGLE_ISSUER_ID + ')' : 'nicht eingerichtet'}`);
  console.log('Beenden mit Strg+C.\n');
});
