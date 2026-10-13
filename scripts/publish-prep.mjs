// Builds the app for publishing as a claude.ai artifact (a multi-file page) into <out>.
// The artifact host wraps the page in its own document skeleton, so index.html loses its
// doctype, html, head and body tags. Usage: node scripts/publish-prep.mjs <outDir>
// Writes <out>/files-*.json: batches of published paths under 60 MB and 250 files each.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/publish-prep.mjs <outDir>');
execSync(`npx vite build --base ./ --outDir ${out} --emptyOutDir`, { stdio: 'inherit' });

let html = readFileSync(join(out, 'index.html'), 'utf8');
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<html[^>]*>|<\/html>|<head>|<\/head>|<body>|<\/body>/gi, '')
  .replace(/<meta charset="UTF-8" \/>|<meta name="viewport"[^>]*>/gi, '')
  // A deliberately dark, single-theme app: tell the host so form controls follow.
  .replace('<style>', '<style>\n  :root { color-scheme: dark; }');
writeFileSync(join(out, 'index.html'), html.trim() + '\n');

// The host serves only standard web types: binaries become base64 text, glTF becomes .json.
// The app reads them back when the manifest says `packed` (src/world/assets.ts).
const all = [];
const walkAll = d => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walkAll(p) : all.push(p); } };
walkAll(join(out, 'assets'));
for (const p of all) {
  if (/\.(hdr|bin)$/.test(p)) { writeFileSync(`${p}.b64.txt`, readFileSync(p).toString('base64')); unlinkSync(p); }
  else if (p.endsWith('.gltf')) renameSync(p, `${p}.json`);
}
const mPath = join(out, 'assets/polyhaven/manifest.json');
const manifest = JSON.parse(readFileSync(mPath, 'utf8'));
manifest.packed = true;
// Assets the page never loads stay out of the upload.
delete manifest.hdris.wide_street_01;
writeFileSync(mPath, JSON.stringify(manifest));

const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(out);
const unused = [/wide_street_01/, /_disp_1k\.jpg$/, /cracked_concrete_wall/];
const pub = files.map(p => relative(out, p)).filter(p => p !== 'index.html' && !p.startsWith('files-') && !unused.some(u => u.test(p)));
const batches = [[]];
let size = 0;
for (const p of pub.sort((a, b) => (a.includes('/models/') - b.includes('/models/')) || a.localeCompare(b))) {
  const s = statSync(join(out, p)).size;
  if (size + s > 60e6 || batches.at(-1).length >= 250) { batches.push([]); size = 0; }
  if (s > 15.5e6) throw new Error(`${p} is over the 16 MB file limit`);
  batches.at(-1).push(p);
  size += s;
}
batches.forEach((b, i) => writeFileSync(join(out, `files-${i}.json`), JSON.stringify(b)));
console.log(`${pub.length} files in ${batches.length} batches:`, batches.map(b => b.length).join(', '));
