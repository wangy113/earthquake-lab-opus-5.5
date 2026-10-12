import * as THREE from 'three/webgpu';
import { boxGeometry } from './geometry';
import { CURB_H, PLAZA, ROAD, SIDEWALK, type StreetBuilding } from '../sim/street';

/**
 * The street around the buildings: sidewalk, road, curbs, plaza, markings, street furniture,
 * power poles and their cables. Everything here is fixed to the ground, so it goes in the
 * group that moves with the ground body.
 */
export interface StreetMaterials {
  sidewalk: THREE.Material; road: THREE.Material; plaza: THREE.Material; curb: THREE.Material; metal: THREE.Material;
}

const X0 = -320, X1 = 320;

function plane(g: THREE.Object3D, x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material) {
  const w = x1 - x0, d = z1 - z0;
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  // World-unit UVs: the material's repeat sets the texture's real size.
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + (x0 + x1) / 2, -(pos.getZ(i) + (z0 + z1) / 2));
  const m = new THREE.Mesh(geo, mat);
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, uvTile = 1, cast = false) {
  const m = new THREE.Mesh(boxGeometry(w, h, d, uvTile), mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.castShadow = cast;
  g.add(m);
  return m;
}

/** Clone the children of a Poly Haven model whose names pass `keep`, re-centered on x and z. */
export function pick(src: THREE.Object3D, keep: (name: string) => boolean) {
  const g = new THREE.Group();
  for (const c of src.children) if (keep(c.name)) g.add(c.clone(true));
  const b = new THREE.Box3().setFromObject(g), c = b.getCenter(new THREE.Vector3());
  for (const o of g.children) o.position.sub(new THREE.Vector3(c.x, b.min.y, c.z));
  const out = new THREE.Group();
  out.add(g);
  return out;
}

function place(parent: THREE.Object3D, src: THREE.Object3D, x: number, y: number, z: number, rotY = 0) {
  const o = src.clone(true);
  o.position.set(x, y, z);
  o.rotation.y = rotY;
  parent.add(o);
  return o;
}

export interface StreetModels {
  lamp1: THREE.Object3D; lamp2: THREE.Object3D; hydrant: THREE.Object3D; trash: THREE.Object3D;
  utility: THREE.Object3D; manhole: THREE.Object3D; poles: THREE.Object3D; bench: THREE.Object3D;
  planter1: THREE.Object3D; planter2: THREE.Object3D;
}

export function buildStreet(mats: StreetMaterials, models: StreetModels, buildings: StreetBuilding[]) {
  const g = new THREE.Group();
  g.name = 'street';
  // Surfaces. Sidewalk and plaza are at y 0, the road one curb lower.
  plane(g, X0, X1, -320, SIDEWALK.z1, 0, mats.sidewalk);
  plane(g, X0, X1, ROAD.z0, ROAD.z1, -CURB_H, mats.road);
  plane(g, X0, X1, PLAZA.z0 + 0.3, PLAZA.z1, 0, mats.plaza);
  plane(g, X0, X1, PLAZA.z1, 320, 0, mats.sidewalk);
  // Curbs: granite-like concrete, 30 cm wide, along both road edges.
  box(g, X1 - X0, CURB_H + 0.02, 0.3, 0, -CURB_H / 2 + 0.01, SIDEWALK.z1 - 0.15, mats.curb, 1);
  box(g, X1 - X0, CURB_H + 0.02, 0.3, 0, -CURB_H / 2 + 0.01, PLAZA.z0 + 0.15, mats.curb, 1);

  // Road markings.
  const paint = new THREE.MeshStandardNodeMaterial({ name: 'road_paint', color: 0xd9d6cc, roughness: 0.75 });
  const yM = -CURB_H + 0.004;
  const mid = (ROAD.z0 + ROAD.z1) / 2;
  for (let x = X0; x < X1; x += 9) box(g, 4.5, 0.004, 0.13, x, yM, mid, paint);
  box(g, X1 - X0, 0.004, 0.12, 0, yM, ROAD.z0 + 0.5, paint);
  box(g, X1 - X0, 0.004, 0.12, 0, yM, ROAD.z1 - 0.5, paint);
  for (let i = 0; i < 8; i++) box(g, 0.5, 0.005, ROAD.z1 - ROAD.z0 - 1.6, 28 + i * 1.0, yM + 0.001, mid, paint); // crosswalk

  // Street furniture. Lamps along both curbs, arms over the road.
  for (const x of [-26, -1.2, 13.2, 30, 52, 76]) place(g, models.lamp1, x, 0, SIDEWALK.z1 - 0.8, Math.PI);
  for (const x of [6, 24, 46, 68]) place(g, models.lamp2, x, 0, PLAZA.z0 + 0.7, Math.PI);
  place(g, models.hydrant, 14.8, 0, 3.3, -0.4);
  place(g, models.hydrant, 53.4, 0, 3.4, 0.3);
  for (const [x, z] of [[-3.1, 3.4], [30.6, 3.5], [20, 13.2], [58, 13.3]]) place(g, models.trash, x, 0, z, x * 0.3);
  place(g, models.utility, -2.6, 0, 0.5, 0);
  place(g, models.utility, 51.5, 0, 0.6, 0.02);
  for (const [x, z] of [[8, 7.2], [38, 9.4], [61, 7.4]]) place(g, models.manhole, x, -CURB_H, z, x);

  // Plaza seating and planters, kept away from the eye-level camera spot.
  for (const x of [10, 16, 34, 40]) place(g, models.bench, x, 0, 17.5, 0);
  for (const x of [7.5, 13.0, 18.5, 31.5, 37.0, 42.5]) place(g, models.planter2, x, 0, 19.5, 0);
  for (const x of [-4, 52]) for (let i = 0; i < 3; i++) place(g, models.planter1, x + i * 1.1, 0, 14, 0);

  // Power poles along the plaza curb, with three sagging cables between neighbors.
  const poleXs = [-34, -4, 26, 56, 86];
  const pole = models.poles;
  const poleBox = new THREE.Box3().setFromObject(pole);
  for (const x of poleXs) place(g, pole, x, 0, PLAZA.z0 + 0.45, Math.PI / 2);
  const cable = new THREE.MeshStandardNodeMaterial({ name: 'cable', color: 0x15171a, roughness: 0.55, metalness: 0.2 });
  const topY = poleBox.max.y - 0.25;
  for (let i = 0; i + 1 < poleXs.length; i++) {
    for (const [dz, dy] of [[-0.45, 0], [0, 0.12], [0.45, 0]] as const) {
      const a = new THREE.Vector3(poleXs[i], topY + dy, PLAZA.z0 + 0.45 + dz);
      const b = new THREE.Vector3(poleXs[i + 1], topY + dy, PLAZA.z0 + 0.45 + dz);
      const pts = Array.from({ length: 13 }, (_, k) => {
        const t = k / 12;
        const p = a.clone().lerp(b, t);
        p.y -= 0.7 * 4 * t * (1 - t); // sag
        return p;
      });
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 4), cable);
      m.castShadow = true;
      g.add(m);
    }
  }

  // Fire station seismic moat: a 40 cm gap around the building under steel cover plates.
  const st = buildings.find(b => b.kind === 'station');
  if (st) {
    const plate = (mats.metal as THREE.MeshStandardNodeMaterial).clone();
    plate.color = new THREE.Color(0x6c7277);
    const [x0, , z0] = st.origin, w = 0.45, y = 0.006;
    box(g, st.W + 2 * w, 0.012, w, x0 + st.W / 2, y, z0 + w / 2, plate, 1);
    box(g, st.W + 2 * w, 0.012, w, x0 + st.W / 2, y, z0 - st.D - w / 2, plate, 1);
    box(g, w, 0.012, st.D, x0 - w / 2, y, z0 - st.D / 2, plate, 1);
    box(g, w, 0.012, st.D, x0 + st.W + w / 2, y, z0 - st.D / 2, plate, 1);
  }
  return g;
}
