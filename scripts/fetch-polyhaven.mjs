// Downloads the pinned Poly Haven assets in assets.config.json into public/assets/polyhaven
// and writes public/assets/polyhaven/manifest.json. Every file is checked against the md5
// the API reports. Already downloaded files with a matching md5 are skipped.
// Poly Haven API terms ask callers to name their app in the User-Agent.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets/polyhaven');
const UA = 'QuakeStreet/0.1 (educational earthquake lab; build-time asset fetch)';
const API = 'https://api.polyhaven.com';
const TEXTURE_MAPS = { diff: ['Diffuse', 'diff'], nor: ['nor_gl'], arm: ['arm'], disp: ['Displacement', 'disp'] };

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const config = JSON.parse(await readFile(join(ROOT, 'assets.config.json'), 'utf8'));

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const md5 = buf => createHash('md5').update(buf).digest('hex');

async function download(file, dest) {
  try {
    const s = await stat(dest);
    if (s.size === file.size && md5(await readFile(dest)) === file.md5) return 'cached';
  } catch { /* not downloaded yet */ }
  const r = await fetch(file.url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${file.url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (file.md5 && md5(buf) !== file.md5) throw new Error(`md5 mismatch for ${file.url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return 'downloaded';
}

const rel = p => relative(join(ROOT, 'public'), p).split('\\').join('/');
const manifest = { generated: new Date().toISOString(), source: 'https://polyhaven.com (CC0)', hdris: {}, textures: {}, models: {} };
let bytes = 0;

async function fetchHdri({ id, res, role }) {
  const f = await getJson(`${API}/files/${id}`);
  const file = f.hdri?.[res]?.hdr;
  if (!file) throw new Error(`${id}: no ${res} hdr`);
  const dest = join(OUT, 'hdris', `${id}_${res}.hdr`);
  const how = await download(file, dest);
  bytes += file.size;
  manifest.hdris[id] = { role, res, url: rel(dest), page: `https://polyhaven.com/a/${id}` };
  return how;
}

async function fetchTexture({ id, res, role }) {
  const f = await getJson(`${API}/files/${id}`);
  const entry = { role, res, page: `https://polyhaven.com/a/${id}`, maps: {} };
  let how = 'cached';
  for (const [name, keys] of Object.entries(TEXTURE_MAPS)) {
    const key = keys.find(k => f[k]?.[res]?.jpg);
    if (!key) { if (name !== 'disp') throw new Error(`${id}: missing ${name}`); continue; }
    const file = f[key][res].jpg;
    const dest = join(OUT, 'textures', id, `${id}_${name}_${res}.jpg`);
    if ((await download(file, dest)) === 'downloaded') how = 'downloaded';
    bytes += file.size;
    entry.maps[name] = rel(dest);
  }
  manifest.textures[id] = entry;
  return how;
}

async function fetchModel({ id, res, role }) {
  const f = await getJson(`${API}/files/${id}`);
  const g = f.gltf?.[res]?.gltf;
  if (!g) throw new Error(`${id}: no ${res} gltf`);
  const dir = join(OUT, 'models', id);
  let how = await download(g, join(dir, `${id}.gltf`));
  bytes += g.size;
  // The .gltf references its .bin and textures by relative path, so keep the include layout.
  for (const [path, file] of Object.entries(g.include ?? {})) {
    if ((await download(file, join(dir, path))) === 'downloaded') how = 'downloaded';
    bytes += file.size;
  }
  manifest.models[id] = { role, res, url: rel(join(dir, `${id}.gltf`)), page: `https://polyhaven.com/a/${id}` };
  return how;
}

const jobs = [
  ...config.hdris.map(a => ['hdri', a, fetchHdri]),
  ...config.textures.map(a => ['texture', a, fetchTexture]),
  ...config.models.map(a => ['model', a, fetchModel]),
].filter(([, a]) => !only || a.id === only);

for (const [kind, asset, fn] of jobs) {
  const how = await fn(asset);
  console.log(`${how.padEnd(10)} ${kind.padEnd(8)} ${asset.id}`);
}
await mkdir(OUT, { recursive: true });
if (!only) await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`total ${(bytes / 1e6).toFixed(1)} MB`);
