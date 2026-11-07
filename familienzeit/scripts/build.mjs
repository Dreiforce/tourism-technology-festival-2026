import {mkdir, readFile, writeFile} from 'node:fs/promises';

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
const worker = await readFile(new URL('../server/worker.mjs', import.meta.url), 'utf8');
const output = new URL('../dist/server/', import.meta.url);
await mkdir(output, {recursive:true});
await writeFile(new URL('index.js',output),
  `const assets = ${JSON.stringify(assets)};\nconst initialCatalog = ${JSON.stringify(catalog)};\n${shared}\n${worker}`);
