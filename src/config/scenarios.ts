import type { QuakeOptions } from '../sim/quake/synthetic';

/**
 * Phase 1 quake: a near quake on firm ground. Short, sharp shaking centered near the
 * soft-story building's own rhythm (period 0.55 s, about 1.8 Hz).
 */
export const PHASE1_QUAKE: QuakeOptions = { peakG: 0.4, centerHz: 1.7, duration: 20, seed: 20261012 };
