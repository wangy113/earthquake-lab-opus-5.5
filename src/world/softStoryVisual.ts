import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit } from './kit';
import { SLAB_T, STORY_H, type SoftStoryLayout } from '../sim/building/softStory';
import { shearMaterial, storyUniforms, type StoryUniforms } from '../render/materials/shear';

/**
 * Visuals for the soft-story building, matching the simulation layout in sim/building/softStory.
 *  - Stories 2..N: kit facades merged per material in story-local space, sheared by uniforms.
 *  - Story 1: one object per breakable piece (column, shutter, wall panel), centered on its
 *    collider so it can follow its Rapier body directly.
 *  - Slabs: one box per floor, following the floor bodies.
 */
export interface SoftStoryVisual {
  root: THREE.Group;
  stories: { group: THREE.Group; u: StoryUniforms }[]; // index 0 is story 2
  slabs: Map<string, THREE.Mesh>;                      // 'floor:i'
  pieces: Map<string, THREE.Object3D>;                  // ground-story pieces by sim id
  columnMaterial: THREE.Material;
}

export interface VisualMaterials { plaster: THREE.Material; slab: THREE.Material; column: THREE.Material }

/** Merge every mesh under `src` into one mesh per material, in `src`'s local space. */
function mergeByMaterial(src: THREE.Object3D, wrap: (m: THREE.Material) => THREE.Material) {
  src.updateMatrixWorld(true);
  const inv = src.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) g = g.toNonIndexed(), g.setIndex([...Array(g.attributes.position.count).keys()]);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const mat = mesh.material as THREE.Material;
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat)!.push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) throw new Error(`could not merge geometry for ${mat.name}`);
    const mesh = new THREE.Mesh(merged, wrap(mat));
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

const boxMesh = (w: number, h: number, d: number, mat: THREE.Material, uvTile = 1.5) => {
  const g = new THREE.BoxGeometry(w, h, d);
  // World-unit UVs (prototype tiledBox) so textures keep their real size on any box.
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / uvTile, uv.getY(k) * dims[f][1] / uvTile); }
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
};

export function buildSoftStoryVisual(L: SoftStoryLayout, kit: Kit, shutter: THREE.Object3D, mats: VisualMaterials): SoftStoryVisual {
  const root = new THREE.Group();
  root.name = 'soft-story-building';
  const [ox, , oz] = L.origin;
  const { W, D } = L;

  // Upper stories: kit facade on the front and both sides, plaster back wall and room partitions.
  const stories: SoftStoryVisual['stories'] = [];
  for (let s = 2; s <= L.stories; s++) {
    const tmp = new THREE.Group();
    for (let b = 0; b < L.bays; b++) {
      const door = s === 2 && b === 1; // a balcony door on floor 2 for variety
      kit.place(door ? 'wall_door_window_small_01' : 'wall_window_centered_large_01', tmp, (b + 1) * 3, 0, 0);
      kit.place(door ? 'door_window_small_01' : 'window_centered_large_01', tmp, (b + 1) * 3, 0, 0);
      kit.place('cornice_standard_standard_01', tmp, (b + 1) * 3, -0.1, 0);
      if (s === L.stories) kit.place('crown_standard_standard_01', tmp, (b + 1) * 3, STORY_H, 0);
    }
    for (let j = 0; j < L.depthBays; j++) {
      kit.place('wall_window_centered_large_01', tmp, W, 0, -D + j * 3, Math.PI / 2);
      kit.place('window_centered_large_01', tmp, W, 0, -D + j * 3, Math.PI / 2);
      kit.place('wall_window_centered_large_01', tmp, 0, 0, -j * 3, -Math.PI / 2);
      kit.place('window_centered_large_01', tmp, 0, 0, -j * 3, -Math.PI / 2);
    }
    const inner = (w: number, d: number, x: number, z: number) => {
      const m = boxMesh(w, STORY_H - SLAB_T, d, mats.plaster);
      m.position.set(x, (STORY_H - SLAB_T) / 2, z);
      tmp.add(m);
    };
    inner(W, 0.2, W / 2, -D + 0.1);                                       // back wall
    for (let b = 1; b < L.bays; b++) if (b !== 2) inner(0.12, D - 2.4, b * 3, -D / 2 - 1.1); // partitions
    inner(W - 0.4, 0.12, W / 2, -D + 3.2);                                // corridor wall
    const u = storyUniforms();
    const group = mergeByMaterial(tmp, m => shearMaterial(m, u, STORY_H));
    group.name = `story:${s}`;
    group.position.set(ox, (s - 1) * STORY_H, oz);
    root.add(group);
    stories.push({ group, u });
  }

  // Slabs.
  const slabs = new Map<string, THREE.Mesh>();
  for (let i = 1; i <= L.stories; i++) {
    const m = boxMesh(W, SLAB_T, D, mats.slab, 3);
    m.name = `floor:${i}`;
    m.position.set(ox + W / 2, i * STORY_H - SLAB_T / 2, oz - D / 2);
    root.add(m);
    slabs.set(m.name, m);
  }
  // Roof edge parapet sits on the top slab via the crown pieces; add a simple roof membrane.

  // Ground story pieces, each centered on its collider.
  const pieces = new Map<string, THREE.Object3D>();
  for (const p of L.groundStory) {
    const g = new THREE.Group();
    g.name = p.id;
    const [hx, hy, hz] = p.half;
    if (p.kind === 'column') {
      g.add(boxMesh(hx * 2, hy * 2, hz * 2, mats.column, 1));
    } else if (p.kind === 'shutter') {
      // The Poly Haven shutter is 1.08 m wide: two of them, stretched a little, fill the bay.
      const sx = (hx * 2) / 2.16;
      for (const [i, src] of [shutter.children[0], shutter.children[1]].entries()) {
        const o = src.clone(true);
        o.position.set((-0.54 + i * 1.08) * sx * 2 / 2 - (hx - 0.54 * sx) + 0.54 * sx, -hy, -0.15);
        o.scale.set(sx, (hy * 2) / 2.4, 0.6);
        g.add(o);
      }
    } else if (p.id.startsWith('panel:B')) {
      g.add(boxMesh(hx * 2, hy * 2, hz * 2, mats.plaster, 2));
    } else {
      // Side wall: kit wall panel plus its window, rotated to face out, then centered.
      const right = p.id.startsWith('panel:R');
      const holder = new THREE.Group();
      const inner = boxMesh(hz * 2 - 0.1, hy * 2, 0.2, mats.plaster, 2);
      inner.rotation.y = Math.PI / 2;
      inner.position.set(right ? -0.13 : 0.13, 0, 0);
      g.add(inner);
      kit.place('wall_window_centered_large_01', holder, 0, 0, 0, right ? Math.PI / 2 : -Math.PI / 2);
      kit.place('window_centered_large_01', holder, 0, 0, 0, right ? Math.PI / 2 : -Math.PI / 2);
      // Piece spans z 0..3 (right) or -3..0 (left) from its pivot. Shift to center it on the box.
      holder.position.set(right ? hx : -hx, -hy - (STORY_H - SLAB_T - hy * 2) / 2, right ? -1.5 : 1.5);
      holder.scale.y = (hy * 2 + 0.02) / (STORY_H - SLAB_T);
      g.add(holder);
    }
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; } });
    g.position.set(ox + p.center[0], p.center[1], oz + p.center[2]);
    root.add(g);
    pieces.set(p.id, g);
  }
  return { root, stories, slabs, pieces, columnMaterial: mats.column };
}
