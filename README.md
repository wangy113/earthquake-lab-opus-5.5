# Quake Street

A photoreal earthquake lab: a city street with five buildings, built with Three.js (WebGPU), Rapier physics and Poly Haven assets (CC0). It replaces the Shake Table Lab prototype, which is kept in `prototype/`.

- Plan and architecture: [docs/PLAN.md](docs/PLAN.md)
- Phase 0 results and decisions: [docs/DECISIONS.md](docs/DECISIONS.md)

## Run it

You need Node.js 22 or later.

```
npm install
npm run assets      # download the pinned Poly Haven assets (about 64 MB) into public/assets/polyhaven
npm run dev         # open the URL it prints
```

Phase 1 is a vertical slice: one soft-story building, one quake, one collapse. Press **Start quake**, or open `/#test=1&run`.

Page options: `?sky=a` (urban HDRI backdrop) or `?sky=b` (pure sky, the default), `?post=0`, `?gl=1` (force WebGL2), `?csm=0`, `?stories=N`.

## Checks

```
npm test               # Vitest: physics math, runs in Node
npm run typecheck
npm run e2e            # Playwright: runs the quake in a headless browser, saves screenshots to test-results/
npm run bench:physics  # Rapier benchmark (Phase 0 spike)
npm run kit            # rebuild the facade kit catalog in src/world/kits/
```
