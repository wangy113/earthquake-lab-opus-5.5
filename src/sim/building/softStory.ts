import type { ShearBuildingSpec } from '../structure/shearBuilding';

/**
 * Building 2 of the lineup: apartments over shops, 4 stories. The ground story has an open
 * shopfront (columns and rollershutters) and is much softer than the floors above, the
 * soft-story pattern of buildings like Northridge Meadows (1994).
 *
 * Pure layout data shared by the simulation (colliders) and the renderer (meshes).
 * Frame: footprint x 0..W, z -D..0, the front faces +z toward the plaza, y up from the street.
 * Floor i (1..stories) is the slab at the top of story i. Floor 0 is the ground.
 */
export const STORY_H = 3;
export const SLAB_T = 0.25;

export interface Box { id: string; kind: 'panel' | 'column' | 'shutter'; center: [number, number, number]; half: [number, number, number]; mass: number }

export interface PropSpec {
  id: string;
  model: string;               // Poly Haven model id
  size: [number, number, number]; // collider size w, h, d (m), from Poly Haven dimensions
  pos: [number, number];       // x, z center
  floor: number;               // stands on floor `floor` (0 is the street level inside the shop)
  rotY: number;
  mass: number;
  lift?: number;               // extra height above the floor, for stacking
}

export interface SoftStoryLayout {
  origin: [number, number, number];
  bays: number; depthBays: number; stories: number;
  W: number; D: number;
  structure: ShearBuildingSpec;
  groundStory: Box[];   // breakable pieces of story 1
  props: PropSpec[];
  slabMass: number; wallMass: number; // per floor, for the falling upper block
}

/** Poly Haven dimensions converted to (width, height, depth) in meters. */
export const PROP_SIZES: Record<string, [number, number, number]> = {
  metal_office_desk: [2.0, 0.788, 0.947],
  plastic_monobloc_chair_01: [0.642, 0.88, 0.628],
  wooden_crate_01: [0.825, 0.35, 0.409],
  cardboard_box_01: [0.387, 0.342, 0.516],
  Sofa_01: [1.571, 0.797, 0.658],
  steel_frame_shelves_01: [1.097, 2.141, 0.502],
  potted_plant_02: [0.701, 0.841, 0.657],
  painted_wooden_bench: [1.17, 0.89, 0.49],
  planter_box_01: [0.913, 0.425, 0.414],
};

const prop = (id: string, model: string, x: number, z: number, floor: number, rotY: number, mass: number): PropSpec =>
  ({ id, model, size: PROP_SIZES[model], pos: [x, z], floor, rotY, mass });

export function softStoryLayout(): SoftStoryLayout {
  const bays = 4, depthBays = 3, stories = 4;
  const W = bays * 3, D = depthBays * 3;
  const groundStory: Box[] = [];
  const h = STORY_H - SLAB_T - 0.02; // pieces fit under the floor 1 slab without touching it
  const cy = h / 2;
  // Front: five columns and two rollershutters (bays 0 and 3). Bays 1 and 2 are open shopfront.
  for (let b = 0; b <= bays; b++) {
    const x = Math.min(Math.max(b * 3, 0.2), W - 0.2);
    groundStory.push({ id: `col:${b}`, kind: 'column', center: [x, cy, -0.2], half: [0.2, h / 2, 0.2], mass: 900 });
  }
  for (const b of [0, 3]) groundStory.push({ id: `shutter:${b}`, kind: 'shutter', center: [b * 3 + 1.5, 1.2, -0.25], half: [1.3, 1.2, 0.08], mass: 120 });
  // Sides and back: wall panels, one per bay.
  for (let j = 0; j < depthBays; j++) {
    groundStory.push({ id: `panel:L${j}`, kind: 'panel', center: [0.125, cy, -j * 3 - 1.5], half: [0.125, h / 2, 1.45], mass: 2200 });
    groundStory.push({ id: `panel:R${j}`, kind: 'panel', center: [W - 0.125, cy, -j * 3 - 1.5], half: [0.125, h / 2, 1.45], mass: 2200 });
  }
  for (let b = 0; b < bays; b++) groundStory.push({ id: `panel:B${b}`, kind: 'panel', center: [b * 3 + 1.5, cy, -D + 0.125], half: [1.45, h / 2, 0.125], mass: 2200 });

  const props: PropSpec[] = [
    // Shop on the ground floor
    prop('shelf:g0', 'steel_frame_shelves_01', 2.2, -8.4, 0, 0, 40),
    prop('shelf:g1', 'steel_frame_shelves_01', 3.6, -8.4, 0, 0, 40),
    prop('crate:g0', 'wooden_crate_01', 7.2, -3.0, 0, 0.3, 18),
    prop('crate:g1', 'wooden_crate_01', 7.3, -3.0, 0, -0.1, 18),
    prop('box:g0', 'cardboard_box_01', 8.6, -2.2, 0, 0.5, 6),
    prop('box:g1', 'cardboard_box_01', 5.0, -6.0, 0, 0.2, 6),
    // Apartment on floor 2 (on top of the soft story), seen through the front windows
    prop('desk:1', 'metal_office_desk', 4.4, -1.6, 1, 0, 45),
    prop('chair:1', 'plastic_monobloc_chair_01', 4.2, -3.0, 1, Math.PI, 5),
    prop('sofa:1', 'Sofa_01', 8.6, -2.0, 1, Math.PI, 40),
    prop('plant:1', 'potted_plant_02', 10.8, -1.0, 1, 0, 15),
    prop('shelf:1', 'steel_frame_shelves_01', 1.4, -1.0, 1, Math.PI / 2, 40),
    prop('box:1', 'cardboard_box_01', 6.4, -1.2, 1, 0.3, 6),
    // Sidewalk in front
    prop('bench:p0', 'painted_wooden_bench', 4.5, 2.9, -1, Math.PI, 35),
    prop('planter:p0', 'planter_box_01', 9.8, 3.2, -1, 0.05, 90),
    prop('planter:p1', 'planter_box_01', 11.0, 3.25, -1, -0.05, 90),
  ];
  props[3] = { ...props[3], pos: [7.25, -3.02], lift: 0.36 }; // second crate stacked on the first

  return {
    origin: [0, 0, 0], bays, depthBays, stories, W, D,
    structure: {
      floorMass: 1.1e5, // about 1 t per square meter of floor, 108 m2
      storyHeight: STORY_H,
      targetPeriod: 0.55,
      zeta: 0.05,
      stories: [
        { label: 'Story 1 (shops)', stiffnessShare: 0.22, yieldDrift: 0.006, ultDrift: 0.035, canFail: true },
        { label: 'Story 2', stiffnessShare: 1, yieldDrift: 0.008, ultDrift: 0.05, canFail: false },
        { label: 'Story 3', stiffnessShare: 1, yieldDrift: 0.008, ultDrift: 0.05, canFail: false },
        { label: 'Story 4', stiffnessShare: 1, yieldDrift: 0.008, ultDrift: 0.05, canFail: false },
      ],
    },
    groundStory,
    props,
    slabMass: 3.0e4, wallMass: 1.0e4,
  };
}
