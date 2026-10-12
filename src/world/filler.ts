import * as THREE from 'three/webgpu';
import { abs, fract, mix, normalWorld, positionWorld, select, step, vec3, materialColor, materialRoughness, materialMetalness } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeometry } from './geometry';
import { rng } from '../sim/rng';

/**
 * The filler city (sky strategy B, DECISIONS.md 5): plain blocks around the street so the
 * horizon reads as a city. Facades use Poly Haven textures with a procedural window grid
 * (3 m bays, 3 m stories) drawn in the shader. One merged mesh per material. Aerial haze
 * comes from the scene fog. These blocks do not shake.
 */
function windowed(src: THREE.MeshStandardNodeMaterial, glass: number) {
  const m = src.clone();
  const n = normalWorld;
  const vertical = abs(n.y).lessThan(0.5);
  const u = select(abs(n.x).greaterThan(0.5), positionWorld.z, positionWorld.x);
  const fu = fract(u.div(3)), fv = fract(positionWorld.y.div(3));
  const win = step(0.22, fu).mul(step(fu, 0.78)).mul(step(0.32, fv)).mul(step(fv, 0.86)).mul(select(vertical, 1, 0));
  const c = new THREE.Color(glass);
  m.colorNode = mix(materialColor, vec3(c.r, c.g, c.b), win);
  m.roughnessNode = mix(materialRoughness, 0.12, win);
  m.metalnessNode = mix(materialMetalness, 0.65, win);
  return m;
}

interface Lot { x0: number; x1: number; z0: number; z1: number; hMin: number; hMax: number; depth: [number, number]; width: [number, number] }

export function buildFiller(mats: THREE.MeshStandardNodeMaterial[], avoid: { x0: number; x1: number; z0: number; z1: number }[]) {
  const r = rng(77);
  const wrapped = mats.map((m, i) => windowed(m, [0x1c252c, 0x22292e, 0x2a3036, 0x1a2228][i % 4]));
  const buckets: THREE.BufferGeometry[][] = wrapped.map(() => []);
  const lots: Lot[] = [
    // The street continues left and right of the five buildings.
    { x0: -150, x1: -21, z0: -18, z1: 0, hMin: 9, hMax: 24, depth: [12, 18], width: [9, 16] },
    { x0: 72, x1: 200, z0: -18, z1: 0, hMin: 9, hMax: 27, depth: [12, 18], width: [9, 16] },
    // Blocks behind the street.
    { x0: -150, x1: 200, z0: -120, z1: -26, hMin: 12, hMax: 48, depth: [14, 24], width: [14, 26] },
    // Across the plaza, and the far city.
    { x0: -150, x1: 200, z0: 46, z1: 120, hMin: 12, hMax: 42, depth: [14, 24], width: [14, 28] },
    { x0: -300, x1: 350, z0: -300, z1: -130, hMin: 18, hMax: 80, depth: [20, 30], width: [20, 34] },
    { x0: -300, x1: 350, z0: 130, z1: 320, hMin: 15, hMax: 70, depth: [20, 30], width: [20, 34] },
  ];
  const hit = (x0: number, x1: number, z0: number, z1: number) => avoid.some(a => x0 < a.x1 && x1 > a.x0 && z0 < a.z1 && z1 > a.z0);
  for (const L of lots) {
    for (let z1 = L.z1; z1 > L.z0;) {
      const d = L.depth[0] + r() * (L.depth[1] - L.depth[0]);
      for (let x0 = L.x0; x0 < L.x1;) {
        const w = Math.round((L.width[0] + r() * (L.width[1] - L.width[0])) / 3) * 3;
        const h = Math.round((L.hMin + r() ** 1.6 * (L.hMax - L.hMin)) / 3) * 3;
        if (!hit(x0, x0 + w, z1 - d, z1) && r() > 0.08) {
          const geo = boxGeometry(w, h, d, 3);
          geo.translate(x0 + w / 2, h / 2, z1 - d / 2);
          buckets[Math.floor(r() * wrapped.length)].push(geo);
        }
        x0 += w + (r() < 0.3 ? 6 + r() * 6 : 0.4);
      }
      z1 -= d + 8 + r() * 6; // a street between rows
    }
  }
  const g = new THREE.Group();
  g.name = 'filler-city';
  let triangles = 0;
  buckets.forEach((geos, i) => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false)!;
    const mesh = new THREE.Mesh(merged, wrapped[i]);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    g.add(mesh);
    triangles += merged.index!.count / 3;
  });
  return { root: g, triangles };
}
