// Builds the Reise-Canvas worker: node reise-canvas-prototyp/scripts/build.mjs → dist/server/index.js
// The site sources stay in dist/ (that is where the canvas is edited). The worker embeds every file directly in
// dist/ (with subfolders such as fonts/, without dist/server/), the wallet modules from server/ and the wallet images,
// and serves them all itself.
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const site = new URL('dist/', root);
const serverDir = new URL('server/', root);

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json'
};
const textual = type => /^text\/|json|svg|manifest/.test(type);

const siteAssets = {};
// Every file in dist/ and its subfolders (e.g. fonts/), except the worker bundle in dist/server/.
async function collectSite(dir, prefix) {
  for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (!(prefix === '' && entry.name === 'server')) await collectSite(new URL(entry.name + '/', dir), prefix + entry.name + '/');
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    const type = types[extension];
    if (!type) {
      console.warn(`Skipping dist/${prefix}${entry.name}: unknown file type.`);
      continue;
    }
    const bytes = await readFile(new URL(entry.name, dir));
    const asset = textual(type) ? {type, body: bytes.toString('utf8')} : {type, base64: bytes.toString('base64')};
    siteAssets['/' + prefix + entry.name] = asset;
    if (prefix === '' && entry.name === 'index.html') siteAssets['/'] = asset;
  }
}
await collectSite(site, '');
if (!siteAssets['/']) throw new Error('dist/index.html is missing.');
if (!siteAssets['/catalog.json']) throw new Error('dist/catalog.json is missing.');

// Wallet modules (server/wallet-*.mjs) are plain ES modules without imports. Each one runs in its own scope
// so helper names cannot clash; only its exported names become visible to the worker.
const exported = new Set();
const walletModules = [];
for (const file of (await readdir(serverDir)).filter(name => /^wallet-[\w-]+\.mjs$/.test(name)).sort()) {
  const source = await readFile(new URL(file, serverDir), 'utf8');
  if (/^\s*import[\s{*'"]/m.test(source)) throw new Error(`server/${file} must not use import statements.`);
  if (/^\s*export\s+(default\b|\{|\*)/m.test(source)) throw new Error(`server/${file}: only "export function|const|let|class" is supported.`);
  const names = [...source.matchAll(/^\s*export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]);
  for (const name of names) {
    if (exported.has(name)) throw new Error(`server/${file}: "${name}" is already exported by another wallet module.`);
    exported.add(name);
  }
  const body = source.replace(/^(\s*)export\s+/gm, '$1');
  walletModules.push(`// server/${file}\nconst {${names.join(',')}} = (() => {\n${body}\nreturn {${names.join(',')}};\n})();\n`);
}

// PNGs for the wallet passes (server/wallet-assets/**), embedded as base64 and decoded on first use.
const walletAssets = {};
async function collectAssets(dir, prefix) {
  let entries;
  try {
    entries = await readdir(dir, {withFileTypes: true});
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) await collectAssets(new URL(entry.name + '/', dir), prefix + entry.name + '/');
    else if (entry.name.endsWith('.png')) walletAssets[prefix + entry.name] = (await readFile(new URL(entry.name, dir))).toString('base64');
  }
}
await collectAssets(new URL('wallet-assets/', serverDir), '');

const worker = await readFile(new URL('worker.mjs', serverDir), 'utf8');
const output = new URL('dist/server/', root);
await mkdir(output, {recursive: true});
await writeFile(new URL('index.js', output),
  `const siteAssets = ${JSON.stringify(siteAssets)};\n${walletModules.join('')}` +
  `const walletAssets = ${JSON.stringify(walletAssets)};\n${worker}`);
console.log(`Built dist/server/index.js: ${Object.keys(siteAssets).length - 1} site files, ` +
  `${walletModules.length} wallet modules, ${Object.keys(walletAssets).length} wallet images.`);
