import { describe, expect, it } from 'vitest';
import { makeGroundMotion, spectralAccel, rockPga, SITES } from '../../src/sim/quake/groundMotion';

const near = () => makeGroundMotion({ magnitude: 6.5, distanceKm: 12, site: 'rock' });
const far = () => makeGroundMotion({ magnitude: 7.8, distanceKm: 120, site: 'soft' });

/** First time |a| passes `frac` of its own peak. */
function onset(a: Float64Array, dt: number, frac = 0.1) {
  let pk = 0;
  for (const v of a) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > frac * pk) return i * dt;
  return Infinity;
}

describe('Phase 3 ground motion', () => {
  it('hits its target peak acceleration', () => {
    for (const q of [near(), far()]) {
      let pk = 0;
      for (let i = 0; i < q.n; i++) pk = Math.max(pk, Math.hypot(q.ax[i], q.az[i]));
      expect(pk / 9.81).toBeCloseTo(q.peakG, 6);
    }
    expect(near().peakG).toBeCloseTo(rockPga(6.5, 12), 6);
  });

  it('ends at rest where it started', () => {
    for (const q of [near(), far()]) for (const xs of [q.x, q.z, q.y]) {
      const n = q.n;
      expect(Math.abs(xs[n - 1])).toBeLessThan(1e-4);
      expect(Math.abs((xs[n - 1] - xs[n - 2]) / q.dt)).toBeLessThan(1e-3);
    }
  });

  it('the vertical P wave arrives first, the S wave after the S minus P delay', () => {
    for (const q of [near(), far()]) {
      const tVert = onset(q.ay, q.dt, 0.05), tHor = onset(q.ax, q.dt, 0.2);
      expect(tVert).toBeGreaterThanOrEqual(q.tP - 0.05);
      expect(tVert).toBeLessThan(q.tS);
      expect(tHor).toBeGreaterThan(q.tS - 0.5);
    }
    const q = far();
    expect(q.tS - q.tP).toBeCloseTo(120 * (1 / 3.5 - 1 / 6), 6);
  });

  it('soft ground shakes hardest near its own period, rock at short periods', () => {
    const periods = [0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0, 2.5, 3.0];
    const peakT = (q: ReturnType<typeof near>) => {
      let best = 0, bt = 0;
      for (const T of periods) { const sa = spectralAccel(q, T); if (sa > best) { best = sa; bt = T; } }
      return bt;
    };
    expect(peakT(near())).toBeLessThanOrEqual(0.45);
    const tSoft = peakT(far());
    expect(tSoft).toBeGreaterThanOrEqual(SITES.soft.period * 0.6);
    expect(tSoft).toBeLessThanOrEqual(SITES.soft.period * 1.6);
  });

  it('the core lesson: the same street gets opposite outcomes', () => {
    // Near quake on rock: the short building (0.55 s) is hit harder than the mid-rise (1.2 s).
    // Far, large quake on soft ground: the other way round.
    const n = near(), f = far();
    expect(spectralAccel(n, 0.55)).toBeGreaterThan(spectralAccel(n, 1.2));
    expect(spectralAccel(f, 1.2)).toBeGreaterThan(spectralAccel(f, 0.55));
  });

  it('is deterministic for a seed and different across seeds', () => {
    const a = near(), b = near(), c = makeGroundMotion({ magnitude: 6.5, distanceKm: 12, site: 'rock', seed: 7 });
    expect(a.ax).toEqual(b.ax);
    expect(a.ax[Math.round(a.tS / a.dt) + 400]).not.toBe(c.ax[Math.round(c.tS / c.dt) + 400]);
  });
});
