# Quake Street: plan for a photoreal earthquake lab

## Context

The Shake Table Lab prototype (one `index.html`, Three.js r181, Rapier 0.19.3, live Poly Haven API) shakes a 3-story model on a steel table in a lab hall. The new goal is to drop the table and show a real earthquake hitting a real-looking city street, as photoreal as Three.js allows, with every visible surface coming from Poly Haven. The repo `physics-gravity-virtual-lab-opus-5.5` is empty (branch `claude/practical-cerf-r1owez`, no commits), so this is a new project that ports the proven parts of the prototype.

**Is it possible? Yes.** Checked against the live Poly Haven API on 2026-10-12:
- **Building kits (Hidden Alley collection):** `modular_urban_apartments_facade` (147 pieces) and `modular_factory_facade` (192 pieces, brick). They include wall panels with window and door holes, separate window and door inserts with glass, corners, piers, and base, dado, cornice and crown trims. Everything sits on a 3 m grid with 3 m floor-to-floor. Each piece's pivot is its bottom-right corner on the facade plane, facing +z. Most wall panels are single planes with no thickness.
- **Street kit:** street lamps, fire hydrant, electricity poles with cables, utility boxes, manhole cover, concrete road barriers, street seating, trash can, planter boxes, rollershutter shopfronts, fire escape, gutters, AC units, air ducts, chainlink fence, covered car.
- **Interiors:** desks, chairs, sofas, shelves, cabinets, tables, lamps, plants, boxes, crates.
- **Damage textures:** `rubble`, `broken_wall`, `concrete_debris`, `brick_gravel`, `cracked_concrete`, `cracked_concrete_wall`, `damaged_plaster`, `road_damaged`, `concrete_floor_damaged_01`.
- **Lighting:** about 160 outdoor street and city HDRIs. Several have an unclipped sun: `wide_street_01`, `wide_street_02`, `german_town_street`, `crosswalk`. There are also 59 pure-sky HDRIs.
- **Gaps to design around:**
  - Cars: there are none, apart from the covered car.
  - People: there are none, which suits the subject.
  - Glass: there are no glass textures.
  - Trees: street trees run to millions of triangles. Only `jacaranda_tree`, at 312k, is usable.
  - Design response: make it a pedestrian street and plaza with no traffic. Glass is procedural, and the greenery is one hero tree plus planters.
- **API terms:** the API is free for any use. Requests must name the app in a User-Agent header. Live use needs a "Powered by Poly Haven" credit. Downloaded assets are CC0.

**Decisions confirmed:**
- Scene: a street with five buildings.
- Setup: Vite with TypeScript.
- Hardware: the demo laptop comes first, and a Chromebook tier is added in Phase 7.
- Branch: all work goes on `claude/practical-cerf-r1owez`.

## The experience

It is a sunny pedestrian street with five buildings side by side, facing a plaza where the camera starts at eye height.

1. Pick a quake (size, distance, ground type) and any retrofits, then press Start.
2. The seismograph shows the P wave arrive first, a light vertical rattle.
3. The S wave and surface waves follow with strong sway, and each building sways at its own rhythm.
4. Depending on the quake, any of these can happen:
   - Glass rains down.
   - The brick parapet falls.
   - The soft first story gives way.
   - The mid-rise pancakes.

   Dust rolls down the street.
5. Replay any moment in slow motion from any camera, including from inside an apartment.

The table below shows the building lineup. Periods are tuned in Phase 3, and every Real world anchor needs a primary source before students see it.

| # | Building | Kit | Stories | Natural period | How it fails | Real world anchor |
|---|---|---|---|---|---|---|
| 1 | Old brick store | factory facade (brick) | 2 | about 0.2 s | parapet and walls peel into the street | URM damage, Loma Prieta 1989 |
| 2 | Apartments over shops | apartments + rollershutters | 4 | about 0.5 s | ground story collapses (soft story) | Northridge Meadows, 1994 |
| 3 | Mid-rise apartments | apartments | 12 | about 1.2 s | mid-height floors pancake on soft ground | Mexico City, 1985 |
| 4 | Glass office tower | procedural curtain wall | 20 | about 2.5 s | big sway and glass fallout, stays up | none |
| 5 | Fire station on isolators | apartments, repainted | 4 | about 2.5 s isolated | rides it out, may hit its moat on soft ground | USC University Hospital, Northridge 1994 |

Two signature scenarios carry the core lesson: the same street gets opposite outcomes.
- **Near quake on rock:** short, sharp shaking. Buildings 1 and 2 fail, 3 cracks, and 4 and 5 are fine.
- **Far, large quake on soft ground:** long, rolling shaking. Building 3 resonates and collapses, 4 sheds glass, 5 swings out to its moat, and 1 and 2 mostly survive.

## Architecture

### Stack (exact versions pinned in package-lock)
- **three 0.186.1:** `WebGPURenderer` with TSL, and its automatic WebGL2 fallback. Post-processing uses `RenderPipeline`, the r186 name for PostProcessing.
- **Rapier:** `@dimforge/rapier3d-simd-compat` 0.19.3, the same API the prototype used. Version 0.21.0 (released 2026-09-25) is benchmarked in Phase 0 and adopted only if it passes.
- **Tooling:** Vite 8 with TypeScript, plus Vitest and Playwright. Chromium is preinstalled at `/opt/pw-browsers`.
- **Asset optimization:** `@gltf-transform/cli` 4.x for meshopt compression, simplified LODs, and KTX2 or WebP textures.

### Four simulation layers

```
per frame:  1 Ground motion -> 2 Structure (1 kHz) -> 3 Rapier (120 Hz) -> sync -> FX and audio -> recorder -> render
```

1. **Ground motion (`sim/quake`)**
   - Builds a seeded, random 3-component record:
     - a vertical P phase
     - a horizontal S phase
     - a long-period surface phase
   - The record is filtered for the site class (rock, firm or soft) with a Kanai-Tajimi filter and shaped with an envelope.
   - It is baseline-corrected so it ends with zero velocity and zero displacement, then scaled to the target PGA.
   - It outputs acceleration for the structure and displacement for Rapier. Each building gets a small time lag, as if a wave crossed the street.
2. **Structure (`sim/structure`)**
   - **Model:** each building is a shear-building model in x and z, with one mass per floor. This is the prototype's model extended to N floors.
   - **Story springs:** Bouc-Wen hysteresis with stiffness and strength degradation. P-Delta is included, so collapse emerges when a story loses its restoring force. Damping is 5% Rayleigh.
   - **Extras:** the isolated building gets an extra base degree of freedom (DOF) with bilinear bearings and a moat stop. Gap contact between neighbors models pounding.
   - **Solver:** explicit central difference at 1 kHz. This is stable with a wide margin and cheap at under 300 DOF.
   - **Periods:** modal analysis (ported from `eigSym`) gives each building's natural periods. Stiffness is scaled until the first period hits the building's target.
3. **Rigid bodies (`sim/physics`, Rapier)**
   - **Before failure:** the ground is one kinematic body. Each floor slab is a kinematic body posed from layer 2 every step. Furniture and props are dynamic, so they slide and topple on the floors through friction.
   - **When a story fails:**
     - The floors above it become one dynamic compound "upper block" (`setBodyType`).
     - The failed story's columns spawn as pieces (ported from `failStory`).
     - Impacts can split the upper block floor by floor, which gives the pancake.
   - **Debris:** detached facade panels and pre-fractured chunks become dynamic. Settled debris is frozen into fixed bodies, so step cost stays flat.
   - **Events:** Rapier contact-force events drive sound, dust and further damage.
4. **Rendering (`render/`, `world/`)**
   - Each building's facade is merged by material into a few meshes. Every vertex carries `storyIndex`, `storyT` and `panelId`.
   - A small data texture holds floor offsets and panel visibility. The vertex shader blends between floor i and floor i+1, so each panel shears with its own story.
   - This needs no CPU work per frame and runs on both WebGPU and the WebGL2 fallback.
   - A detached panel is hidden through its visibility flag. A "loose pieces" instanced mesh then draws it where Rapier puts it.

**Rule:** `sim/` never imports rendering code. It runs in the browser, in Node for tests, and in a worker later if profiling demands it.

### Buildings from the kits
- **`scripts/build-kit.mjs` (offline):**
  - Splits each kit GLB into pieces and writes `kits/*.json` with each piece's role, size, pivot and opening rectangle.
  - Gives the zero-thickness wall planes a 0.25 m thickness. The inner face uses a Poly Haven plaster texture.
  - Makes LOD1 and LOD2 versions and simple box shadow proxies.
- **`world/buildingGen.ts`:** turns a `BuildingSpec` (type, stories, bays, kit, tint, retrofit, isolation) into two things:
  - the visuals: facade, slabs, columns, interior partitions on visible floors, roof props
  - the matching structural model
- **Tower:** its glass curtain wall is procedural. The mullions use Poly Haven `metal_plate` and the glass uses `MeshPhysicalNodeMaterial`.

### Photoreal rendering (`render/`)
- **Sky and light:** a Phase 0 A/B test decides between two options:
  - **(A)** An urban HDRI with an unclipped sun as the background, through `GroundedSkybox`, plus image-based lighting from the same HDRI.
  - **(B)** A pure-sky HDRI as the background, with a 3D filler city fading into aerial haze and a reflection probe captured from the scene.

  The default is (B). It holds up from the drone camera, and everything in view shakes together.
- **Sun:**
  - Port `placeSun()` and estimate the sun's intensity from the HDRI.
  - Clamp the sun out of the environment map before PMREM, so the scene is not lit twice.
  - Cast sun shadows with `CSMShadowNode` (3 to 4 cascades). The facades use box shadow proxies.
- **Post (`RenderPipeline`), in order:**
  1. MRT scene pass (color, normal, velocity, depth)
  2. GTAO
  3. SSR, for glass and polished surfaces
  4. SSGI, Cinematic tier only
  5. TRAA
  6. Motion blur
  7. Bloom
  8. Depth of field, cinematic cameras only
  9. 3D LUT grade, film grain and vignette
  10. AgX tone mapping
- **Materials:**
  - Poly Haven PBR sets (diff, nor_gl, arm), with parallax from the displacement maps on hero surfaces.
  - Triplanar mapping on fracture faces, which need no UVs.
  - Damage blends the facade toward `cracked_concrete_wall`, `damaged_plaster` or `broken_wall` through a noise mask that grows with story damage.
  - After a collapse, up-facing surfaces gather dust.
- **Textures:** KTX2 (ETC1S for color, UASTC for normals) when KTX-Software is installed, otherwise WebP. There are 1k and 2k sets, chosen by tier. For reference, the two kits weigh about 17 MB each at 1k and 41 to 50 MB each at 2k before optimization.
- **Time of day:** presets come from pure-sky HDRIs:
  - `kloofendal_48d_partly_cloudy_puresky` for midday
  - `autumn_field_puresky` for clear sky
  - `table_mountain_1_puresky` for golden hour
  - `kloofendal_overcast_puresky` for overcast

### Destruction
- **Pre-fracture:** `scripts/prefracture.mjs` splits the thickened panels and slab segments into 6 to 12 convex Voronoi chunks offline. Each chunk gets a Rapier convex hull collider.
- **Failure modes:**
  - **Soft story:** the ground story fails and the upper block drops.
  - **Pancake:** a mid-story fails and impacts trigger a floor-by-floor cascade.
  - **Unreinforced masonry (URM), out of plane:** a panel's anchor breaks when its inertial force passes its capacity. Rapier then simulates the panel rocking and toppling.
  - **Glass fallout:** windows fail when story drift passes a glazing limit.
  - **Nonstructural:** parapets, AC units, signs, lamps, and poles with power lines that throw sparks.
- **Particles:** glass shards and small rubble are GPU particles. Their motion is computed in the vertex shader, so they use no Rapier and work on both backends.
- **Budgets:** at most about 1,500 active dynamic bodies, bodies frozen once they sleep, and a cap on spawns per frame.

### Learning layer (ports the prototype's framework)
- **Control room:** quake size, distance, ground type, retrofits, camera, time of day.
- **Instruments:**
  - a 3-channel seismograph with P and S picks and the S-P distance
  - PGA
  - each building's period, roof drift and damage pill
- **Carried over from the prototype:** guided tests with Real world and Model tags, the Text version, About with sources, deep links, and `window.__lab` hooks.
- **Writing rules:** on-screen text has no em dashes, no semicolons and no middle dots, and `scripts/check-copy.mjs` enforces this.

### Repository layout

```
index.html
src/main.ts
src/config/     tiers.ts, scenarios.ts
src/sim/        clock, rng, quake/, structure/, physics/, destruction/, events.ts   (no rendering imports)
src/world/      assets.ts, kit.ts, buildingGen.ts, street.ts, props.ts, interiors.ts, filler.ts
src/render/     renderer.ts, lighting.ts, pipeline.ts, materials/, sync.ts
src/fx/         dust.ts, particles.ts, sparks.ts, camera.ts
src/audio/      sound.ts
src/replay/     recorder.ts
src/ui/         control room, instruments, seismograph, guide, modals
src/content/    tests.ts, sources.ts
src/debug/      lab.ts (window.__lab, deep links, perf stats)
scripts/        fetch-polyhaven.mjs, build-kit.mjs, optimize-assets.mjs, prefracture.mjs, check-copy.mjs
assets.config.json   pinned Poly Haven ids, resolutions and roles
public/assets/       vendored CC0 assets (generated)
tests/sim/ (Vitest)   tests/e2e/ (Playwright)
prototype/      the original index.html and HANDOFF.md, for reference
docs/           ARCHITECTURE.md, DECISIONS.md, HANDOFF.md
```

### What carries over from the prototype

| Prototype code | New home | Change |
|---|---|---|
| `phFiles`, `phMat`, `phModel` (include-map URL modifier) | `scripts/fetch-polyhaven.mjs`, `world/assets.ts` | Assets download at build time with a User-Agent and md5 check. The live API is only a dev fallback, shown with a credit. |
| `placeSun`, `loadHall` | `render/lighting.ts` | Adds a sun intensity estimate and the environment clamp. |
| `tiledBox` | `world/geometry.ts` | Same world-unit UVs, used for slabs, columns and curbs. |
| `eigSym`, `computeNatBeat` | `sim/structure/modal.ts` | N floors, a mass matrix and target-period scaling. |
| `rng`, `makeQuake` (baseline fix, peak scaling) | `sim/quake/` | Three components, wave phases and site filters. |
| `applySprings`, `failStory` | `sim/structure/`, `sim/destruction/collapse.ts` | The springs move to the 1 kHz solver. Failure spawns the pieces and the upper block. |
| `detectImpacts` | `sim/physics/world.ts` | Uses Rapier contact-force events. |
| Dust sprites, Web Audio | `fx/dust.ts`, `audio/sound.ts` | Soft GPU particles and more sound layers. |
| `record`, `applyFrame`, replay UI | `replay/recorder.ts` | Records quantized tracks for moving objects only, over 30 s. |
| Chart, stories UI, `STOPS`, modals, deep links, `__lab` | `ui/`, `content/`, `debug/` | Same framework, new content. |

## Phases

Each phase ends with something runnable and a check. Demo checkpoints come at the end of Phases 1, 2 and 5.

**Phase 0. Foundations and spikes**
- Scaffold the project (Vite, TypeScript, lint, Vitest, Playwright) and commit the prototype under `prototype/`.
- Write `assets.config.json` and `fetch-polyhaven.mjs`. Make `build-kit.mjs` catalog both kits and assemble a test facade 4 bays wide and 3 stories tall.
- Spikes:
  - HDRI strategy A against B.
  - Facade budget (triangles and draw calls) with merged meshes and LODs.
  - Rapier 0.19.3 against 0.21.0 (SIMD), with 1,500 bodies on shaking kinematic ground.
- Check: decisions are in `docs/DECISIONS.md`, the test facade renders cleanly, and frame and physics timings are recorded.

**Phase 1. Vertical slice (first boss demo)**
- One street corner with a few props, and building 2 (soft story) with furniture on floor 2.
- Port `makeQuake` as a stopgap. Use a linear shear model and kinematic floors, with soft-story collapse through the upper block. Port the dust and sound.
- Baseline photorealism: HDRI, sun, CSM, GTAO, TRAA and AgX.
- Check: `#test=1&run` collapses the ground story the same way on every run, at 60 fps on the demo laptop.

**Phase 2. The full street, photoreal**
- All five buildings and the plaza, with street props, power lines, the filler city, and interiors on visible floors.
- The story-skinning shader on every building, LODs, shadow proxies, KTX2 and the time-of-day presets.
- Check: screenshots of the street at rest, taken from fixed camera bookmarks, hold up next to a real street photo. Each tier meets its frame budget.

**Phase 3. Earthquake science**
- The full ground-motion model and a seismograph with P and S picks.
- Bouc-Wen, P-Delta, isolation and pounding, with modal periods shown on the instruments.
- A "pluck" test: push one building and let go to see its own rhythm.
- Optional: add one or two real recordings with sources.
- Check: Vitest passes the analytic checks below, and the two signature scenarios give the outcomes in the lineup table.

**Phase 4. Destruction depth**
- The pre-fracture pipeline, URM peel, pancake cascade, glass fallout, nonstructural failures and sparks.
- Damage blending and debris freezing.
- Check:
  - The body budget holds at peak collapse.
  - 30 s at rest without shaking moves nothing. This settles the open wall bug from the handoff.
  - Debris piles do not jitter.

**Phase 5. Cinematic layer**
- Dust as GPU particles, plus a dust volume with god rays on the Cinematic tier.
- Camera rigs:
  - eye level
  - drone
  - rooftop across the street
  - inside an apartment
  - high-speed side view
- Depth of field and motion blur, sound layers, and replay with slow motion and scrubbing.
- Check: a scripted `#cinematic` run plays smoothly start to finish on the demo laptop.

**Phase 6. Learning layer and accessibility**
- Guided tests:
  1. The waves arrive
  2. Every building has a beat
  3. Soft ground
  4. The weak first floor
  5. Old brick
  6. Bend or float
  7. What falls first, with Drop, Cover, and Hold On
- Instruments, the Text version, About with sources, and a short content note: buildings collapse, and no people are shown.
- Accessibility:
  - focus traps in modals
  - keyboard control
  - reduced motion, with no camera shake and no flashes
  - captions for sounds
  - a contrast check on the stress colors
- Check:
  - Every Real world claim has a verified primary source, including the open SF City Hall claim.
  - `check-copy.mjs` passes.
  - All the guided tests can be run with the keyboard only.

**Phase 7. Production**
- Tiers, detected automatically, with a `?tier=` override:
  - Cinematic
  - Balanced
  - Chromebook: 1k textures, DPR 1, one shadow map or none, FXAA only, and a cap of 400 debris bodies
- Fully offline, with no live API calls, and with size budgets.
- Deploy to GitHub Pages through Actions and embed in Canvas. Add the credits page, the course objective, the Canvas activity, and `docs/HANDOFF.md`.
- Check: the Chromebook tier holds 30 fps on a school Chromebook, and the first view loads within the agreed time on the school network.

## Verification

- **`npm run test`** (Vitest, Node, no browser) checks that:
  - A single-mass oscillator's free-vibration period is within 1% of 2π√(m/k). Its damping decrement matches ζ, and its resonance amplification is about 1/(2ζ).
  - The periods of a uniform shear building match the closed-form result.
  - The ground motion ends with near-zero velocity and displacement and hits its target PGA, and on soft soil its spectrum peaks near the site period.
  - Bouc-Wen loops dissipate positive energy, and degradation only ever increases.
- **`npm run e2e`** (Playwright, Chromium from `/opt/pw-browsers`) uses the WebGL2 fallback in headless mode. Deep links run each guided test, and assertions go through `window.__lab` (which story failed, and when). It also covers rest stability, a replay round trip, and no console errors.
- **`npm run check:copy`** fails if any on-screen string contains an em dash, a semicolon or a middle dot.
- **`npm run perf`** logs frame time and physics step time for each tier and compares them with the budgets.
- **Manual:** a screenshare dry run on the demo laptop before each demo checkpoint.
