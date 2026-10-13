import { rng } from '../rng';

/**
 * Stopgap synthetic earthquake for Phase 1, ported from the prototype's makeQuake().
 * A sum of random sine waves weighted around a center frequency, under a build-up,
 * strong-shaking and decay envelope, in two horizontal directions. Phase 3 replaces this
 * with the full model (P, S and surface phases, site filters).
 *
 * Output is ground displacement (m) and acceleration (m/s^2) sampled every `dt` seconds.
 */
export interface QuakeRecord {
  dt: number;
  n: number;
  x: Float64Array; z: Float64Array;   // displacement
  ax: Float64Array; az: Float64Array; // acceleration
  y?: Float64Array; ay?: Float64Array; // vertical, when the record has it (Phase 3 ground motion)
  peakG: number;
}

export interface QuakeOptions {
  peakG: number;       // target peak horizontal ground acceleration, in g
  centerHz: number;    // where the shaking energy is concentrated
  duration?: number;   // seconds
  seed?: number;
  dt?: number;
  zRatio?: number;     // strength of the second horizontal direction relative to the first
}

const G = 9.81;

export function makeQuake(o: QuakeOptions): QuakeRecord {
  const dt = o.dt ?? 1 / 960;
  const duration = o.duration ?? 20;
  const n = Math.round(duration / dt) + 1;
  const r = rng(o.seed ?? 20261012);
  const component = (ratio: number) => {
    const comps: [number, number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const f = 0.4 + 3.6 * r();
      const w = Math.exp(-(((f - o.centerHz) / (0.35 * o.centerHz)) ** 2)) + 0.06;
      const om = 2 * Math.PI * f;
      // Weight acceleration, so displacement amplitude is w / omega^2.
      comps.push([om, (w * (0.6 + 0.4 * r())) / (om * om), r() * Math.PI * 2]);
    }
    const xs = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const t = k * dt;
      let env = t < 2.5 ? (t / 2.5) ** 2 : t < duration * 0.45 ? 1 : Math.exp(-(t - duration * 0.45) / 3);
      if (t > duration - 2) env *= Math.max(0, (duration - t) / 2);
      let x = 0;
      for (const [om, a, p] of comps) x += a * (Math.sin(om * t + p) - Math.sin(p));
      xs[k] = x * env * ratio;
    }
    return xs;
  };
  const x = component(1), z = component(o.zRatio ?? 0.6);
  // Ramp out any offset at the end so the ground comes to rest where it started.
  for (const xs of [x, z]) {
    const end = xs[n - 1];
    for (let k = 0; k < n; k++) xs[k] -= end * (k / (n - 1));
  }
  const accel = (xs: Float64Array) => {
    const a = new Float64Array(n);
    for (let k = 1; k < n - 1; k++) a[k] = (xs[k + 1] - 2 * xs[k] + xs[k - 1]) / (dt * dt);
    return a;
  };
  let ax = accel(x), az = accel(z);
  let pk = 0;
  for (let k = 0; k < n; k++) pk = Math.max(pk, Math.hypot(ax[k], az[k]));
  const sc = (o.peakG * G) / pk;
  for (const arr of [x, z, ax, az]) for (let k = 0; k < n; k++) arr[k] *= sc;
  return { dt, n, x, z, ax, az, peakG: o.peakG };
}

/** Linear interpolation into a record at time t (seconds). Zero outside the record. */
export function sample(rec: QuakeRecord, arr: Float64Array, t: number): number {
  const f = t / rec.dt;
  if (f <= 0 || f >= rec.n - 1) return 0;
  const i = Math.floor(f), a = f - i;
  return arr[i] * (1 - a) + arr[i + 1] * a;
}
