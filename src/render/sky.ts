import * as THREE from 'three/webgpu';

/**
 * Time-of-day presets (docs/PLAN.md, "Time of day"): each one is a Poly Haven pure-sky HDRI.
 * The sun is measured from the HDRI itself: its direction, color and strength. Then the sun is
 * clamped out of the copy used for lighting, so the scene is not lit by the sun twice (once by
 * the directional light, once through the environment map).
 */
//
// `sunFrom` turns the whole sky so the sun shines from that compass direction (radians, 0 is
// straight in front of the buildings, +z, and positive angles come round from +x). The street
// faces the plaza, so a sun in front and to one side rakes across the facades.
export const SKIES = {
  midday: { hdri: 'kloofendal_48d_partly_cloudy_puresky', label: 'Midday', exposure: 1.0, minElevation: 0.35, sunFrom: 0.7 },
  clear: { hdri: 'autumn_field_puresky', label: 'Clear', exposure: 1.0, minElevation: 0.35, sunFrom: -0.6 },
  golden: { hdri: 'qwantani_sunset_puresky', label: 'Golden hour', exposure: 1.0, minElevation: 0.16, sunFrom: 1.05 },
  overcast: { hdri: 'kloofendal_overcast_puresky', label: 'Overcast', exposure: 1.0, minElevation: 0.6, sunFrom: 0 },
} as const;

/** Rotation about y that turns the measured sun toward `sunFrom`. */
export function skyRotation(sunDir: THREE.Vector3, sunFrom: number) {
  const now = Math.atan2(sunDir.x, sunDir.z);
  const want = Math.atan2(Math.sin(sunFrom), Math.cos(sunFrom));
  return want - now;
}
export type SkyName = keyof typeof SKIES;

export interface SkyAnalysis {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** Irradiance from the sun on a surface facing it, in the HDRI's own units. */
  sunIrradiance: number;
  /** Mean radiance of the sky without the sun, in the HDRI's own units. */
  skyMean: number;
  horizon: THREE.Color;
  /** The HDRI with the sun clamped out, for scene.environment. */
  env: THREE.DataTexture;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function analyzeSky(tex: THREE.DataTexture, minElevation = 0.35): SkyAnalysis {
  const { data, width: W, height: H } = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = data instanceof Uint16Array;
  const N = W * H;
  const px = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) {
    const v = data[i * 4 + c];
    px[i * 3 + c] = half ? THREE.DataUtils.fromHalfFloat(v) : v;
  }
  // Mean sky radiance over the upper hemisphere, weighted by solid angle.
  let wSum = 0, lSum = 0;
  const hz = new THREE.Vector3();
  let hzW = 0;
  for (let y = 0; y < H / 2; y++) {
    const w = Math.cos((0.5 - (y + 0.5) / H) * Math.PI);
    const nearHorizon = y > H * 0.44;
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 3;
      const l = lum(px[i], px[i + 1], px[i + 2]);
      wSum += w; lSum += l * w;
      if (nearHorizon) { hz.x += px[i]; hz.y += px[i + 1]; hz.z += px[i + 2]; hzW++; }
    }
  }
  const mean = lSum / wSum;
  // Sun pixels: far brighter than the sky around them. Anything above the threshold is the
  // sun's share. Its excess energy, times the pixel's solid angle, is the sun's irradiance.
  const threshold = Math.max(mean * 25, 8);
  const dOmega = (2 * Math.PI / W) * (Math.PI / H);
  let E = 0, cr = 0, cg = 0, cb = 0;
  const dir = new THREE.Vector3();
  let skyBelow = 0, skyBelowW = 0;
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    const w = Math.cos(lat) * dOmega;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const l = lum(px[i], px[i + 1], px[i + 2]);
      if (l <= threshold) { if (y < H / 2) { skyBelow += l * w; skyBelowW += w; } continue; }
      const f = (l - threshold) / l;
      E += (l - threshold) * w;
      cr += px[i] * f * w; cg += px[i + 1] * f * w; cb += px[i + 2] * f * w;
      const ang = ((x + 0.5) / W - 0.5) * Math.PI * 2;
      dir.x += Math.cos(ang) * Math.cos(lat) * (l - threshold) * w;
      dir.y += Math.sin(lat) * (l - threshold) * w;
      dir.z += Math.sin(ang) * Math.cos(lat) * (l - threshold) * w;
      // Clamp the pixel to the threshold, keeping its hue.
      const k = threshold / l;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = px[i + c] * k;
        data[o + c] = half ? THREE.DataUtils.toHalfFloat(v) : v;
      }
    }
  }
  // The clamped copy shares nothing with the original: copy the data back out first.
  const clamped = (half ? new Uint16Array(data) : new Float32Array(data));
  // Restore the original for the background (the sun disc stays visible in the sky).
  for (let i = 0; i < N; i++) {
    const l = lum(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]);
    if (l <= threshold) continue;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = half ? THREE.DataUtils.toHalfFloat(px[i * 3 + c]) : px[i * 3 + c];
  }
  const env = new THREE.DataTexture(clamped, W, H, THREE.RGBAFormat, tex.type);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = tex.colorSpace;
  env.minFilter = env.magFilter = THREE.LinearFilter;
  env.generateMipmaps = false;
  env.needsUpdate = true;

  let sunDir: THREE.Vector3;
  if (dir.lengthSq() > 0) {
    sunDir = dir.normalize();
  } else {
    sunDir = new THREE.Vector3(0.5, 1, 0.3).normalize(); // overcast: soft light from high up
  }
  const elev = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1));
  if (elev < minElevation) {
    const hzLen = Math.hypot(sunDir.x, sunDir.z) || 1;
    sunDir.set(sunDir.x / hzLen * Math.cos(minElevation), Math.sin(minElevation), sunDir.z / hzLen * Math.cos(minElevation));
  }
  const cMax = Math.max(cr, cg, cb) || 1;
  const sunColor = E > 0 ? new THREE.Color(cr / cMax, cg / cMax, cb / cMax) : new THREE.Color(1, 1, 1);
  const horizon = new THREE.Color(hz.x / hzW, hz.y / hzW, hz.z / hzW);
  return { sunDir, sunColor, sunIrradiance: E, skyMean: skyBelowW ? skyBelow / skyBelowW : mean, horizon, env };
}
