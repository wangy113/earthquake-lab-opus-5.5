import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { Scenario, DT } from '../../src/sim/scenario';
import { softStoryLayout } from '../../src/sim/building/softStory';
import { makeQuake } from '../../src/sim/quake/synthetic';
import { PHASE1_QUAKE } from '../../src/config/scenarios';

beforeAll(async () => { await RAPIER.init(); });

function run(seconds: number, quake = true) {
  const s = new Scenario(RAPIER, softStoryLayout());
  for (let i = 0; i < 60; i++) s.step(); // let props settle
  if (quake) s.startQuake(makeQuake(PHASE1_QUAKE));
  for (let i = 0; i < Math.round(seconds / DT); i++) s.step();
  const rep = s.report();
  const props = [...s.bodies.values()].filter(b => b.kind === 'prop').map(b => b.body.translation());
  s.free();
  return { rep, props };
}

describe('Phase 1 soft-story scenario', () => {
  it('first period is about 0.55 s', () => {
    const s = new Scenario(RAPIER, softStoryLayout());
    expect(s.building.periods[0]).toBeCloseTo(0.55, 3);
    s.free();
  });

  it('stays at rest without a quake', () => {
    const { rep, props } = run(20, false);
    expect(rep.failedAt).toBeNull();
    expect(Math.abs(rep.blockDrop)).toBeLessThan(1e-3);
    for (const p of props) expect(p.y).toBeGreaterThan(-0.05);
  });

  it('the shop story fails partway through the quake and the block drops', () => {
    const { rep } = run(16);
    expect(rep.failedAt).not.toBeNull();
    expect(rep.failedAt!).toBeGreaterThan(3);
    expect(rep.failedAt!).toBeLessThan(12);
    expect(rep.blockDrop).toBeGreaterThan(1.5); // fell most of a story onto the debris
    expect(rep.stories.slice(1).every(st => !st.failed)).toBe(true);
  });

  it('collapses the same way every run', () => {
    const a = run(14).rep, b = run(14).rep;
    expect(a.failedAt).toBe(b.failedAt);
    expect(a.blockY).toBeCloseTo(b.blockY, 6);
  });
});
