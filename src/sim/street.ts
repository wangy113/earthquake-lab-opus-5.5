import type { ShearBuildingSpec, StorySpec } from './structure/shearBuilding';
import { STORY_H } from './building/softStory';

/**
 * The street (docs/PLAN.md, building lineup). Pure layout data shared by the simulation and
 * the renderer. Every building faces +z toward the street. Its footprint runs x 0..W and
 * z -D..0 from its origin, the front-left corner at sidewalk level.
 *
 * Cross-section along z, at every x:
 *   z < 0      buildings
 *   0 .. 4     sidewalk (top at y 0)
 *   4 .. 12    road (top at y -CURB_H)
 *   12 .. 40   plaza (top at y 0), where the eye-level camera stands
 *
 * Building 2 (the soft story) keeps its own detailed layout in building/softStory.ts at x 0..12.
 */
export const CURB_H = 0.15;
export const SIDEWALK = { z0: 0, z1: 4 };
export const ROAD = { z0: 4, z1: 12 };
export const PLAZA = { z0: 12, z1: 40 };

export type BuildingKind = 'brick' | 'softStory' | 'midrise' | 'tower' | 'station';

export interface StreetBuilding {
  id: string;
  num: number;          // 1..5 in the lineup table
  label: string;
  kind: BuildingKind;
  origin: [number, number, number];
  bays: number; depthBays: number; stories: number;
  W: number; D: number;
  structure: ShearBuildingSpec;
}

/** Stiffness tapering with height, as in a real frame sized for the shear at each level. */
function stories(n: number, label: (i: number) => string, yieldDrift: number, ultDrift: number, taper = 0.5): StorySpec[] {
  return Array.from({ length: n }, (_, i) => ({
    label: label(i),
    stiffnessShare: 1 - taper * (i / Math.max(1, n - 1)),
    yieldDrift, ultDrift,
    canFail: false, // Phase 2: only building 2 can fail. Phase 4 adds the other failure modes.
  }));
}

const storyLabel = (i: number) => `Story ${i + 1}`;

function building(num: number, id: string, label: string, kind: BuildingKind, x: number, bays: number, depthBays: number, n: number,
  tonnesPerM2: number, period: number, yieldDrift: number, ultDrift: number, taper?: number): StreetBuilding {
  const W = bays * 3, D = depthBays * 3;
  return {
    id, num, label, kind, origin: [x, 0, 0], bays, depthBays, stories: n, W, D,
    structure: {
      floorMass: tonnesPerM2 * 1000 * W * D,
      storyHeight: STORY_H,
      targetPeriod: period,
      zeta: 0.05,
      stories: stories(n, storyLabel, yieldDrift, ultDrift, taper),
    },
  };
}

/**
 * The four buildings besides the soft story. Periods follow the lineup table and are tuned
 * properly in Phase 3. The fire station is fixed-base until Phase 3 adds its isolators.
 */
export function streetBuildings(): StreetBuilding[] {
  return [
    building(1, 'brick', 'Old brick store', 'brick', -16, 4, 3, 2, 1.3, 0.2, 0.002, 0.012, 0.2),
    building(3, 'midrise', 'Mid-rise apartments', 'midrise', 12.5, 5, 4, 12, 1.0, 1.2, 0.005, 0.03),
    building(4, 'tower', 'Glass office tower', 'tower', 32, 6, 6, 20, 0.9, 2.5, 0.012, 0.04),
    building(5, 'station', 'Fire station', 'station', 55, 4, 4, 4, 1.1, 0.4, 0.007, 0.03, 0.3),
  ];
}

/** Every building's x extent, for cameras and the street dressing. Building 2 sits at 0..12. */
export const STREET_X = { min: -16, max: 67, center: 25 };
