# Quake Street

A photoreal earthquake lab: a city street with five buildings, built with Three.js (WebGPU), Rapier physics and Poly Haven assets (CC0). It replaces the Shake Table Lab prototype, which is kept in `prototype/`.

- Plan and architecture: [docs/PLAN.md](docs/PLAN.md)
- Results and decisions for each phase: [docs/DECISIONS.md](docs/DECISIONS.md)
- Screenshots: `docs/phase0/`, `docs/phase1/`, `docs/phase2/`

## Run it

You need Node.js 22 or later.

```
npm install
npm run assets      # download the pinned Poly Haven assets (about 140 MB) into public/assets/polyhaven
npm run dev         # open the URL it prints
```

Phase 2 is the full street: five buildings that each sway at their own rhythm, street furniture, power lines, a filler city in the haze, and four times of day. Building 2 (apartments over shops) collapses in the quake. Press **Start quake**, or open `/#test=1&run`.

Page options:
- `?time=midday|clear|golden|overcast` picks the sky (also on screen).
- `?post=0` turns off ambient occlusion and temporal antialiasing.
- `?gl=1` forces WebGL2. `?csm=0` uses a single shadow map.
- `?shadows=full` makes every facade cast its own shadow instead of the box proxies.
- `?lod=0` turns off the far facade LODs. `?simplify=0` loads models at full detail.
- `?filler=0` hides the filler city.

## Checks

```
npm test               # Vitest: physics math, runs in Node
npm run typecheck
npm run e2e            # Playwright: runs the quake in a headless browser, saves screenshots to test-results/
npm run bench:physics  # Rapier benchmark (Phase 0 spike)
npm run kit            # rebuild the facade kit catalog in src/world/kits/
```
