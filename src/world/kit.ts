import * as THREE from 'three/webgpu';

/**
 * A Poly Haven facade kit. Facts checked by scripts/build-kit.mjs (see src/world/kits/*.json):
 * 3 m bays, 3 m stories, each piece's local x runs from -width to 0 and y from 0 up,
 * and the facade faces +z. So a piece placed at (x, y, 0) covers x-3 .. x.
 */
export class Kit {
  readonly pieces = new Map<string, THREE.Object3D>();

  constructor(scene: THREE.Object3D) {
    for (const child of scene.children) {
      const o = child.clone(true);
      o.position.set(0, 0, 0);
      this.pieces.set(o.name, o);
    }
  }

  place(name: string, parent: THREE.Object3D, x: number, y: number, z: number, rotY = 0) {
    const src = this.pieces.get(name);
    if (!src) throw new Error(`kit piece ${name} not found`);
    const o = src.clone(true);
    o.position.set(x, y, z);
    o.rotation.y = rotY;
    parent.add(o);
    return o;
  }
}

export interface TestFacadeSpec {
  bays: number;     // along the street (x)
  depthBays: number; // into the lot (z)
  stories: number;
}

/**
 * Phase 0 spike: a plain box building dressed with the apartments kit on the front and
 * both sides. Interior slabs and a back wall stop the view through the windows.
 */
export function buildTestFacade(kit: Kit, spec: TestFacadeSpec, inner: THREE.Material, slab: THREE.Material) {
  const g = new THREE.Group();
  g.name = 'test-facade';
  const W = spec.bays * 3, D = spec.depthBays * 3, H = spec.stories * 3;
  for (let s = 0; s < spec.stories; s++) {
    const y = s * 3;
    for (let b = 0; b < spec.bays; b++) {
      const door = s === 0 && b === Math.floor(spec.bays / 2);
      const wall = door ? 'wall_door_centered_large_01' : 'wall_window_centered_large_01';
      const insert = door ? 'door_centered_large_01' : 'window_centered_large_01';
      kit.place(wall, g, (b + 1) * 3, y, 0);
      kit.place(insert, g, (b + 1) * 3, y, 0);
    }
    for (let j = 0; j < spec.depthBays; j++) {
      // Right side faces +x, left side faces -x (see Kit pivot note).
      kit.place('wall_window_centered_large_01', g, W, y, -D + j * 3, Math.PI / 2);
      kit.place('window_centered_large_01', g, W, y, -D + j * 3, Math.PI / 2);
      kit.place('wall_window_centered_large_01', g, 0, y, -j * 3, -Math.PI / 2);
      kit.place('window_centered_large_01', g, 0, y, -j * 3, -Math.PI / 2);
    }
    if (s > 0) for (let b = 0; b < spec.bays; b++) kit.place('cornice_standard_standard_01', g, (b + 1) * 3, y - 0.1, 0);
  }
  for (let b = 0; b < spec.bays; b++) kit.place('crown_standard_standard_01', g, (b + 1) * 3, H, 0);

  // Floor slabs and ceilings seen through the windows, plus a back wall and roof.
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  };
  for (let s = 0; s <= spec.stories; s++) box(W - 0.1, 0.25, D - 0.1, W / 2, s * 3 - 0.125, -D / 2, slab);
  box(W, H, 0.2, W / 2, H / 2, -D + 0.1, inner);
  // Rough room partitions so each window shows a room, not the whole floor.
  for (let b = 1; b < spec.bays; b++) box(0.12, H, D - 0.4, b * 3, H / 2, -D / 2 - 0.1, inner);
  return g;
}
