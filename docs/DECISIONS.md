# Phase 0 decisions

Measured on 2026-10-12 in the cloud dev container: 4 CPU cores, headless Chromium 141 with SwiftShader (software GPU). Physics timings are real CPU numbers. Frame rates from this container mean nothing, because there is no GPU. Re-measure fps on the demo laptop before Phase 1 ends.

## 1. Versions

| Package | Version | Why |
|---|---|---|
| three | 0.186.1 | Has every node the plan needs: `RenderPipeline` (renamed from PostProcessing), GTAO, TRAA, SSR, SSGI, CSM. |
| @dimforge/rapier3d-simd-compat | 0.19.3 | Faster than 0.21.0 in our benchmark (below) and the same API as the prototype. |
| vite | 7.1.12 | The plan said Vite 8. Vite 8 patch releases were still landing days apart this month, so 7.1 stays until 8 settles. Nothing in the code depends on the major version. |

## 2. Physics: stay on Rapier 0.19.3, budget about 800 active bodies

`npm run bench:physics -- <bodies> 8` runs rubble boxes in 10 piles on kinematic ground shaking for 8 s at 120 Hz. This is worse than any real collapse, because nothing gets to sleep.

| Bodies | Rapier 0.19.3 mean / p95 | Rapier 0.21.0 mean / p95 |
|---|---|---|
| 800 | 4.2 / 5.9 ms | 5.7 / 9.6 ms (one 129 ms spike) |
| 1,500 | 9.5 / 17.3 ms | 11.3 / 18.3 ms (one 108 ms spike) |

What this means for the build:
- **Step budget:** a 120 Hz step has to stay under about 4 ms, because two steps fit in a 60 fps frame alongside rendering.
- **Active bodies:** the active-body cap drops from about 1,500 in the plan to about 800. Above that, freezing settled debris and moving small rubble to GPU particles stop being optional.
- **Fallback:** if collapse-heavy tests still miss the budget on the demo laptop, move Rapier to a Web Worker. `sim/` already has no rendering imports, so it can move. Running debris at 60 Hz is the cheaper fallback.
- **Rapier 0.21.0:** worse mean times and the large spikes rule it out for now. Re-test when 0.21.1 or later ships.

## 3. Facade kits: the catalog matches the plan, with two corrections

`npm run kit` writes `src/world/kits/*.json`.
- **What matches the plan:**
  - Both kits use 3 m bays and 3 m stories.
  - Each piece's pivot is its bottom-right corner seen from outside, and pieces face +z.
  - Window and door inserts pair with their wall panels by name.
- **Correction:** the plan said most wall panels are zero-thickness planes. That is true for the apartments kit (26 of its 51 walls are flat) but not for the brick factory kit (only 4 of 74 are flat). So solidifying is needed mainly for the apartments kit.
- **Note:** the `fire_hydrant` model contains two hydrants side by side. Split it in `build-kit.mjs` later.

## 4. Facade budget: merging and LODs are required, not optional

The spike building has a 4-bay front, 3-bay sides and 3 stories, with 2 lamps and a hydrant. It draws:
- **Triangles:** about 283k per pass, measured as 566k for the main pass plus one shadow map.
- **Draw calls:** about 164 per pass.
- **With 3 CSM cascades and the post pre-pass:** 1.4M triangles and 819 draw calls.

The full street has about 10 times this facade area, so the plain kit path would be well over 10M triangles a frame. Commitments for Phase 2:
1. **Merge by material:** merge each building's facade per material (5 materials per kit) with per-vertex story attributes, as planned. This takes about 160 draw calls per building down to about 5.
2. **Shadow proxies:** let only simple box proxies cast shadows. The kit meshes receive shadows but do not cast them. This removes most of the 3x CSM cost.
3. **LODs:** generate LOD1 and LOD2 with meshopt simplify for anything more than about 25 m from the camera.
4. **Props:** decimate the heavy ones (`fire_hydrant` is 86k triangles, each lamp 30k).

## 5. Sky strategy: B by default, A kept as an option, decided on real hardware

Screenshots are in `docs/phase0/`.
- **A (`wide_street_01` as backdrop):** at eye level it already reads as a real place. Real trees, towers and power lines sit behind our building.
- **B (pure sky plus our own ground):** cleaner and works from any height. On its own it looks empty, so it needs the filler city planned for Phase 2.

The plan's choice stands: B is the default, because the drone and rooftop cameras rule out A above about 15 m. Keep A as a "street level" preset for the Phase 1 demo if B plus filler is not ready. The final call is made on the demo laptop.

## 6. Two compatibility findings, both handled in code

- **Black surfaces on the WebGL fallback:** a 32-bit float HDRI turned every lit surface black. Float32 textures cannot be filtered without `OES_texture_float_linear`, which SwiftShader lacks, and so do some real devices. HDRIs now load as half float (`src/render/lighting.ts`).
- **WebGPU errors in older Chrome:** three r186 passes `swizzle: 'rgba'` on every texture view, and Chromium 141 rejects it with an error every frame. `src/render/renderer.ts` now probes for this and falls back to WebGL2. Current Chrome should pass the probe. Confirm on the demo laptop that the status line says `WebGPU`.

## 7. Open items for Phase 1

- **Sun shadows are too weak.** The building's own shadow barely shows. Tune sun intensity against the HDRI and clamp the sun out of the environment map, as the plan says.
- **The plaza pavement is washed out.** Adjust the texture scale and tint.
- **The windows read as flat.** Add inner rooms or interior mapping (Phase 2 or later).

## 8. Assets stay out of git for now

The plan says to vendor the Poly Haven assets. For now `public/assets/polyhaven/` is gitignored and rebuilt with `npm run assets`. The fetch is pinned by asset ID and verified against the API's md5 checksums. This keeps the repo small while the asset list keeps changing. Phase 7 decides whether the optimized assets get committed or are fetched in the deploy workflow.

# Phase 1 notes (vertical slice)

Screenshots are in `docs/phase1/`. `npm test` and `npm run e2e` cover the slice.

## What was built

- **Simulation core (`src/sim/`):**
  - A synthetic quake, ported from the prototype.
  - A shear-building model with damage and P-Delta, at 960 Hz.
  - A Rapier scenario at 120 Hz. The ground and the floor slabs are driven bodies, so furniture slides on them.
  - When the shop story fails, floor 1 becomes dynamic and takes over the floors above as one falling block. The shop story's columns, walls and shutters become debris.
- **Visuals (`src/world/softStoryVisual.ts`):**
  - Upper stories are kit facades merged per material: 5 draw calls per story instead of about 160.
  - A shader blends each wall between the floor below and the floor above (the "story skinning" from the plan).
- **Page:** controls, instruments, dust and procedural sound (ported), three camera views, and the `#test=1&run` deep link.

## Measured behavior (Node, deterministic)

- First period 0.55 s, as targeted.
- The shop story starts cracking at about 3 s and fails at 6.0 s.
- The upper block falls, crushes the debris, and settles 2.3 m lower, tilted about 14 degrees.
- Two runs give identical results.
- 20 s at rest with no quake: nothing moves.
- The browser run matches to within 2 cm (2.33 m against 2.35 m). The page lets furniture settle with a slightly different number of steps before the quake, so the starting state is not bit-identical. Tests compare within a run environment, not across them.

## Choices made on the way

- **Crushed pieces pass through the block for 0.5 s.** Without this, the shop walls and 40 kg shelves held up a 160 t block, because Rapier's contacts treat them as solid. For 0.5 s they ignore the falling block while they topple outward, then they collide normally and the block lands on the debris pile. The same applies to the shop contents.
- **Block mass is reduced.** Real floors here weigh about 110 t each. The block uses 40 t per floor (30 t slab plus 10 t walls), because Rapier stays stable with smaller mass ratios against 1 to 2 t debris. The structure model still uses the real 110 t.
- **Only story 1 can fail in Phase 1.** Pancake and multi-story failure come in Phase 4.
- **Prop sizes come from Poly Haven's dimensions, and models are scaled to fit them.** `steel_frame_shelves_01` loads 10 times too large.

## Bugs found and fixed

- In the frame where the collapse happens, the sync looked up floor bodies that had just been merged into the block, which crashed. It is now guarded.
- The block's visual frame was taken from the physics body after it had already moved, which left the upper walls floating. It is now taken from the drawn floor-1 slab before the step, and events are handled before sync.

## Open for Phase 2

- **Side walls when they topple:** they show their plain plaster backing, with no breakage detail.
- **Modular props:** `modular_street_seating` holds several bench variants side by side. Pick a single piece.
- **No frame rate yet:** fps is still unmeasured on real hardware.

# Phase 2 notes (the full street)

Screenshots are in `docs/phase2/` (960 x 540, rendered in the container with SwiftShader, so no GPU effects tuned on real hardware yet). `npm test` (12 tests) and `npm run e2e` cover the street.

## What was built

- **The street (`src/sim/street.ts`):** the five-building lineup from the plan, left to right:
  1. Old brick store, x -16 to -4
  2. Apartments over shops (the Phase 1 building), x 0 to 12
  3. Mid-rise, x 12.5 to 27.5, half a meter from building 2
  4. Glass tower, x 32 to 50
  5. Fire station, x 55 to 67, with its moat plates

  In front: a 4 m sidewalk, an 8 m road one curb (15 cm) lower, then a 28 m plaza. Rapier's ground now has the curb steps too.
- **Every building sways:** each of the four new buildings has its own shear-building model, tuned to its target period (0.2, 1.2, 2.5 and 0.4 s). Each story is also a driven box in Rapier, so debris from building 2 hits building 3 instead of passing through it. Only building 2 can fail in Phase 2.
- **Building generator (`src/world/buildingGen.ts`):** brick store and fire station ground floor from the factory kit, mid-rise and fire station upper floors from the apartments kit, and a procedural curtain wall for the tower, because Poly Haven has no glass facade. Interiors behind the windows: room partitions, slabs, and furniture on the lower floors.
- **Whole-building shear shader:** each vertex carries its story index and the shader blends it between the floor offsets below and above it (`buildingShearMaterial`). A 12-story building is 14 draw calls instead of hundreds of separate kit pieces.
- **Repainting:** buildings 2 and 3 use the same apartments kit side by side, so building 3 is desaturated to off-white and the fire station is painted red. This is done in the shader, so the kit textures are shared.
- **Street dressing (`src/world/street.ts`):**
  - Poly Haven lamps (two styles), hydrants, trash cans, utility boxes, manhole covers, benches and planters.
  - Power poles with three sagging cables each span.
  - Road markings and a crosswalk.
  - All of it merged by material into one static group.
- **Filler city (`src/world/filler.ts`):** about 340 blocks around the street with Poly Haven facade textures and a window grid drawn in the shader, fading into exponential fog colored from the HDRI's horizon.
- **Times of day (`src/render/sky.ts`):** midday, clear, golden hour and overcast, all Poly Haven pure-sky HDRIs. The sun is measured from the HDRI itself and then clamped out of the copy used for lighting, as the plan asked.

## Sky: the sun comes from the HDRI

`analyzeSky` treats every pixel brighter than 25 times the mean sky (and at least 8) as sun. From those pixels it takes:
- **Direction:** the energy-weighted centroid.
- **Color and strength:** the excess energy times each pixel's solid angle. In three.js units this is the directional light intensity that matches the environment lighting.
- **Clamping:** those pixels are clamped to the threshold in the environment copy, so the sun is not counted twice.

Measured on the 2k files:

| Preset | HDRI | Sun irradiance | Sun elevation | Sun color |
|---|---|---|---|---|
| Midday | kloofendal_48d_partly_cloudy_puresky | 4.3 | 48 degrees | white |
| Clear | autumn_field_puresky | 5.8 | 29 degrees | white |
| Golden | qwantani_sunset_puresky | about 2.9 | 6 degrees (shadows use 9) | orange #ffb22f |
| Overcast | kloofendal_overcast_puresky | 0 | none | sky only |

- **Sun strength checks out:** Phase 1 had picked 4.2 for the midday sun by eye, and the measurement gives 4.3.
- **Golden hour changed HDRI:** the plan named `table_mountain_1_puresky` and the first try was `qwantani_late_afternoon_puresky`. That one's sun is white at 19 degrees and looked like noon. Of seven sunset skies tested, only `qwantani_sunset_puresky` has a clear orange sun.
- **Sky rotation:** each preset turns the sky (`sunFrom`) so the sun rakes across the street fronts. Several HDRIs put the sun behind the buildings, which left every facade in shadow.
- **Exposure:** it follows the light on the street partway (power 0.7), so golden hour and overcast still read darker than noon.

## Triangle budget: Phase 0 commitments 1, 2 and 4 are done, 3 partly

Per frame, all passes counted (main, AO pre-pass, three shadow cascades), plaza camera:

| Step | Triangles | Draw calls |
|---|---|---|
| First build of the street | 6.2M | 1,277 |
| After the steps below | 1.66M | 729 |

The steps:
1. **Merging by material:** done for every building, and for the street dressing.
2. **Shadow proxies:** facades of buildings 1, 3, 4 and 5 only receive shadows. One invisible box per story casts them, with the same shear shader. `?shadows=full` turns this off for comparison. Building 2 still casts its own detailed shadow, because its ground story breaks apart.
3. **Simplification at load (`meshoptimizer` 0.25.0):** every Poly Haven model and kit loses its sub-3 mm bevels on load, which takes 949k triangles down to 273k. The mid-rise alone went from 587k to 120k.
4. **Far LODs:** each building switches to a 4 cm-error version past about 70 m from its center. Building 3's far version is 85k triangles.
5. **Props:** the hydrant and trash-can models each hold two variants, so only one is kept (DECISIONS 3 note done). The modular street seating was swapped for `painted_wooden_bench`, which is 630 triangles.

Plan item 3 asked for build-time LODs with `gltf-transform`. Load-time simplification gets the same result without a second copy of the assets. Its cost on load has not been measured on real hardware. Revisit in Phase 7 if load time matters on Chromebooks.

## What was dropped, and why

- **The hero tree:** `jacaranda_tree` turned out to be 3.9M triangles and 205 MB at 1k, not the 312k the API's listing suggested. No Poly Haven tree fits the budget. The plaza uses planters instead.
- **The fire escape:** at about 9.5 m tall, it does not fit the 2-story brick store. It can come back with Phase 4's nonstructural failures.
- **KTX2 textures:** not done. KTX-Software is not installed in the container, and the textures are still 1k JPEGs (about 30 MB). This moves to Phase 7 with the other size budgets.

## Open for Phase 3 and later

- **Frame rate:** still unmeasured on a real GPU. SwiftShader runs the street at about 1 fps, the same as Phase 1's single building, so it says nothing. Please check the status line on the demo laptop.
- **The model is not yet the physics the plan asks for:**
  - The fire station is fixed-base. Its isolators and moat behavior come in Phase 3.
  - All five buildings shake with the same record at the same instant. The small delay of a wave crossing the street also comes in Phase 3.
- **Tuning, for now:** the yield drifts are set so the Phase 1 quake matches the plan's "near quake on rock" outcome. Building 2 fails, building 3 cracks, and buildings 1, 4 and 5 stay undamaged. Phase 3 tunes these properly.
- **Look:** the plaza is bare from the drone view, and the filler city's window grid repeats. Shadows and the glass tower's reflections have not been tuned on a real GPU.

# Phase 3 notes (in progress)

## Step 1: the ground-motion model (`src/sim/quake/groundMotion.ts`)

Not wired into the page yet. The Phase 1 quake still drives the street, so nothing on screen changes. 6 new tests in `tests/sim/groundMotion.test.ts`.

- **Inputs:** magnitude, distance and ground type (rock, firm or soft).
- **Output:** a 3-component record (two horizontal, one vertical) with:
  - P wave: mostly vertical, arriving first.
  - S wave: the strong horizontal shaking, arriving after the S minus P delay (0.12 s per km).
  - Surface waves: long-period rolling that grows with distance.
- **How it is made:**
  - Shaping: windowed noise, shaped by a source spectrum (corner frequency drops with magnitude), path losses (high frequencies fade with distance) and a Kanai-Tajimi site filter.
  - Integration: displacement is integrated in the frequency domain with a 4th-order high-pass, then gated and tapered, so the ground ends at rest.
  - Consistency: acceleration is the second difference of displacement, so the structure model and Rapier see the same motion.
- **Bug found by the tests:** the first version integrated in time and fixed the drift with a taper. That taper made an acceleration spike at the record's end, and the peak-acceleration scaling locked onto the spike, which shrank the real shaking about 5 times on far quakes. The response spectrum showed it: short-period response came out below the peak acceleration, which cannot happen.

Measured (seed 20261013):

| Quake | Peak horizontal / vertical | S minus P | Sa 0.55 s | Sa 1.2 s |
|---|---|---|---|---|
| M6.5, 12 km, rock | 0.39 g / 0.13 g | 1.4 s | 0.71 g | 0.41 g |
| M7.8, 120 km, soft | 0.16 g / 0.06 g | 14.3 s | 0.19 g | 0.62 g |

That is the plan's core lesson in numbers. The near quake on rock hits the 0.55 s building hardest. The far quake on soft ground hits the 1.2 s mid-rise more than three times as hard as the 0.55 s building.

- **Model values, not real-world claims:** wave speeds, the peak-acceleration rule, durations, site periods and the soil-softening rule are all tuned to give plausible shaking. Guided tests must not quote them as facts. The soft site period (1.3 s) was chosen to sit near building 3, not taken from a real basin.
## Step 2: the model drives the page

Screenshots: `docs/phase3/`.

- **Controls:**
  - Two presets, Near quake and Far quake.
  - Sliders for size (magnitude 5.5 to 8) and distance (5 to 200 km), and ground type (rock, firm or soft).
  - A hint line gives the expected peak shaking and the S minus P delay, labeled as model values.
  - The same choices work from the URL: `?quake=near|far`, or `?m=`, `?d=`, `?site=`, plus `?seed=`.
  - `?quake=phase1` still plays the old stopgap record.
- **Seismograph:** east-west, north-south and up-down traces over the last 20 s. A P and an S line mark each wave once it reaches the street. Notes announce each arrival, with the S minus P delay.
- **Vertical shaking:** the ground and every floor and story collider now move up and down too. The structure model is still horizontal only. Real buildings are very stiff vertically, so they move with the ground.
- **Wave crossing:** each neighbor gets the shaking a little later, by its distance along the street at an apparent 2 km/s (Model). That is at most 0.03 s, so it has no visible effect yet. It is in place for longer streets and for pounding.
- **Default quake:** the page now starts with the near preset instead of the Phase 1 record. The Phase 1 unit tests keep the old record, so their numbers are unchanged.

Signature outcomes, with the street's own building models. These are now unit tests:

| Quake | Building 2 | Mid-rise | Tower | Brick and station |
|---|---|---|---|---|
| Near, M6.5, 12 km, rock | fails, about 10 to 13 s in, across 3 seeds | light damage at most | undamaged | undamaged |
| Far, M7.8, 120 km, soft | survives | fully damaged (cannot fall until Phase 4) | sometimes damaged | undamaged |

The browser run with the default seed: building 2 fails 10.3 s into the record (the first 2 s are quiet lead), and the block drops 2.5 m.

- **Next steps:**
  - Base isolation and the moat for the fire station.
  - Bouc-Wen hysteresis in place of the damage-lite springs.
  - A pluck test.
  - Showing each building's period on its own label in the scene.
