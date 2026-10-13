# Quake Street

A photoreal earthquake lab: a city street with five buildings, built with Three.js (WebGPU), Rapier physics and Poly Haven assets (CC0). It replaces the Shake Table Lab prototype, which is kept in `prototype/`.

- Plan and architecture: [docs/PLAN.md](docs/PLAN.md)
- Results and decisions for each phase: [docs/DECISIONS.md](docs/DECISIONS.md)
- Screenshots: `docs/phase0/` to `docs/phase3/`

## Run it

You need Node.js 22 or later.

```
npm install
npm run assets      # download the pinned Poly Haven assets (about 140 MB) into public/assets/polyhaven
npm run dev         # open the URL it prints
```

Phase 3 (in progress) lets you pick the quake: a near or far preset, or size, distance and ground type, with a seismograph that marks the P and S waves. Phase 2 built the full street: five buildings that each sway at their own rhythm, street furniture, power lines, a filler city in the haze, and four times of day. Building 2 (apartments over shops) collapses in the quake. Press **Start quake**, or open `/#test=1&run`.

Page options:
- `?quake=near|far`, or `?m=6.5&d=12&site=rock` (also on screen), plus `?seed=N`. `?quake=phase1` plays the Phase 1 record.
- `?time=midday|clear|golden|overcast` picks the sky (also on screen).
- `?post=0` turns off ambient occlusion and temporal antialiasing.
- `?gl=1` forces WebGL2. `?csm=0` uses a single shadow map.
- `?shadows=full` makes every facade cast its own shadow instead of the box proxies.
- `?lod=0` turns off the far facade LODs. `?simplify=0` loads models at full detail.
- `?filler=0` hides the filler city.

## Live page

The latest build is published as a private claude.ai artifact: https://claude.ai/artifact/JJKbw2vLttUXpYw97MT4Wg (only its owner and people they share it with can open it). It is republished after each step.

`npm run publish:prep -- <outDir>` builds the copy that gets published. The artifact host serves only standard web file types, so the script stores the `.hdr` and `.bin` files as base64 text, renames each `.gltf` to `.gltf.json`, and marks the manifest `packed`. `src/world/assets.ts` reads them back. It also splits the files into upload batches under the host's limits. After the first upload, an update usually only needs the new `index.html` and `assets/index-*.js`.

The artifact cannot read the query string, so URL options such as `?time=` and `?quake=` work only in the dev server. The on-screen controls cover them.

## Checks

```
npm test               # Vitest: physics math, runs in Node
npm run typecheck
npm run e2e            # Playwright: runs the quake in a headless browser, saves screenshots to test-results/
npm run bench:physics  # Rapier benchmark (Phase 0 spike)
npm run kit            # rebuild the facade kit catalog in src/world/kits/
```
