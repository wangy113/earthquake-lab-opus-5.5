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
