# HANDOFF: Shake Table Lab (proof of concept)

Last updated: 2026-10-12

## What it is
A single-file 3D earthquake lab (`index.html`). The user picks a building (bare frame, braced, base isolated) and the shaking (steady, sweep, quake), presses Shake, and watches the building crack and collapse. Any collapse can be replayed in slow motion. It is a mockup to show the user's boss over screenshare on a laptop. It is not production-ready.

## Stack
- Three.js 0.181.2 (jsDelivr import map): OrbitControls, HDRLoader, GroundedSkybox, GLTFLoader.
- Rapier 3D compat 0.19.3 (`rapier.mjs`, default export, `await RAPIER.init({})`).
- Poly Haven assets are loaded live from `api.polyhaven.com/files/<id>`, which serves CORS `*`. The GLTF textures sit in a different folder from the `.gltf`, so `phModel()` uses a `LoadingManager.setURLModifier` with the API `include` map.
  - HDRIs, 2k: `aircraft_workshop_01` (default), `hangar_interior`, `industrial_workshop_foundry`. `GroundedSkybox` height is 3.2.
  - Textures, 1k: `brushed_concrete`, `concrete_floor_worn_001`, `metal_plate`, `blue_metal_plate`, `concrete_floor_02`.
  - Models, 1k: desk, chair, box, crates, tool cart, searchlight, extinguisher, storage cart, toolbox.
- Run it with `python -m http.server` in the folder and open `http://localhost:<port>/`. Deep links: `#stop=N`, and `#stop=N&run` starts that test.

## How the physics works
- **The building is a shear-building model.** There are three 4,000 kg slabs, and a custom spring and damper per story, applied as Rapier impulses at 240 Hz in `applySprings()`. Each story has horizontal, vertical and rotational stiffness.
  - Natural beats: bare frame about 1.2 Hz, braced about 2.9 Hz, isolated about 0.4 Hz.
  - The model eigenvalues are in `computeNatBeat()`.
- **Damage and failure:** damage builds up past `yieldR`. When a story passes `ultR`, `failStory()` hides its columns and spawns real Rapier pieces (split columns plus concrete chunks), and the floors above fall.
- **Moving parts:** the table is a kinematic body. The block wall and the furniture are free dynamic bodies.
- **Sound and dust:** impact sound and dust are triggered when a body's velocity changes suddenly, in `detectImpacts()`. Sound is Web Audio with no files.
- **Replay:** the last 15 s of every `dyn` child transform is recorded and played back with interpolation and scrubbing. Events (cracks, impacts) are replayed too.

## Verified in headless Chrome (2026-10-12)
- **Steady and sweep tests:**
  - The sweep collapses the bare frame at about 1.14 Hz.
  - The braced frame survives the sweep with cracking.
  - Steady shaking at 3 Hz does nothing to the bare frame.
- **Quake tests:**
  - The quake collapses the bare frame 6.5 s in.
  - The isolated building rides out the quake.
- **Replay and frame rate:** Replay works. It runs at 60 fps while shaking.
- **Not re-checked:** the last change made the block wall 0.18 m thick and lets its blocks sleep at rest, after a 0.14 m wall fell over by itself. Its re-test was cut off, so confirm the wall still stands at rest.

## Writing rules
On-screen text has no em dashes, no semicolons and no middle dots.

Real-world claims are tagged. The San Francisco City Hall base isolation claim still needs a primary source.

## If it goes to production
- Vendor the libraries, and download the Poly Haven assets locally instead of relying on the live API.
- Split the code into modules.
- Do an accessibility pass: focus traps in modals, and check the stress-color contrast.
- Add a Chromebook performance mode: 1k HDRI, no shadows, DPR 1.
- Attach a course objective and a Canvas activity.
