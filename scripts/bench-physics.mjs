// Phase 0 spike: how fast does Rapier step a debris-heavy scene?
// 1,500 dynamic boxes (rubble sized) in piles on a kinematic ground that shakes like a quake.
// Runs the same scene on Rapier 0.19.3 and 0.21.0 (SIMD builds) and prints ms per step.
// Usage: node scripts/bench-physics.mjs [bodies] [seconds]
const BODIES = +(process.argv[2] ?? 1500);
const SECONDS = +(process.argv[3] ?? 8);
const DT = 1 / 120;

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

async function bench(label, mod) {
  const RAPIER = mod.default ?? mod;
  await RAPIER.init({});
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 4;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0).setFriction(0.7), ground);
  const r = rng(20261012);
  const bodies = [];
  // 10 piles, like rubble from 10 failed wall panels.
  for (let i = 0; i < BODIES; i++) {
    const pile = i % 10, k = Math.floor(i / 10);
    const x = (pile - 4.5) * 5 + (r() - 0.5) * 2, z = (r() - 0.5) * 2, y = 0.3 + k * 0.35;
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z));
    const s = 0.1 + r() * 0.2;
    world.createCollider(RAPIER.ColliderDesc.cuboid(s, s * 0.7, s * 1.2).setDensity(2400).setFriction(0.6), b);
    bodies.push(b);
  }
  const steps = Math.round(SECONDS / DT);
  const times = [];
  for (let n = 0; n < steps; n++) {
    const t = n * DT;
    const env = Math.min(1, t / 1.5) * (t < SECONDS - 2 ? 1 : 0.2);
    const x = 0.12 * env * (Math.sin(2 * Math.PI * 1.3 * t) + 0.5 * Math.sin(2 * Math.PI * 2.9 * t + 1));
    ground.setNextKinematicTranslation({ x, y: 0, z: 0.5 * x });
    const t0 = performance.now();
    world.step();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  const asleep = bodies.filter(b => b.isSleeping()).length;
  world.free();
  console.log(`${label.padEnd(16)} bodies ${BODIES}  mean ${mean.toFixed(2)} ms  p95 ${p95.toFixed(2)} ms  max ${times.at(-1).toFixed(2)} ms  asleep at end ${asleep}`);
  return { label, mean, p95 };
}

await bench('rapier 0.19.3', await import('@dimforge/rapier3d-simd-compat'));
await bench('rapier 0.21.0', await import('rapier-next'));
console.log(`budget: a 120 Hz step must stay well under ${(1000 / 120).toFixed(1)} ms (2 steps per 60 fps frame)`);
