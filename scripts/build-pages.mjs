import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/pages/', root);
const main = new URL('familienzeit/', output);
const source = new URL('familienzeit/site/', root);
const data = new URL('familienzeit/static/', root);
const prototypes = ['familienfenster-prototyp', 'reise-canvas-prototyp'];

const catalog = JSON.parse(await readFile(new URL('catalog.json', data), 'utf8'));
const active = catalog.filter(entry => entry.active !== false && entry.region === 'sfl');
const ids = new Set(active.map(entry => entry.id));
if (!active.length || ids.size !== active.length || active.some(entry => !entry.id || !entry.title || !Array.isArray(entry.hours))) {
  throw new Error('The public catalog must contain active entries with unique IDs, titles and opening hours.');
}

const siteUrl = process.env.PAGES_BASE_URL;
const canonical = siteUrl
  ? new URL('familienzeit/', siteUrl.endsWith('/') ? siteUrl : siteUrl + '/').href
  : '';

await rm(output, { recursive: true, force: true });
await mkdir(main, { recursive: true });
await cp(data, main, { recursive: true });
await writeFile(new URL('catalog.json', main), JSON.stringify(active));
for (const file of ['app.js', 'accessibility.js', 'guest-cards.js', 'planning.js', 'region.js', 'styles.css']) {
  await cp(new URL(file, source), new URL(file, main));
}

const html = (await readFile(new URL('index.html', source), 'utf8'))
  .replace(/<a\b[^>]*\bdata-backend-only[^>]*>[^<]*<\/a>/g, '')
  .replace(/<link rel="canonical"[^>]*>/, canonical ? `<link rel="canonical" href="${canonical}">` : '')
  .replace('</head>', '<meta name="catalog-url" content="./catalog.json"></head>');
await writeFile(new URL('index.html', main), html);

// Pages caches files for 10 minutes. Version the prototypes' scripts and styles per deploy,
// so a browser never mixes an old index.html with new scripts (or the other way round).
const version = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 8);
for (const prototype of prototypes) {
  // dist/server/ holds a locally built worker bundle (Reise-Canvas), which a static site cannot run.
  await cp(new URL(prototype + '/dist/', root), new URL(prototype + '/', output), {
    recursive: true,
    filter: source => !/[\\/]dist[\\/]server([\\/]|$)/.test(source)
  });
  const page = new URL(prototype + '/index.html', output);
  let markup = (await readFile(page, 'utf8'))
    .replace(/((?:src|href)=")((?!https?:|\/\/)[^"?#]+\.(?:js|css))"/g, `$1$2?v=${version}"`);
  if (prototype === 'reise-canvas-prototyp') markup = await addStaticWallet(markup);
  await writeFile(page, markup);
}

// The static Reise-Canvas has no worker, so its wallet buttons talk to WalletWallet straight from the browser
// (see reise-canvas-prototyp/docs/wallet.md). For that the browser needs the pass modules and two small images.
async function addStaticWallet(markup) {
  const from = new URL('reise-canvas-prototyp/server/', root);
  const to = new URL('reise-canvas-prototyp/wallet/', output);
  await mkdir(to, { recursive: true });
  for (const name of ['wallet-trip', 'wallet-apple', 'wallet-walletwallet']) {
    await cp(new URL(name + '.mjs', from), new URL(name + '.js', to));
  }
  await cp(new URL('wallet-assets/apple/logo@3x.png', from), new URL('logo.png', to));
  await cp(new URL('wallet-assets/apple/icon@3x.png', from), new URL('icon.png', to));
  return markup.replace('</head>', `<meta name="wallet-direct" content="wallet/" data-version="${version}"></head>`);
}

// The Reise-Canvas is the default app; the Familienzeit planner stays at /familienzeit/.
await writeFile(new URL('index.html', output), `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=./reise-canvas-prototyp/">
<title>Familienzeit · Reise-Canvas</title>
</head>
<body><a href="./reise-canvas-prototyp/">Zum Reise-Canvas</a> · <a href="./familienzeit/">Zum Familienplaner</a></body>
</html>
`);
