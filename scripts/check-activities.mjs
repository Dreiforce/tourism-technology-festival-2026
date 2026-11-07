// Live check for the activity catalogues: does each source page still respond, and is the
// activity still on offer (an opening window today or later)? Exits with 1 when something is off.
// Usage: node scripts/check-activities.mjs [--stamp]
// --stamp writes today's date as `checked` into the Reise-Canvas catalogue for activities that pass.
import { readFile, writeFile } from 'node:fs/promises';

const catalogs = ['reise-canvas-prototyp/dist/catalog.json', 'familienzeit/static/catalog.json'];
const today = new Date().toISOString().slice(0, 10);
const root = new URL('../', import.meta.url);

async function status(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const response = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'familienzeit-activity-check' } });
      if (response.ok || method === 'GET') return response.status;
    } catch (error) {
      if (method === 'GET') return error.name === 'TimeoutError' ? 'timeout' : 'unreachable';
    }
  }
}
const stillOffered = activity => activity.hours.some(rule => !rule.to || rule.to >= today);

const urls = new Map();
const report = [];
const loaded = new Map();
for (const file of catalogs) {
  const catalog = JSON.parse(await readFile(new URL(file, root), 'utf8'));
  loaded.set(file, catalog);
  for (const activity of catalog) {
    if (activity.active === false) continue;
    for (const url of activity.sources || []) urls.set(url, null);
    report.push({ file, activity });
  }
}
const urlList = [...urls.keys()];
for (let i = 0; i < urlList.length; i += 8) {
  await Promise.all(urlList.slice(i, i + 8).map(async url => urls.set(url, await status(url))));
}
let problems = 0;
for (const { file, activity } of report) {
  const broken = (activity.sources || []).filter(url => urls.get(url) !== 200);
  const expired = !stillOffered(activity);
  if (!broken.length && !expired) {
    if (file === catalogs[0]) activity.checked = today;
    continue;
  }
  problems++;
  console.log(`${file}: ${activity.title}`);
  if (expired) console.log('  no opening window today or later');
  for (const url of broken) console.log(`  ${urls.get(url)} ${url}`);
}
console.log(`${report.length} activities, ${urls.size} source pages checked, ${problems} with problems.`);
if (process.argv.includes('--stamp')) {
  const catalog = loaded.get(catalogs[0]);
  await writeFile(new URL(catalogs[0], root), '[\n' + catalog.map(entry => '  ' + JSON.stringify(entry)).join(',\n') + '\n]\n');
  console.log(`Stamped ${catalog.filter(entry => entry.checked === today).length} activities in ${catalogs[0]}.`);
}
process.exitCode = problems ? 1 : 0;
