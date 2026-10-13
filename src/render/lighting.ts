import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { binaryUrl } from '../world/assets';

// Half float, not float: 32-bit float textures cannot be filtered on devices without
// OES_texture_float_linear (and headless SwiftShader), which turned every lit surface black.
const hdrLoader = new HDRLoader().setDataType(THREE.HalfFloatType);

export async function loadHdri(url: string): Promise<THREE.DataTexture> {
  const tex = await hdrLoader.loadAsync(await binaryUrl(url));
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/**
 * Finds the brightest spot in the upper part of an equirect HDRI and returns the direction
 * to it. Ported from the prototype's placeSun(). Elevation is clamped so shadows stay readable.
 */
export function sunDirection(tex: THREE.DataTexture, minElevation = 0.35): THREE.Vector3 {
  const { data, width: W, height: H } = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = data instanceof Uint16Array;
  const v = (i: number) => half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i];
  let best = -1, bx = 0, by = 0;
  for (let y = 1; y < H * 0.5; y += 1) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4;
    const l = 0.2126 * v(i) + 0.7152 * v(i + 1) + 0.0722 * v(i + 2);
    if (l > best) { best = l; bx = x; by = y; }
  }
  const ang = (bx / W - 0.5) * Math.PI * 2;
  const lat = Math.max((0.5 - by / H) * Math.PI, minElevation);
  return new THREE.Vector3(Math.cos(ang) * Math.cos(lat), Math.sin(lat), Math.sin(ang) * Math.cos(lat)).normalize();
}

/** Strategy A: the HDRI itself is the backdrop, projected onto a dome with a flat ground. */
export function groundedSky(tex: THREE.DataTexture, height = 1.7, radius = 120) {
  const sky = new GroundedSkybox(tex, height, radius);
  sky.position.y = height - 0.01;
  return sky;
}
