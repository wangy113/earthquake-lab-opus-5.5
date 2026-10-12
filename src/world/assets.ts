import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Shape of public/assets/polyhaven/manifest.json, written by scripts/fetch-polyhaven.mjs. */
export interface Manifest {
  hdris: Record<string, { url: string; res: string; role: string; page: string }>;
  textures: Record<string, { maps: { diff: string; nor: string; arm: string; disp?: string }; res: string; role: string; page: string }>;
  models: Record<string, { url: string; res: string; role: string; page: string }>;
}

const base = import.meta.env.BASE_URL;
const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

export async function loadManifest(): Promise<Manifest> {
  const r = await fetch(`${base}assets/polyhaven/manifest.json`);
  if (!r.ok) throw new Error('Asset manifest missing. Run `npm run assets` first.');
  return r.json();
}

export const assetUrl = (rel: string) => base + rel;

/**
 * A Poly Haven PBR set as a standard material. `tile` is the texture's real-world size in
 * meters, used with world-unit UVs. The ARM map packs AO, roughness and metalness.
 */
export async function pbrMaterial(m: Manifest, id: string, tile = 1, opts: Partial<THREE.MeshStandardNodeMaterial> = {}) {
  const t = m.textures[id];
  if (!t) throw new Error(`texture ${id} not in manifest`);
  const [map, normalMap, arm] = await Promise.all([t.maps.diff, t.maps.nor, t.maps.arm].map(u => texLoader.loadAsync(assetUrl(u))));
  map.colorSpace = THREE.SRGBColorSpace;
  for (const tex of [map, normalMap, arm]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.setScalar(1 / tile);
    tex.anisotropy = 8;
  }
  const mat = new THREE.MeshStandardNodeMaterial({ map, normalMap, aoMap: arm, roughnessMap: arm, metalnessMap: arm, roughness: 1, metalness: 1 });
  Object.assign(mat, opts);
  return mat;
}

export async function loadModel(m: Manifest, id: string) {
  const entry = m.models[id];
  if (!entry) throw new Error(`model ${id} not in manifest`);
  const gltf = await gltfLoader.loadAsync(assetUrl(entry.url));
  gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return gltf.scene;
}
