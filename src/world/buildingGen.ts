import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit } from './kit';
import { boxGeometry, cleanGeometry, fitModel, simplifyGeometry } from './geometry';
import { PROP_SIZES, SLAB_T, STORY_H } from '../sim/building/softStory';
import type { StreetBuilding } from '../sim/street';
import { materialColor, mix, vec3, luminance } from 'three/tsl';
import { buildingShearMaterial, floorOffsets, type FloorOffsets } from '../render/materials/shear';

/**
 * Visuals for the four neighbors (docs/PLAN.md, "Buildings from the kits"). Each building is
 * drawn as one mesh per material for the whole building, so a 12-story block costs about as
 * many draw calls as a 2-story one. Every vertex carries its story index and the vertex
 * shader shears it between the floor offsets below and above it (render/materials/shear.ts).
 *
 * Stories are built once per kind (ground, typical, top) in story-local space and repeated.
 * With shadow proxies on, the detailed facade only receives shadows. One plain box per story,
 * drawn invisibly, casts them. That removes most of the shadow-map cost (DECISIONS.md 4).
 */
export interface GenContext {
  apt: Kit;
  brick: Kit;
  mats: { plaster: THREE.Material; slab: THREE.Material; concrete: THREE.Material; metal: THREE.Material; brick: THREE.Material };
  models: Map<string, THREE.Object3D>;
  shadowProxies: boolean;
  /** Facade LODs: simplification error in meters near and far, and where far starts. */
  lod?: { simplifier: typeof import('meshoptimizer').MeshoptSimplifier; near: number; far: number; farFrom: number };
}

export interface BuildingVisual {
  spec: StreetBuilding;
  root: THREE.Group;
  offsets: FloorOffsets;
  triangles: number;
  meshes: number;
}

type Template = Map<THREE.Material, THREE.BufferGeometry>;

const H = STORY_H - SLAB_T; // clear height inside a story

function addBox(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, uvTile = 1.5) {
  const m = new THREE.Mesh(boxGeometry(w, h, d, uvTile), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/** Merge everything under `g` (story-local) into one geometry per material. */
function toTemplate(g: THREE.Object3D): Template {
  g.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  g.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = cleanGeometry(mesh.geometry);
    geo.applyMatrix4(mesh.matrixWorld);
    const mat = mesh.material as THREE.Material;
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat)!.push(geo);
  });
  const out: Template = new Map();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) throw new Error(`could not merge ${mat.name}`);
    out.set(mat, merged);
  }
  return out;
}

/** Back wall, room partitions behind the front windows, corridor wall and the slab above. */
function rooms(g: THREE.Object3D, b: StreetBuilding, ctx: GenContext, opts: { partitions?: boolean; floor?: boolean } = {}) {
  const { W, D, bays } = b;
  const { plaster, slab } = ctx.mats;
  addBox(g, W - 0.3, H, 0.2, W / 2, H / 2, -D + 0.15, plaster, 2);
  if (opts.partitions !== false) {
    for (let i = 1; i < bays; i++) addBox(g, 0.12, H, 3.6, i * 3, H / 2, -2.0, plaster, 2);
    addBox(g, W - 0.4, H, 0.12, W / 2, H / 2, -3.8, plaster, 2);
  }
  addBox(g, W - 0.1, SLAB_T, D - 0.1, W / 2, STORY_H - SLAB_T / 2, -D / 2, slab, 3);
  if (opts.floor) addBox(g, W - 0.1, 0.05, D - 0.1, W / 2, 0.025, -D / 2, slab, 3);
}

/** A static piece of furniture: fitted to its real size and placed in story-local space. */
function furnish(g: THREE.Object3D, ctx: GenContext, id: string, x: number, z: number, rotY = 0) {
  const src = ctx.models.get(id);
  if (!src) return;
  const o = fitModel(src, PROP_SIZES[id]?.[1]);
  o.position.set(x, 0.05, z);
  o.rotation.y = rotY;
  g.add(o);
}

// Kit facade helpers. Front faces +z at z = 0. Right side faces +x at x = W. Left side faces -x.
const front = (kit: Kit, g: THREE.Object3D, bay: number, wall: string, insert?: string, y = 0) => {
  kit.place(wall, g, (bay + 1) * 3, y, 0);
  if (insert) kit.place(insert, g, (bay + 1) * 3, y, 0);
};
const right = (kit: Kit, g: THREE.Object3D, b: StreetBuilding, j: number, wall: string, insert?: string) => {
  kit.place(wall, g, b.W, 0, -b.D + j * 3, Math.PI / 2);
  if (insert) kit.place(insert, g, b.W, 0, -b.D + j * 3, Math.PI / 2);
};
const left = (kit: Kit, g: THREE.Object3D, j: number, wall: string, insert?: string) => {
  kit.place(wall, g, 0, 0, -j * 3, -Math.PI / 2);
  if (insert) kit.place(insert, g, 0, 0, -j * 3, -Math.PI / 2);
};

// ---------------------------------------------------------------------------------------
// Building 1: old brick store, two stories, shopfront below, parapet on the roof.
function brickStory(b: StreetBuilding, s: number, ctx: GenContext) {
  const g = new THREE.Group(), k = ctx.brick;
  const top = s === b.stories - 1;
  for (let i = 0; i < b.bays; i++) {
    if (s === 0) {
      if (i === 1) front(k, g, i, 'wall_door_recessed_large_01', 'door_recessed_large_01');
      else front(k, g, i, 'wall_window_tall_large_05', 'window_tall_large_05');
      k.place('cornice02_standard_standard_01', g, (i + 1) * 3, STORY_H - 0.16, 0);
    } else front(k, g, i, 'wall_window_centered_medium_01', 'window_centered_medium_01');
    if (top) k.place('crown_standard_standard_01', g, (i + 1) * 3, STORY_H + 1.0, 0);
  }
  for (let j = 0; j < b.depthBays; j++) {
    right(k, g, b, j, 'wall_window_centered_small_01', 'window_centered_small_01');
    left(k, g, j, 'wall_standard_standard_01');
  }
  if (top) {
    // Unreinforced brick parapet, about a meter tall: the first thing to fall in Phase 4.
    const p = ctx.mats.brick, t = 0.3;
    addBox(g, b.W, 1.0, t, b.W / 2, STORY_H + 0.5, -t / 2, p, 1);
    addBox(g, t, 1.0, b.D - t, t / 2, STORY_H + 0.5, -b.D / 2 - t / 2, p, 1);
    addBox(g, t, 1.0, b.D - t, b.W - t / 2, STORY_H + 0.5, -b.D / 2 - t / 2, p, 1);
    addBox(g, b.W, 1.0, t, b.W / 2, STORY_H + 0.5, -b.D + t / 2, p, 1);
    addBox(g, b.W - 0.4, 0.06, b.D - 0.4, b.W / 2, STORY_H + 0.03, -b.D / 2, ctx.mats.concrete, 3);
  }
  rooms(g, b, ctx, { partitions: s > 0, floor: s === 0 });
  if (s === 0) {
    furnish(g, ctx, 'steel_frame_shelves_01', 2.0, -6.5);
    furnish(g, ctx, 'steel_frame_shelves_01', 3.4, -6.5);
    furnish(g, ctx, 'steel_frame_shelves_01', 8.6, -6.5);
    furnish(g, ctx, 'wooden_crate_01', 9.8, -2.2, 0.4);
    furnish(g, ctx, 'cardboard_box_01', 2.6, -2.0, 0.2);
  }
  return g;
}

// Building 3: mid-rise apartments, lobby on the ground floor.
function midriseStory(b: StreetBuilding, s: number, ctx: GenContext) {
  const g = new THREE.Group(), k = ctx.apt;
  const top = s === b.stories - 1;
  const mid = Math.floor(b.bays / 2);
  for (let i = 0; i < b.bays; i++) {
    if (s === 0) {
      if (i === mid) front(k, g, i, 'wall_door_centered_large_01', 'door_centered_large_01');
      else { front(k, g, i, 'wall_window_centered_large_01', 'window_centered_large_01'); k.place('base_standard_01', g, (i + 1) * 3, 0, 0); }
    } else if (i % 2) front(k, g, i, 'wall_window_centered_double_01', 'window_centered_double_01');
    else front(k, g, i, 'wall_window_centered_large_01', 'window_centered_large_01');
    if (s > 0) k.place('cornice_standard_standard_01', g, (i + 1) * 3, -0.1, 0);
    if (top) k.place('crown_standard_standard_01', g, (i + 1) * 3, STORY_H, 0);
  }
  for (let j = 0; j < b.depthBays; j++) right(k, g, b, j, 'wall_window_centered_small_01', 'window_centered_small_01');
  // The left side stands half a meter from building 2: a plain party wall.
  addBox(g, 0.2, STORY_H, b.D, 0.1, STORY_H / 2, -b.D / 2, ctx.mats.plaster, 2);
  rooms(g, b, ctx, { floor: s === 0 });
  if (s === 1) {
    furnish(g, ctx, 'Sofa_01', 4.5, -2.4, Math.PI);
    furnish(g, ctx, 'potted_plant_02', 2.6, -0.8);
    furnish(g, ctx, 'metal_office_desk', 10.5, -1.4);
    furnish(g, ctx, 'plastic_monobloc_chair_01', 10.4, -2.6, Math.PI);
  }
  if (s === 2) {
    furnish(g, ctx, 'steel_frame_shelves_01', 7.5, -3.4);
    furnish(g, ctx, 'Sofa_01', 13.5, -2.4, Math.PI);
  }
  if (top) addBox(g, b.W - 0.6, 0.08, b.D - 0.6, b.W / 2, STORY_H + 0.04, -b.D / 2, ctx.mats.concrete, 3);
  return g;
}

// Building 4: glass office tower. No Poly Haven curtain wall exists, so this one is procedural
// (Poly Haven metal_plate for frames and spandrels, reflective glass).
let towerMats: { glass: THREE.Material; lobbyGlass: THREE.Material; frame: THREE.Material; spandrel: THREE.Material } | null = null;
function towerMaterials(ctx: GenContext) {
  if (towerMats) return towerMats;
  const glass = new THREE.MeshStandardNodeMaterial({ name: 'tower_glass', color: 0x2b3c48, metalness: 0.92, roughness: 0.05 });
  const lobbyGlass = new THREE.MeshStandardNodeMaterial({ name: 'lobby_glass', color: 0xa9bcc6, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.28, depthWrite: false });
  const frame = (ctx.mats.metal as THREE.MeshStandardNodeMaterial).clone();
  frame.name = 'tower_frame';
  frame.color = new THREE.Color(0xb4bcc2);
  const spandrel = (ctx.mats.metal as THREE.MeshStandardNodeMaterial).clone();
  spandrel.name = 'tower_spandrel';
  spandrel.color = new THREE.Color(0x3d464d);
  return (towerMats = { glass, lobbyGlass, frame, spandrel });
}

function towerStory(b: StreetBuilding, s: number, ctx: GenContext) {
  const g = new THREE.Group();
  const m = towerMaterials(ctx);
  const { W, D } = b;
  const lobby = s === 0, top = s === b.stories - 1;
  const spH = lobby ? 0 : 0.85;
  // Each side: [length, center x, center z, rotation]. Panels run along local x.
  const sides: [number, number, number, number][] = [[W, W / 2, 0, 0], [W, W / 2, -D, Math.PI], [D, W, -D / 2, Math.PI / 2], [D, 0, -D / 2, -Math.PI / 2]];
  for (const [L, cx, cz, rot] of sides) {
    const side = new THREE.Group();
    side.position.set(cx, 0, cz);
    side.rotation.y = rot;
    g.add(side);
    if (spH) addBox(side, L, spH, 0.06, 0, spH / 2, -0.03, m.spandrel, 1.5);
    addBox(side, L, STORY_H - spH, 0.03, 0, spH + (STORY_H - spH) / 2, -0.05, lobby ? m.lobbyGlass : m.glass, 3);
    for (let x = 0; x <= L + 1e-6; x += 1.5) addBox(side, 0.07, STORY_H, 0.16, x - L / 2, STORY_H / 2, 0.02, m.frame, 1);
    addBox(side, L, 0.08, 0.16, 0, spH, 0.02, m.frame, 1);
  }
  addBox(g, W - 0.2, SLAB_T, D - 0.2, W / 2, STORY_H - SLAB_T / 2, -D / 2, ctx.mats.slab, 3);
  if (lobby) {
    addBox(g, W - 0.2, 0.05, D - 0.2, W / 2, 0.025, -D / 2, ctx.mats.slab, 3);
    addBox(g, 7, H, 6, W / 2, H / 2, -D / 2 - 1, ctx.mats.concrete, 3); // elevator core
    furnish(g, ctx, 'metal_office_desk', W / 2, -4.6, Math.PI);
    furnish(g, ctx, 'potted_plant_02', 2.0, -1.4);
    furnish(g, ctx, 'potted_plant_02', W - 2.0, -1.4);
    furnish(g, ctx, 'Sofa_01', 4.2, -5.5);
  } else {
    addBox(g, 7, H, 6, W / 2, H / 2, -D / 2 - 1, ctx.mats.concrete, 3);
  }
  if (top) {
    addBox(g, W, 1.2, 0.2, W / 2, STORY_H + 0.6, -0.1, m.spandrel, 1.5);
    addBox(g, W, 1.2, 0.2, W / 2, STORY_H + 0.6, -D + 0.1, m.spandrel, 1.5);
    addBox(g, 0.2, 1.2, D, 0.1, STORY_H + 0.6, -D / 2, m.spandrel, 1.5);
    addBox(g, 0.2, 1.2, D, W - 0.1, STORY_H + 0.6, -D / 2, m.spandrel, 1.5);
    addBox(g, 8, 3.2, 6, W / 2, STORY_H + 1.6, -D / 2 - 1, ctx.mats.concrete, 3); // plant room
  }
  return g;
}

// Building 5: fire station. Brick apparatus bays on the ground floor, painted apartments above.
function stationStory(b: StreetBuilding, s: number, ctx: GenContext) {
  const g = new THREE.Group();
  const top = s === b.stories - 1;
  if (s === 0) {
    const k = ctx.brick;
    for (let x = 6; x <= b.W; x += 6) { k.place('wall_door_garage_door_01', g, x, 0, 0); k.place('door_garage_door_01', g, x, 0, 0); }
    for (let i = 0; i < b.bays; i++) k.place('cornice02_standard_standard_01', g, (i + 1) * 3, STORY_H - 0.16, 0);
    for (let j = 0; j < b.depthBays; j++) {
      right(k, g, b, j, 'wall_window_centered_small_01', 'window_centered_small_01');
      left(k, g, j, 'wall_window_centered_small_01', 'window_centered_small_01');
    }
    rooms(g, b, ctx, { partitions: false, floor: true });
    return g;
  }
  const k = ctx.apt;
  for (let i = 0; i < b.bays; i++) {
    front(k, g, i, 'wall_window_centered_large_01', 'window_centered_large_01');
    if (s > 1) k.place('cornice_standard_standard_01', g, (i + 1) * 3, -0.1, 0);
    if (top) k.place('crown_standard_standard_01', g, (i + 1) * 3, STORY_H, 0);
  }
  for (let j = 0; j < b.depthBays; j++) {
    right(k, g, b, j, 'wall_window_centered_large_01', 'window_centered_large_01');
    left(k, g, j, 'wall_window_centered_large_01', 'window_centered_large_01');
  }
  rooms(g, b, ctx);
  if (top) addBox(g, b.W - 0.6, 0.08, b.D - 0.6, b.W / 2, STORY_H + 0.04, -b.D / 2, ctx.mats.concrete, 3);
  return g;
}

const STORY_BUILDERS = { brick: brickStory, midrise: midriseStory, tower: towerStory, station: stationStory } as const;

/** Which stories look the same, so their template is built once. */
function templateKey(b: StreetBuilding, s: number) {
  if (s === 0 || s === b.stories - 1) return `s${s}`;
  if (b.kind === 'midrise' && s <= 2) return `s${s}`; // furnished floors
  if (b.kind === 'station' && s === 1) return 's1';   // no cornice under the first upper floor
  return 'typical';
}

/**
 * Per-building repaint of the kit materials: saturation (1 keeps the texture's own color)
 * and a color multiplied in. Buildings 2 and 3 share the apartments kit and stand side by
 * side, so building 3 is repainted off-white.
 */
const TINTS: Partial<Record<StreetBuilding['kind'], Record<string, { color: number; saturation?: number }>>> = {
  midrise: { plaster: { color: 0xf2efe8, saturation: 0.12 } },
  station: { plaster: { color: 0xc96f55, saturation: 0.5 }, trim_01: { color: 0xf0ece4 } },
};

export function buildBuilding(b: StreetBuilding, ctx: GenContext): BuildingVisual {
  if (b.kind === 'softStory') throw new Error('building 2 uses softStoryVisual');
  const build = STORY_BUILDERS[b.kind];
  const offsets = floorOffsets(b.stories);
  const templates = new Map<string, Template>();
  for (let s = 0; s < b.stories; s++) {
    const key = templateKey(b, s);
    if (!templates.has(key)) templates.set(key, toTemplate(build(b, s, ctx)));
  }
  const tint = TINTS[b.kind] ?? {};
  const materials = new Map<THREE.Material, THREE.MeshStandardNodeMaterial>();
  const wrap = (mat: THREE.Material) => {
    let m = materials.get(mat);
    if (!m) {
      m = buildingShearMaterial(mat, offsets, STORY_H);
      // Kit materials are named <kit>_<part>, such as modular_urban_apartments_facade_plaster.
      const t = Object.entries(tint).find(([part]) => mat.name.endsWith(`_${part}`))?.[1];
      if (t) {
        const c = new THREE.Color(t.color);
        const base = t.saturation === undefined ? materialColor.rgb : mix(vec3(luminance(materialColor.rgb)), materialColor.rgb, t.saturation);
        m.colorNode = base.mul(vec3(c.r, c.g, c.b));
      }
      materials.set(mat, m);
    }
    return m;
  };

  /** All stories as one mesh per material, with each template simplified to `error` meters. */
  const level = (error: number) => {
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const simplified = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    for (let s = 0; s < b.stories; s++) {
      for (const [mat, geo] of templates.get(templateKey(b, s))!) {
        let src = simplified.get(geo);
        if (!src) simplified.set(geo, src = error > 0 && ctx.lod ? simplifyGeometry(ctx.lod.simplifier, geo, error) : geo);
        const g = src.clone();
        g.translate(0, s * STORY_H, 0);
        g.setAttribute('storyIndex', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(s), 1));
        if (!buckets.has(mat)) buckets.set(mat, []);
        buckets.get(mat)!.push(g);
      }
    }
    const group = new THREE.Group();
    let triangles = 0;
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) throw new Error(`could not merge ${b.id} ${mat.name}`);
      const m = wrap(mat);
      const mesh = new THREE.Mesh(merged, m);
      mesh.name = `${b.id}:${mat.name}`;
      mesh.receiveShadow = true;
      mesh.castShadow = !ctx.shadowProxies;
      if (m.transparent) mesh.renderOrder = 1; // lobby glass after the opaque facade
      group.add(mesh);
      triangles += merged.index!.count / 3;
    }
    return { group, triangles };
  };

  const root = new THREE.Group();
  root.name = b.id;
  root.position.set(...b.origin);
  const near = level(ctx.lod?.near ?? 0);
  let triangles = near.triangles;
  if (ctx.lod) {
    // THREE.LOD measures from its own position, so center it on the building.
    const lod = new THREE.LOD();
    const c = new THREE.Vector3(b.W / 2, b.stories * STORY_H / 2, -b.D / 2);
    lod.position.copy(c);
    const far = level(ctx.lod.far);
    for (const lv of [near, far]) lv.group.position.copy(c).negate();
    lod.addLevel(near.group, 0);
    lod.addLevel(far.group, ctx.lod.farFrom + Math.max(b.W, b.stories * STORY_H) / 2);
    root.add(lod);
    triangles = near.triangles;
    (root.userData as { farTriangles?: number }).farTriangles = far.triangles;
  } else root.add(near.group);
  if (ctx.shadowProxies) root.add(shadowProxy(b, offsets));
  return { spec: b, root, offsets, triangles, meshes: materials.size };
}

/** One invisible box per story that casts the building's shadow, sheared like the facade. */
function shadowProxy(b: StreetBuilding, offsets: FloorOffsets) {
  const geos: THREE.BufferGeometry[] = [];
  for (let s = 0; s < b.stories; s++) {
    const top = s === b.stories - 1;
    const h = STORY_H + (top ? (b.kind === 'tower' ? 1.2 : b.kind === 'brick' ? 1.0 : 0.3) : 0);
    const g = cleanGeometry(new THREE.BoxGeometry(b.W - 0.3, h, b.D - 0.3));
    g.translate(b.W / 2, s * STORY_H + h / 2, -b.D / 2);
    g.setAttribute('storyIndex', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(s), 1));
    geos.push(g);
  }
  const m = buildingShearMaterial(new THREE.MeshStandardMaterial(), offsets, STORY_H);
  m.colorWrite = false;
  m.depthWrite = false;
  const mesh = new THREE.Mesh(mergeGeometries(geos, false)!, m);
  mesh.name = `${b.id}:shadow`;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}
