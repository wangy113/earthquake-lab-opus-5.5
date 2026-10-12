import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A box with world-unit UVs (prototype tiledBox): textures keep their real size on any box. */
export function boxGeometry(w: number, h: number, d: number, uvTile = 1.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / uvTile, uv.getY(k) * dims[f][1] / uvTile); }
  return g;
}

export function boxMesh(w: number, h: number, d: number, mat: THREE.Material, uvTile = 1.5) {
  const m = new THREE.Mesh(boxGeometry(w, h, d, uvTile), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Keep only position, normal and uv, indexed, so geometries from any source merge. */
export function cleanGeometry(src: THREE.BufferGeometry) {
  let g = src.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) g = g.toNonIndexed(), g.setIndex([...Array(g.attributes.position.count).keys()]);
  return g;
}

/**
 * A Poly Haven model scaled to a known real height (some files carry a unit scale, such as
 * steel_frame_shelves_01 at 10x), sitting on y = 0 and centered in x and z.
 */
export function fitModel(src: THREE.Object3D, height?: number) {
  const o = src.clone(true);
  let box = new THREE.Box3().setFromObject(o);
  const size = box.getSize(new THREE.Vector3());
  if (height && Math.abs(height / size.y - 1) > 0.15) { o.scale.multiplyScalar(height / size.y); box = new THREE.Box3().setFromObject(o); }
  const c = box.getCenter(new THREE.Vector3());
  o.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  const g = new THREE.Group();
  g.add(o);
  return g;
}

/**
 * Simplify an indexed geometry with meshoptimizer, to an absolute error in meters. UV seams
 * are kept (vertices that share a position but not a UV stay split). Used for the facade LODs.
 */
export function simplifyGeometry(simplifier: typeof import('meshoptimizer').MeshoptSimplifier, geo: THREE.BufferGeometry, errorMeters: number) {
  const pos = geo.attributes.position.array as Float32Array;
  const src = geo.index!.array;
  const indices = src instanceof Uint32Array ? src : new Uint32Array(src);
  const [out] = simplifier.simplify(indices, pos, 3, 0, errorMeters, ['ErrorAbsolute']);
  const g = geo.clone();
  g.setIndex(new THREE.BufferAttribute(out.slice(), 1));
  return g;
}

/**
 * Simplify every mesh under `root` in place (geometries shared by clones are done once).
 * Poly Haven models carry fine bevels that cost triangles but cannot be seen at street
 * distances: a few millimeters of error removes most of them.
 */
export function simplifyModel(simplifier: typeof import('meshoptimizer').MeshoptSimplifier, root: THREE.Object3D, errorMeters: number) {
  const done = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  let before = 0, after = 0;
  root.updateMatrixWorld(true);
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = done.get(m.geometry);
    if (!g) {
      let src = m.geometry;
      if (!src.index) src = cleanGeometry(src);
      // Error is in the mesh's local units: convert from meters with its world scale.
      const s = new THREE.Vector3().setFromMatrixScale(m.matrixWorld);
      const scale = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) || 1;
      g = simplifyGeometry(simplifier, src, errorMeters / scale);
      before += src.index!.count / 3; after += g.index!.count / 3;
      done.set(m.geometry, g);
    }
    m.geometry = g;
  });
  return { before, after };
}

/** Merge everything under `root` into one mesh per material (for static dressing). */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = cleanGeometry(mesh.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const mat = mesh.material as THREE.Material;
    if (!buckets.has(mat)) buckets.set(mat, { geos: [], cast: false });
    const b = buckets.get(mat)!;
    b.geos.push(g);
    b.cast ||= mesh.castShadow;
  });
  const out = new THREE.Group();
  out.name = root.name;
  for (const [mat, { geos, cast }] of buckets) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    out.add(m);
  }
  return out;
}
