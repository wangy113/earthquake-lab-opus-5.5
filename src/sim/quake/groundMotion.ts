import { rng } from '../rng';
import type { QuakeRecord } from './synthetic';

/**
 * Phase 3 ground motion (docs/PLAN.md, layer 1): a seeded, three-component record built from
 * an earthquake's size, its distance and the ground under the street.
 *
 * Method, a simplified stochastic model:
 *  1. Windowed white noise for each wave phase:
 *     - P: mostly vertical and higher pitched, from the P arrival until the S wave takes over.
 *     - S: horizontal, the strong shaking.
 *     - Surface waves: slow, long-period rolling that grows with distance.
 *  2. Shaped in the frequency domain:
 *     - source: an omega-squared spectrum with a corner frequency that drops as quakes get bigger
 *     - path: high frequencies die out with distance
 *     - site: a Kanai-Tajimi filter that rings at the ground's own period
 *  3. Baseline corrected: integrated to displacement in the frequency domain with a steep
 *     high-pass, then tapered, so the ground ends at rest where it started.
 *     Displacement is the master signal and acceleration is its second difference, so the
 *     structure model (acceleration) and Rapier (displacement) see the same motion.
 *  4. Scaled to a peak horizontal acceleration from a simple attenuation rule.
 *
 * Every number here is a Model value chosen to give plausible shaking, not a Real world claim.
 * The lab's guided tests must not quote them as facts about real earthquakes.
 */
export type Site = 'rock' | 'firm' | 'soft';

export interface GroundMotionOptions {
  magnitude: number;  // moment magnitude, about 5 to 8
  distanceKm: number; // from the street to the fault
  site: Site;
  seed?: number;
  dt?: number;        // sample step, default 1/200 s (sample() interpolates)
  pga?: number;       // override the peak horizontal acceleration, in g
}

export interface GroundMotion extends QuakeRecord {
  y: Float64Array; ay: Float64Array; // vertical
  tP: number; tS: number;            // arrival times in the record, seconds
  duration: number;                  // strong-shaking duration used for the S envelope
  opts: Required<Omit<GroundMotionOptions, 'pga'>>;
}

const G = 9.81;
const VP = 6.0, VS = 3.5, VSURF = 3.0; // km/s (Model)

/** Ground period (s) and damping of the Kanai-Tajimi site filter (Model). */
export const SITES: Record<Site, { period: number; zeta: number; amp: number; label: string }> = {
  rock: { period: 0.12, zeta: 0.6, amp: 1.0, label: 'Rock' },
  firm: { period: 0.35, zeta: 0.4, amp: 1.25, label: 'Firm ground' },
  soft: { period: 1.3, zeta: 0.2, amp: 1.7, label: 'Soft ground' },
};

/** Peak horizontal acceleration on rock, in g (Model attenuation rule). */
export function rockPga(magnitude: number, distanceKm: number) {
  return 0.45 * 10 ** (0.3 * (magnitude - 6.5)) * (15 / (distanceKm + 5)) ** 1.1;
}

/**
 * Site amplification of the peak acceleration (Model). Soft soils amplify weak shaking the
 * most and strong shaking less, because the soil itself yields (soil nonlinearity).
 */
export function siteAmp(site: Site, rock: number) {
  const s = SITES[site];
  return 1 + (s.amp - 1) * Math.min(1, Math.max(0.2, 1 - rock / 0.45));
}

/** Strong-shaking duration, seconds (Model): longer for bigger and farther quakes. */
export function shakingDuration(magnitude: number, distanceKm: number) {
  return 2 + 1.5 * 10 ** (0.4 * (magnitude - 5)) + 0.1 * distanceKm;
}

/** Brune corner frequency, Hz, for a 30 bar stress drop. */
export function cornerHz(magnitude: number) {
  const M0 = 10 ** (1.5 * magnitude + 16.05); // dyne cm
  return 4.9e6 * VS * (30 / M0) ** (1 / 3);
}

// --- small FFT (radix 2, in place) ---------------------------------------------------------
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Filter a real signal by a real gain function of frequency (Hz). */
function shape(x: Float64Array, dt: number, gain: (f: number) => number) {
  let N = 1;
  while (N < x.length * 2) N <<= 1; // zero padding keeps the filter from wrapping around
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(x);
  fft(re, im, false);
  for (let k = 0; k <= N / 2; k++) {
    const g = gain(k / (N * dt));
    re[k] *= g; im[k] *= g;
    if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; }
  }
  fft(re, im, true);
  return re.slice(0, x.length);
}

const smoothstep = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

export function makeGroundMotion(o: GroundMotionOptions): GroundMotion {
  const dt = o.dt ?? 1 / 200;
  const seed = o.seed ?? 20261013;
  const { magnitude: M, distanceKm: d, site } = o;
  const s = SITES[site];
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

  // Timing: the record starts two quiet seconds before the P wave reaches the street.
  const lead = 2;
  const tP = lead, tS = lead + d * (1 / VS - 1 / VP), tSurf = lead + d * (1 / VSURF - 1 / VP);
  const Ds = shakingDuration(M, d);
  const decay = 0.35 * Ds + 2;
  const total = tSurf + Ds + 4 * decay + (site === 'soft' ? 6 : 2);
  const n = Math.ceil(total / dt) + 1;

  // Envelopes for the three phases.
  const envP = (t: number) => smoothstep(tP, tP + 0.3, t) * (t < tS ? 1 : Math.exp(-(t - tS) / 1.5));
  const envS = (t: number) => smoothstep(tS, tS + 1, t) * (t < tS + Ds ? 1 : Math.exp(-(t - tS - Ds) / decay));
  const surfAmp = Math.min(1, Math.max(0, (d - 20) / 80)) * 0.3;
  const envSurf = (t: number) => smoothstep(tSurf, tSurf + 3, t) * (t < tSurf + Ds ? 1 : Math.exp(-(t - tSurf - Ds) / (decay * 1.5)));
  const noise = (env: (t: number) => number) => {
    const a = new Float64Array(n);
    for (let k = 0; k < n; k++) a[k] = gauss() * env(k * dt);
    return a;
  };

  // Spectral shapes.
  const fc = cornerHz(M), kappa = 0.04;
  const Q = (f: number) => 180 * Math.max(f, 0.2) ** 0.45;
  const source = (f: number) => (f * f) / (1 + (f / fc) ** 2);
  const path = (f: number) => Math.exp(-Math.PI * f * d / (Q(f) * VS)) * Math.exp(-Math.PI * kappa * f);
  const fg = 1 / s.period;
  const siteGain = (f: number) => {
    const u = f / fg, z2 = 4 * s.zeta * s.zeta * u * u;
    return Math.sqrt((1 + z2) / ((1 - u * u) ** 2 + z2));
  };
  const highPass = (f: number, fh: number) => (f * f) / (f * f + fh * fh);
  const lowPass = (f: number) => 1 / (1 + (f / 25) ** 8); // stay well under the sample rate
  const base = (f: number) => source(f) * path(f) * siteGain(f) * highPass(f, 0.08) * lowPass(f);
  const pGain = (f: number) => base(f * 0.5) * highPass(f, 1.5);  // P: pitched up, no long periods
  const surfGain = (f: number) => {
    const fs = 0.4; // long-period rolling, about 2.5 s
    return Math.exp(-(((f - fs) / 0.18) ** 2)) * siteGain(f) * highPass(f, 0.08);
  };

  const norm = (a: Float64Array) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m || 1; };
  const phase = (env: (t: number) => number, gain: (f: number) => number, scale: number, start: number) => {
    // The frequency-domain filter is not causal: gate the result so no phase starts early.
    const a = shape(noise(env), dt, gain);
    for (let i = 0; i < n; i++) a[i] *= smoothstep(start - 0.05, start + 0.25, i * dt);
    const k = scale / norm(a);
    for (let i = 0; i < n; i++) a[i] *= k;
    return a;
  };
  // Relative strengths before final scaling: S is 1, P about a third, surface waves by distance.
  const S1 = phase(envS, base, 1, tS), S2 = phase(envS, base, 0.75, tS);
  const Pv = phase(envP, pGain, 0.35, tP), Ph1 = phase(envP, pGain, 0.1, tP), Ph2 = phase(envP, pGain, 0.08, tP);
  const R1 = phase(envSurf, surfGain, surfAmp, tSurf), R2 = phase(envSurf, surfGain, 0.6 * surfAmp, tSurf), Rv = phase(envSurf, surfGain, 0.5 * surfAmp, tSurf);
  const ax0 = new Float64Array(n), az0 = new Float64Array(n), ay0 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ax0[i] = S1[i] + Ph1[i] + R1[i];
    az0[i] = S2[i] + Ph2[i] + R2[i];
    ay0[i] = 0.3 * S1[i] + Pv[i] + Rv[i];
  }

  // Displacement by integrating twice in the frequency domain: X = -A / (2 pi f)^2, with a
  // fourth-order high-pass at 0.1 Hz so the long periods cannot drift away. That filter is
  // not causal, so a short gate before the P arrival and a taper at the end pin both ends to
  // exactly zero.
  const toDisp = (a: Float64Array) => {
    const fh = 0.1;
    const x = shape(a, dt, f => f === 0 ? 0 : -((f * f / (f * f + fh * fh)) ** 2) / ((2 * Math.PI * f) ** 2));
    const t1 = site === 'soft' ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      x[i] *= smoothstep(0.2, tP - 0.2, t) * smoothstep(0, t1, (n - 1) * dt - t);
    }
    return x;
  };
  const accel = (x: Float64Array) => {
    const a = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) a[i] = (x[i + 1] - 2 * x[i] + x[i - 1]) / (dt * dt);
    return a;
  };
  const x = toDisp(ax0), z = toDisp(az0), y = toDisp(ay0);
  const ax = accel(x), az = accel(z), ay = accel(y);

  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.hypot(ax[i], az[i]));
  const target = o.pga ?? Math.min(1.2, rockPga(M, d) * siteAmp(site, rockPga(M, d)));
  const sc = (target * G) / pk;
  for (const arr of [x, z, y, ax, az, ay]) for (let i = 0; i < n; i++) arr[i] *= sc;
  return { dt, n, x, z, y, ax, az, ay, peakG: target, tP, tS, duration: Ds, opts: { magnitude: M, distanceKm: d, site, seed, dt } };
}

/**
 * Pseudo-spectral acceleration (g) of a damped one-mass oscillator with period T under the
 * record's x component: how hard a building with that natural period gets shaken. Used by the
 * tests now and the instruments later.
 */
export function spectralAccel(rec: QuakeRecord, T: number, zeta = 0.05) {
  const w = 2 * Math.PI / T, sub = Math.max(1, Math.ceil(rec.dt / (T / 40)));
  const h = rec.dt / sub;
  let u = 0, v = 0, peak = 0;
  for (let i = 0; i < rec.n - 1; i++) for (let s = 0; s < sub; s++) {
    const a = rec.ax[i] + (rec.ax[i + 1] - rec.ax[i]) * (s / sub);
    v += (-a - 2 * zeta * w * v - w * w * u) * h;
    u += v * h;
    peak = Math.max(peak, Math.abs(u));
  }
  return (w * w * peak) / G;
}
