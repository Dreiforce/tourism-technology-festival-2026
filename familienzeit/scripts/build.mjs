import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';

const assets = {};
for (const [route, file, type] of [
  ['/', 'index.html', 'text/html'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/guest-cards.js', 'guest-cards.js', 'text/javascript'],
  ['/accessibility.js', 'accessibility.js', 'text/javascript'],
  ['/region.js', 'region.js', 'text/javascript'],
  ['/planning.js', 'planning.js', 'text/javascript'],
  ['/styles.css', 'styles.css', 'text/css'],
  ['/admin', 'admin.html', 'text/html'],
  ['/admin.js', 'admin.js', 'text/javascript'],
]) {
  assets[route] = {type, body: await readFile(new URL('../site/'+file, import.meta.url), 'utf8')};
}
const catalog = JSON.parse(await readFile(new URL('../server/catalog.json', import.meta.url), 'utf8'));
const shared = ['/accessibility.js','/guest-cards.js','/region.js'].map(route=>assets[route].body.replace(/^export /gm,'')).join('\n');

// Wallet modules (server/wallet-*.mjs) are plain ES modules without imports. Each one runs in its own scope
// so helper names cannot clash; only its exported names become visible to the worker.
const serverDir = new URL('../server/', import.meta.url);
const exported = new Set();
const walletModules = [];
for (const file of (await readdir(serverDir)).filter(name=>/^wallet-[\w-]+\.mjs$/.test(name)).sort()) {
  const source = await readFile(new URL(file, serverDir), 'utf8');
  if (/^\s*import[\s{*'"]/m.test(source)) throw new Error(`server/${file} must not use import statements.`);
  if (/^\s*export\s+(default\b|\{|\*)/m.test(source)) throw new Error(`server/${file}: only "export function|const|let|class" is supported.`);
  const names = [...source.matchAll(/^\s*export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(match=>match[1]);
  for (const name of names) {
    if (exported.has(name)) throw new Error(`server/${file}: "${name}" is already exported by another wallet module.`);
    exported.add(name);
  }
  const body = source.replace(/^(\s*)export\s+/gm,'$1');
  walletModules.push(`// server/${file}\nconst {${names.join(',')}} = (() => {\n${body}\nreturn {${names.join(',')}};\n})();\n`);
}

// PNGs for the wallet passes, embedded as base64 and decoded on first use by the worker.
const walletAssets = {};
async function collectAssets(dir, prefix) {
  let entries;
  try {
    entries = await readdir(dir, {withFileTypes:true});
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) await collectAssets(new URL(entry.name+'/', dir), prefix+entry.name+'/');
    else if (entry.name.endsWith('.png')) walletAssets[prefix+entry.name] = (await readFile(new URL(entry.name, dir))).toString('base64');
  }
}
await collectAssets(new URL('wallet-assets/', serverDir), '');

const worker = await readFile(new URL('../server/worker.mjs', import.meta.url), 'utf8');
const output = new URL('../dist/server/', import.meta.url);
await mkdir(output, {recursive:true});
await writeFile(new URL('index.js',output),
  `const assets = ${JSON.stringify(assets)};\nconst initialCatalog = ${JSON.stringify(catalog)};\n${shared}\n` +
  `${walletModules.join('')}const walletAssets = ${JSON.stringify(walletAssets)};\n${worker}`);
