import * as THREE from 'three/webgpu';
import { positionLocal, uniform, mix, clamp } from 'three/tsl';

/**
 * "Story skinning" (docs/PLAN.md, rendering layer): every vertex of a story's merged mesh
 * moves by a blend of the floor below's offset and the floor above's offset, by its height
 * in the story. The walls shear with the story instead of sliding as a rigid block, and the
 * CPU only updates two vectors per story each frame.
 *
 * The mesh must be built in story-local coordinates: y = 0 at the story's floor, no rotation.
 */
export interface StoryUniforms {
  bottom: THREE.UniformNode<THREE.Vector3>;
  top: THREE.UniformNode<THREE.Vector3>;
}

export function storyUniforms(): StoryUniforms {
  return { bottom: uniform(new THREE.Vector3()), top: uniform(new THREE.Vector3()) };
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
