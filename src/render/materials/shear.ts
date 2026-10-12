import * as THREE from 'three/webgpu';
import { positionLocal, uniform, uniformArray, attribute, mix, clamp } from 'three/tsl';

/**
 * "Story skinning" (docs/PLAN.md, rendering layer): every vertex of a story's merged mesh
 * moves by a blend of the floor below's offset and the floor above's offset, by its height
 * in the story. The walls shear with the story instead of sliding as a rigid block, and the
 * CPU only updates two vectors per story each frame.
 *
 * The mesh must be built in story-local coordinates: y = 0 at the story's floor, no rotation.
 */
const vec3Uniform = () => uniform(new THREE.Vector3());
export interface StoryUniforms {
  bottom: ReturnType<typeof vec3Uniform>;
  top: ReturnType<typeof vec3Uniform>;
}

export function storyUniforms(): StoryUniforms {
  return { bottom: vec3Uniform(), top: vec3Uniform() };
}

const COPY_KEYS = [
  'name', 'color', 'map', 'normalMap', 'normalScale', 'roughness', 'metalness', 'roughnessMap', 'metalnessMap',
  'aoMap', 'aoMapIntensity', 'emissive', 'emissiveMap', 'emissiveIntensity', 'alphaMap', 'transparent', 'opacity',
  'side', 'alphaTest', 'depthWrite', 'envMapIntensity', 'vertexColors',
] as const;

/** A node-material copy of a standard material (GLTF materials load as plain MeshStandardMaterial). */
export function toNodeMaterial(src: THREE.Material): THREE.MeshStandardNodeMaterial {
  const out = new THREE.MeshStandardNodeMaterial();
  const s = src as unknown as Record<string, unknown>, o = out as unknown as Record<string, unknown>;
  for (const k of COPY_KEYS) if (s[k] !== undefined) o[k] = s[k];
  return out;
}

export function shearMaterial(src: THREE.Material, u: StoryUniforms, storyHeight: number) {
  const m = toNodeMaterial(src);
  const t = clamp(positionLocal.y.div(storyHeight), 0, 1);
  m.positionNode = positionLocal.add(mix(u.bottom, u.top, t));
  return m;
}

/**
 * Whole-building version: one mesh per material for the entire building. Each vertex carries
 * its story index (attribute `storyIndex`, 0 for story 1) and blends between floor offsets
 * `offsets[i]` and `offsets[i + 1]`. offsets[0] is the ground. Geometry is in building-local
 * coordinates with y = 0 at street level.
 */
export function floorOffsets(stories: number) {
  return uniformArray(Array.from({ length: stories + 1 }, () => new THREE.Vector3()), 'vec3');
}
export type FloorOffsets = ReturnType<typeof floorOffsets>;

export function buildingShearMaterial(src: THREE.Material, offsets: FloorOffsets, storyHeight: number) {
  const m = toNodeMaterial(src);
  const idx = attribute('storyIndex', 'float');
  const i = idx.toInt();
  const t = clamp(positionLocal.y.sub(idx.mul(storyHeight)).div(storyHeight), 0, 1);
  // The typings for uniformArray elements are generic, so cast to a vec3 node.
  type V3 = ReturnType<typeof positionLocal.add>;
  const el = (k: unknown) => (offsets as unknown as { element(k: unknown): V3 }).element(k);
  m.positionNode = positionLocal.add(mix(el(i), el(i.add(1)), t));
  return m;
}
