import type { QuakeOptions } from '../sim/quake/synthetic';
import type { GroundMotionOptions } from '../sim/quake/groundMotion';

/**
 * Phase 1 quake: a near quake on firm ground. Short, sharp shaking centered near the
 * soft-story building's own rhythm (period 0.55 s, about 1.8 Hz).
 */
export const PHASE1_QUAKE: QuakeOptions = { peakG: 0.4, centerHz: 1.7, duration: 20, seed: 20261012 };

/**
 * Phase 3 signature quakes (docs/PLAN.md, "the same street gets opposite outcomes").
 * Checked in Node with three seeds each (docs/DECISIONS.md):
 *  - near: building 2's shop story fails, the mid-rise cracks at most, the rest ride it out.
 *  - far: building 2 survives, the mid-rise is wrecked by its own rhythm on soft ground.
 */
export const QUAKE_PRESETS = {
  near: { magnitude: 6.5, distanceKm: 12, site: 'rock', label: 'Near quake' },
  far: { magnitude: 7.8, distanceKm: 120, site: 'soft', label: 'Far quake' },
} as const satisfies Record<string, Omit<GroundMotionOptions, 'seed'> & { label: string }>;
export type QuakePreset = keyof typeof QUAKE_PRESETS;
