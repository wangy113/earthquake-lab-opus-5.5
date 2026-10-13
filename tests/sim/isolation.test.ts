import { describe, expect, it } from 'vitest';
import { ShearBuilding } from '../../src/sim/structure/shearBuilding';
import { makeGroundMotion, type GroundMotionOptions } from '../../src/sim/quake/groundMotion';
import { sample } from '../../src/sim/quake/synthetic';
import { streetBuildings } from '../../src/sim/street';
import { QUAKE_PRESETS } from '../../src/config/scenarios';

const stationSpec = (isolated: boolean) => streetBuildings({ isolated }).find(b => b.kind === 'station')!.structure;

function shake(isolated: boolean, o: GroundMotionOptions) {
  const b = new ShearBuilding(stationSpec(isolated));
  const hits: number[] = [];
  b.onMoat = v => hits.push(v);
  const q = makeGroundMotion(o), dt = 1 / 960;
  for (let t = 0; t < q.n * q.dt; t += dt) b.step(dt, sample(q, q.ax, t), sample(q, q.az, t));
  return { b, hits, drift: Math.max(...b.stories.map(s => s.peak)) };
}

describe('Phase 3 base isolation (fire station)', () => {
  it('isolators stretch the period from 0.4 s to about 2.5 s', () => {
    const fixed = new ShearBuilding(stationSpec(false)), iso = new ShearBuilding(stationSpec(true));
    expect(fixed.periods[0]).toBeCloseTo(0.4, 3);
    expect(iso.fixedPeriods[0]).toBeCloseTo(0.4, 3);
    expect(iso.periods[0]).toBeGreaterThan(2.4);
    expect(iso.periods[0]).toBeLessThan(2.7);
  });

  it('stays put without shaking', () => {
    const b = new ShearBuilding(stationSpec(true));
    for (let i = 0; i < 960 * 10; i++) b.step(1 / 960, 0, 0);
    expect(b.peakBase).toBe(0);
  });

  it('near quake on rock: the base slides, the building above barely bends', () => {
    for (const seed of [1, 2]) {
      const o = { ...QUAKE_PRESETS.near, seed };
      const fixed = shake(false, o), iso = shake(true, o);
      expect(iso.b.peakBase).toBeGreaterThan(0.05);
      expect(iso.drift).toBeLessThan(0.4 * fixed.drift);
      expect(iso.hits).toEqual([]);
    }
  });

  it('a strong quake on soft ground can drive the base into its moat', () => {
    const r = shake(true, { magnitude: 7, distanceKm: 15, site: 'soft', seed: 1 });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.b.moatHits).toBe(r.hits.length);
    expect(r.b.peakBase).toBeLessThan(0.45); // the wall stops it a few centimeters past the gap
  });
});
