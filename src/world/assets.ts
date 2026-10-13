import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Shape of public/assets/polyhaven/manifest.json, written by scripts/fetch-polyhaven.mjs. */
export interface Manifest {
  hdris: Record<string, { url: string; res: string; role: string; page: string }>;
  textures: Record<string, { maps: { diff: string; nor: string; arm: string; disp?: string }; res: string; role: string; page: string }>;
  models: Record<string, { url: string; res: string; role: string; page: string }>;
  /**
   * Set by scripts/publish-prep.mjs for the published claude.ai copy, whose host serves only
   * standard web file types. Binary files (.hdr, .bin) are stored there as `<name>.b64.txt`
   * and each .gltf as `<name>.gltf.json`.
   */
  packed?: boolean;
}

const base = import.meta.env.BASE_URL;
const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

let packed = false;

export async function loadManifest(): Promise<Manifest> {
  const r = await fetch(`${base}assets/polyhaven/manifest.json`);
  if (!r.ok) throw new Error('Asset manifest missing. Run `npm run assets` first.');
  const m: Manifest = await r.json();
  packed = !!m.packed;
  return m;
}

/**
 * A URL a loader can read a binary asset from: the file itself, or in the packed copy a
 * blob URL decoded from its base64 text file.
 */
export async function binaryUrl(url: string): Promise<string> {
  if (!packed) return url;
  const r = await fetch(`${url}.b64.txt`);
  if (!r.ok) throw new Error(`asset missing: ${url}`);
  const bin = atob(await r.text());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes]));
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
  const url = assetUrl(entry.url);
  let gltf;
  if (packed) {
    // Fetch the JSON ourselves and point its buffers at decoded blobs. Textures stay plain
    // .jpg files next to it, so parse with the model's own folder as the base path.
    const json = await (await fetch(`${url}.json`)).json();
    for (const b of json.buffers ?? []) if (b.uri && !b.uri.startsWith('data:')) b.uri = await binaryUrl(new URL(b.uri, new URL(url, location.href)).href);
    gltf = await gltfLoader.parseAsync(JSON.stringify(json), url.slice(0, url.lastIndexOf('/') + 1));
  } else gltf = await gltfLoader.loadAsync(url);
  gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return gltf.scene;
}
