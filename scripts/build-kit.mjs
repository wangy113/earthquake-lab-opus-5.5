// Catalogs the Poly Haven facade kits into src/world/kits/<id>.json.
// For each piece it records its role, size, local bounds (which give the pivot),
// triangle count and materials, and pairs every wall panel with its window or door insert.
// Reads the downloaded .gltf JSON directly, so it needs no 3D library.
// Later phases extend this script (solidify walls, LODs, shadow proxies).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KITS = ['modular_urban_apartments_facade', 'modular_factory_facade'];
const ROLES = ['wall', 'window', 'door', 'base', 'dado', 'crown', 'cornice'];
const round = v => Math.round(v * 1000) / 1000;

function roleOf(name) {
  const head = name.split('_')[0].replace(/\d+$/, '');
  return ROLES.includes(head) ? head : 'other';
}

for (const id of KITS) {
  const path = join(ROOT, 'public/assets/polyhaven/models', id, `${id}.gltf`);
  const g = JSON.parse(await readFile(path, 'utf8'));
  const pieces = {};
  for (const node of g.nodes) {
    if (node.mesh === undefined) continue;
    const mesh = g.meshes[node.mesh];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    const materials = new Set();
    for (const p of mesh.primitives) {
      const a = g.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]); }
      tris += p.indices !== undefined ? g.accessors[p.indices].count / 3 : a.count / 3;
      if (p.material !== undefined) materials.add(g.materials[p.material].name.replace(`${id}_`, ''));
    }
    if (node.rotation || node.scale) console.warn(`${id}/${node.name}: node has rotation or scale, pivot may differ`);
    pieces[node.name] = {
      role: roleOf(node.name),
      size: max.map((v, i) => round(v - min[i])),
      min: min.map(round),
      max: max.map(round),
      tris,
      materials: [...materials],
    };
  }
  // Pair wall panels with inserts: wall_window_centered_large_01 -> window_centered_large_01.
  for (const [name, p] of Object.entries(pieces)) {
    if (p.role !== 'wall') continue;
    const insert = name.replace(/^wall_/, '');
    if (pieces[insert] && pieces[insert].role !== 'wall') {
      p.insert = insert;
      p.opening = { min: pieces[insert].min, max: pieces[insert].max };
    }
  }
  const walls = Object.values(pieces).filter(p => p.role === 'wall');
  const flat = walls.filter(p => p.size[2] < 0.01).length;
  const summary = {
    id,
    page: `https://polyhaven.com/a/${id}`,
    pieceCount: Object.keys(pieces).length,
    byRole: Object.fromEntries(ROLES.concat('other').map(r => [r, Object.values(pieces).filter(p => p.role === r).length])),
    gridMeters: 3,
    storyHeightMeters: 3,
    notes: [
      'Pivot: local x runs from -width to 0 and y from 0 up, so the pivot is the bottom-right corner seen from outside. The facade faces +z.',
      `${flat} of ${walls.length} wall panels are single planes with no thickness and need solidifying before they can break apart.`,
    ],
    pieces,
  };
  await mkdir(join(ROOT, 'src/world/kits'), { recursive: true });
  await writeFile(join(ROOT, 'src/world/kits', `${id}.json`), JSON.stringify(summary, null, 1));
  console.log(`${id}: ${summary.pieceCount} pieces`, summary.byRole, `| ${flat}/${walls.length} flat walls`);
}
