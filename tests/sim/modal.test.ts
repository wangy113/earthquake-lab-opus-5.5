import { describe, expect, it } from 'vitest';
import { eigSym, shearBuildingPeriods, tuneToPeriod } from '../../src/sim/structure/modal';

describe('modal analysis', () => {
  it('single story matches T = 2 pi sqrt(m / k)', () => {
    const m = 4000, k = 1.14e6;
    expect(shearBuildingPeriods([m], [k])[0]).toBeCloseTo(2 * Math.PI * Math.sqrt(m / k), 10);
  });

  it('uniform shear building matches the closed form', () => {
    // Equal m and k with a free top: w_j = 2 sqrt(k/m) sin((2j-1) pi / (2(2N+1)))
    const N = 12, m = 2.2e5, k = 4.0e8;
    const T = shearBuildingPeriods(Array(N).fill(m), Array(N).fill(k));
    for (let j = 1; j <= 3; j++) {
      const w = 2 * Math.sqrt(k / m) * Math.sin(((2 * j - 1) * Math.PI) / (2 * (2 * N + 1)));
      expect(T[j - 1]).toBeCloseTo((2 * Math.PI) / w, 8);
    }
  });

  it('reproduces the prototype bare frame beat near 1.2 Hz', () => {
    // Prototype: three 4,000 kg slabs, k = 1.14e6 N/m per story.
    const T = shearBuildingPeriods([4000, 4000, 4000], [1.14e6, 1.14e6, 1.14e6]);
    expect(1 / T[0]).toBeGreaterThan(1.1);
    expect(1 / T[0]).toBeLessThan(1.3);
  });

  it('tunes a 12 story profile to a 1.2 s first period', () => {
    const masses = Array(12).fill(2.2e5);
    const profile = masses.map((_, i) => 1 - 0.5 * (i / 12)); // stiffer at the bottom
    const k = tuneToPeriod(masses, profile, 1.2);
    expect(shearBuildingPeriods(masses, k)[0]).toBeCloseTo(1.2, 8);
  });

  it('eigSym handles a diagonal matrix', () => {
    expect(eigSym([[3, 0], [0, 1]])).toEqual([1, 3]);
  });
});
