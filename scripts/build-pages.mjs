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
// Optional: the ChatGPT-Sites worker that signs wallet passes, e.g. https://familienzeit.example/api/wallet.
// Without it the static edition hides the "Plan mitnehmen" wallet buttons.
const walletUrl = process.env.PAGES_WALLET_URL?.trim() || '';
if (walletUrl && (!URL.canParse(walletUrl) || new URL(walletUrl).protocol !== 'https:')) {
  throw new Error('PAGES_WALLET_URL must be an https URL.');
}
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
  .replace('</head>', '<meta name="catalog-url" content="./catalog.json">' +
    (walletUrl ? `<meta name="wallet-url" content="${walletUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` : '') + '</head>');
await writeFile(new URL('index.html', main), html);

// Pages caches files for 10 minutes. Version the prototypes' scripts and styles per deploy,
// so a browser never mixes an old index.html with new scripts (or the other way round).
const version = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 8);
for (const prototype of prototypes) {
  await cp(new URL(prototype + '/dist/', root), new URL(prototype + '/', output), { recursive: true });
  const page = new URL(prototype + '/index.html', output);
  const markup = await readFile(page, 'utf8');
  await writeFile(page, markup.replace(/((?:src|href)=")((?!https?:|\/\/)[^"?#]+\.(?:js|css))"/g, `$1$2?v=${version}"`));
}

await writeFile(new URL('index.html', output), `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=./familienzeit/">
<title>Familienzeit</title>
</head>
<body><a href="./familienzeit/">Zum Familienplaner</a></body>
</html>
`);
