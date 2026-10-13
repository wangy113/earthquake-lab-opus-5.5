import type RAPIER_NS from '@dimforge/rapier3d-simd-compat';
import { ShearBuilding } from './structure/shearBuilding';
import { sample, type QuakeRecord } from './quake/synthetic';
import { rng } from './rng';
import { SLAB_T, STORY_H, type SoftStoryLayout } from './building/softStory';
import { CURB_H, ROAD, type StreetBuilding } from './street';

type R = typeof RAPIER_NS;
type Body = RAPIER_NS.RigidBody;

/**
 * Phase 1 vertical slice: one soft-story building on a shaking street.
 *
 * Layers (see docs/PLAN.md):
 *  - ground motion: a QuakeRecord played back from `startQuake()`
 *  - structure: ShearBuilding at 960 Hz, 8 substeps per physics step
 *  - Rapier at 120 Hz: the ground and every floor slab are kinematic bodies posed from the
 *    two layers above, so furniture slides and topples on them by friction. When story 1
 *    fails, floor 1 turns dynamic, takes over the colliders of the floors above (the "upper
 *    block") and falls. The ground story's columns, panels and shutters turn into debris.
 *
 * No rendering imports. The renderer reads `bodies` and `events`.
 */
export const DT = 1 / 120;
const SUB = 8;
const G = 9.81;

// Collision groups (Rapier packs membership in the high 16 bits, filter in the low 16).
const BLOCK = 0x0002, DEBRIS = 0x0004;
const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
/** How long crushed ground-story pieces ignore the falling block while they get out of the way. */
const CRUSH_TIME = 0.5;

export type SimEvent =
  | { t: number; kind: 'quake-start' }
  | { t: number; kind: 'crack'; story: number; pos: [number, number, number]; building?: string }
  | { t: number; kind: 'fail'; story: number; pos: [number, number, number] }
  | { t: number; kind: 'collapse'; block: string; merged: string[] }
  | { t: number; kind: 'spawn'; id: string; from: string; half: [number, number, number]; role: 'column-half' | 'chunk' }
  | { t: number; kind: 'remove'; id: string }
  | { t: number; kind: 'impact'; p: number; heavy: boolean; pos: [number, number, number] };

export interface SimBody { id: string; body: Body; kind: 'ground' | 'floor' | 'story1' | 'prop' | 'piece' | 'neighbor'; mass: number; pv: { x: number; y: number; z: number }; cool: number }

/** A building that only sways in Phase 2: its structure model plus one driven collider per story. */
export interface Neighbor { spec: StreetBuilding; model: ShearBuilding; bodies: Body[]; lag: number }

/**
 * Apparent speed of the shaking along the street (Model). Buildings farther along get the
 * same motion a few hundredths of a second later, as if the wave crossed the street.
 * The shared ground body moves without the delay.
 */
export const WAVE_SPEED_ALONG_STREET = 2000; // m/s

export class Scenario {
  readonly world: RAPIER_NS.World;
  readonly building: ShearBuilding;
  readonly bodies = new Map<string, SimBody>();
  readonly events: SimEvent[] = [];
  simT = 0;
  quake: QuakeRecord | null = null;
  quakeT0 = 0;
  failedAt: number | null = null;
  private acc = 0;
  private pendingFail = -1;
  private crushed: { collider: RAPIER_NS.Collider; until: number }[] = [];
  private rand = rng(4242);
  private ox: number; private oz: number;
  readonly neighbors: Neighbor[] = [];

  constructor(private R: R, readonly layout: SoftStoryLayout, street: StreetBuilding[] = []) {
    [this.ox, , this.oz] = layout.origin;
    const world = (this.world = new R.World({ x: 0, y: -G, z: 0 }));
    world.timestep = DT;
    world.integrationParameters.numSolverIterations = 8;
    this.building = new ShearBuilding(layout.structure);
    this.building.onCrack = i => this.emit({ t: this.simT, kind: 'crack', story: i, pos: this.storyCenter(i) });
    this.building.onFail = i => { this.pendingFail = i; };

    // Street: one kinematic body for everything fixed to the ground.
    const ground = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    // Road level everywhere, with the sidewalk and plaza raised by a curb.
    const gx = this.ox + layout.W / 2;
    world.createCollider(R.ColliderDesc.cuboid(120, 0.5, 120).setTranslation(gx, -0.5 - CURB_H, this.oz).setFriction(0.8), ground);
    world.createCollider(R.ColliderDesc.cuboid(120, CURB_H / 2, 60).setTranslation(gx, -CURB_H / 2, ROAD.z0 - 60).setFriction(0.8), ground);
    world.createCollider(R.ColliderDesc.cuboid(120, CURB_H / 2, 60).setTranslation(gx, -CURB_H / 2, ROAD.z1 + 60).setFriction(0.8), ground);
    this.add('ground', ground, 'ground', 1e9);

    // Floor slabs 1..N, each carrying the walls of the story above it.
    for (let i = 1; i <= layout.stories; i++) {
      const [x, y, z] = this.floorRest(i);
      const b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
      this.addFloorColliders(b, i, 0);
      this.add(`floor:${i}`, b, 'floor', layout.slabMass + layout.wallMass);
    }

    // Breakable ground-story pieces: kinematic until the story fails.
    for (const p of layout.groundStory) {
      const b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.ox + p.center[0], p.center[1], this.oz + p.center[2]));
      world.createCollider(R.ColliderDesc.cuboid(...p.half).setMass(p.mass).setFriction(0.7), b);
      this.add(p.id, b, 'story1', p.mass);
    }

    // Neighbors: each story is one driven box, so debris and props collide with the buildings.
    for (const spec of street) {
      const model = new ShearBuilding(spec.structure);
      model.onCrack = i => this.emit({ t: this.simT, kind: 'crack', story: i, building: spec.id, pos: this.neighborStoryCenter(spec, i) });
      const bodies: Body[] = [];
      for (let i = 0; i < spec.stories; i++) {
        const b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...this.neighborStoryCenter(spec, i)));
        world.createCollider(R.ColliderDesc.cuboid(spec.W / 2 - 0.02, STORY_H / 2 - 0.01, spec.D / 2 - 0.02).setFriction(0.7), b);
        this.add(`${spec.id}:story:${i + 1}`, b, 'neighbor', spec.structure.floorMass);
        bodies.push(b);
      }
      const lag = (spec.origin[0] + spec.W / 2 - (this.ox + layout.W / 2)) / WAVE_SPEED_ALONG_STREET;
      this.neighbors.push({ spec, model, bodies, lag });
    }

    // Furniture and plaza props: dynamic from the start.
    for (const p of layout.props) {
      const top = p.floor >= 1 ? p.floor * STORY_H : 0;
      const q = { x: 0, y: Math.sin(p.rotY / 2), z: 0, w: Math.cos(p.rotY / 2) };
      const b = world.createRigidBody(R.RigidBodyDesc.dynamic()
        .setTranslation(this.ox + p.pos[0], top + (p.lift ?? 0) + p.size[1] / 2 + 0.003, this.oz + p.pos[1])
        .setRotation(q).setCanSleep(false).setLinearDamping(0.02).setAngularDamping(0.15));
      world.createCollider(R.ColliderDesc.cuboid(p.size[0] / 2 * 0.97, p.size[1] / 2, p.size[2] / 2 * 0.97).setMass(p.mass).setFriction(0.45).setRestitution(0.05), b);
      this.add(p.id, b, 'prop', p.mass);
    }
  }

  private add(id: string, body: Body, kind: SimBody['kind'], mass: number) {
    const t = body.linvel();
    this.bodies.set(id, { id, body, kind, mass, pv: { x: t.x, y: t.y, z: t.z }, cool: 0 });
  }

  private emit(e: SimEvent) { this.events.push(e); }

  /** Rest position of slab i's center in world space. */
  floorRest(i: number): [number, number, number] {
    const { W, D } = this.layout;
    return [this.ox + W / 2, i * STORY_H - SLAB_T / 2, this.oz - D / 2];
  }

  /** Rest center of a neighbor's story i (0 based). */
  neighborStoryCenter(spec: StreetBuilding, i: number): [number, number, number] {
    return [spec.origin[0] + spec.W / 2, spec.origin[1] + (i + 0.5) * STORY_H, spec.origin[2] - spec.D / 2];
  }

  storyCenter(i: number): [number, number, number] {
    const g = this.groundOffset();
    return [this.ox + this.layout.W / 2 + g.x, i * STORY_H + 1.5, this.oz + g.z];
  }

  /** Slab plus the four walls of the story above it, offset by `dy` from the body origin. */
  private addFloorColliders(b: Body, i: number, dy: number) {
    const { R, layout } = this;
    const { W, D } = layout;
    this.world.createCollider(R.ColliderDesc.cuboid(W / 2, SLAB_T / 2, D / 2).setTranslation(0, dy, 0).setMass(layout.slabMass).setFriction(0.7), b);
    if (i >= layout.stories) return;
    const hh = (STORY_H - SLAB_T) / 2 - 0.01, wy = dy + SLAB_T / 2 + hh + 0.005, t = 0.1, m = layout.wallMass / 4;
    for (const [x, z, hx, hz] of [[0, D / 2 - t, W / 2, t], [0, -D / 2 + t, W / 2, t], [W / 2 - t, 0, t, D / 2 - 2 * t], [-W / 2 + t, 0, t, D / 2 - 2 * t]]) {
      this.world.createCollider(R.ColliderDesc.cuboid(hx, hh, hz).setTranslation(x, wy, z).setMass(m).setFriction(0.6), b);
    }
  }

  startQuake(rec: QuakeRecord) {
    this.quake = rec;
    this.quakeT0 = this.simT;
    this.emit({ t: this.simT, kind: 'quake-start' });
  }

  /** Time into the quake, or -1 before it starts. */
  get quakeTime() { return this.quake ? this.simT - this.quakeT0 : -1; }

  groundOffset(t = this.quakeTime) {
    const q = this.quake;
    if (!q || t < 0) return { x: 0, y: 0, z: 0 };
    return { x: sample(q, q.x, t), y: q.y ? sample(q, q.y, t) : 0, z: sample(q, q.z, t) };
  }

  /** Ground acceleration in all three directions (m/s^2), for the seismograph. */
  groundAccel(t = this.quakeTime) {
    const q = this.quake;
    if (!q || t < 0) return { x: 0, y: 0, z: 0 };
    return { x: sample(q, q.ax, t), y: q.ay ? sample(q, q.ay, t) : 0, z: sample(q, q.az, t) };
  }

  groundAccelG(t = this.quakeTime) {
    if (!this.quake || t < 0) return 0;
    return Math.hypot(sample(this.quake, this.quake.ax, t), sample(this.quake, this.quake.az, t)) / G;
  }

  private groundVel(t: number) {
    const h = 1e-3, a = this.groundOffset(t + h), b = this.groundOffset(t - h);
    return { x: (a.x - b.x) / (2 * h), z: (a.z - b.z) / (2 * h) };
  }

  /** Advance by real time; runs whole 120 Hz steps. Returns the number of steps taken. */
  advance(dtReal: number, maxSteps = 8) {
    this.acc += dtReal;
    let n = 0;
    while (this.acc >= DT && n < maxSteps) { this.step(); this.acc -= DT; n++; }
    if (n === maxSteps) this.acc = 0;
    return n;
  }

  step() {
    const b = this.building, q = this.quake;
    if (q) {
      const dts = DT / SUB;
      for (let s = 0; s < SUB && b.failedStory < 0; s++) {
        const t = this.quakeTime + (s + 0.5) * dts;
        b.step(dts, sample(q, q.ax, t), sample(q, q.az, t));
      }
      for (const nb of this.neighbors) for (let s = 0; s < SUB; s++) {
        const t = this.quakeTime + (s + 0.5) * dts - nb.lag;
        nb.model.step(dts, sample(q, q.ax, t), sample(q, q.az, t));
      }
    }
    if (this.pendingFail >= 0) { this.collapse(this.pendingFail); this.pendingFail = -1; }
    this.poseKinematics(this.quakeTime + DT);
    this.world.step();
    this.simT += DT;
    if (this.crushed.length && this.crushed[0].until <= this.simT) {
      for (const c of this.crushed) c.collider.setCollisionGroups(groups(DEBRIS, 0xffff));
      this.crushed = [];
    }
    this.detectImpacts();
  }

  private poseKinematics(t: number) {
    const g = this.groundOffset(t);
    this.bodies.get('ground')!.body.setNextKinematicTranslation({ x: g.x, y: g.y, z: g.z });
    for (const nb of this.neighbors) {
      const m = nb.model;
      for (let i = 0; i < nb.bodies.length; i++) {
        const [x, y, z] = this.neighborStoryCenter(nb.spec, i);
        const bx = i ? m.ux[i - 1] : 0, bz = i ? m.uz[i - 1] : 0;
        nb.bodies[i].setNextKinematicTranslation({ x: x + g.x + (bx + m.ux[i]) / 2, y: y + g.y, z: z + g.z + (bz + m.uz[i]) / 2 });
      }
    }
    if (this.failedAt !== null) return;
    const b = this.building;
    for (let i = 1; i <= this.layout.stories; i++) {
      const [x, y, z] = this.floorRest(i);
      this.bodies.get(`floor:${i}`)!.body.setNextKinematicTranslation({ x: x + g.x + b.ux[i - 1], y: y + g.y, z: z + g.z + b.uz[i - 1] });
    }
    // Ground-story pieces lean with the story: shift by their height share, tilt by the drift.
    const ux = b.ux[0], uz = b.uz[0];
    const ax = Math.atan2(uz, STORY_H), az = -Math.atan2(ux, STORY_H);
    const q = quatXZ(ax, az);
    for (const p of this.layout.groundStory) {
      const f = p.center[1] / STORY_H;
      const body = this.bodies.get(p.id)!.body;
      body.setNextKinematicTranslation({ x: this.ox + p.center[0] + g.x + ux * f, y: p.center[1] + g.y, z: this.oz + p.center[2] + g.z + uz * f });
      body.setNextKinematicRotation(q);
    }
  }

  /** Story `story` failed: hand the building over from the structure model to Rapier. */
  private collapse(story: number) {
    const { R, world, layout, building: b } = this;
    this.failedAt = this.quakeTime;
    const t = this.quakeTime;
    const gv = this.groundVel(t);
    const pos = this.storyCenter(story);
    this.emit({ t: this.simT, kind: 'fail', story, pos });

    // Upper block: floor 1 becomes dynamic and takes the colliders of floors 2..N.
    const block = this.bodies.get('floor:1')!;
    const merged: string[] = [];
    for (let i = 2; i <= layout.stories; i++) {
      const id = `floor:${i}`;
      world.removeRigidBody(this.bodies.get(id)!.body);
      this.bodies.delete(id);
      this.addFloorColliders(block.body, i, (i - 1) * STORY_H);
      merged.push(id);
    }
    for (let c = 0; c < block.body.numColliders(); c++) block.body.collider(c).setCollisionGroups(groups(BLOCK, 0xffff));
    block.body.setBodyType(R.RigidBodyType.Dynamic, true);
    block.body.setLinvel({ x: gv.x + b.vx[0], y: 0, z: gv.z + b.vz[0] }, true);
    block.mass = layout.stories * (layout.slabMass + layout.wallMass);
    // Tip it toward the way the story was leaning.
    const lean = Math.hypot(b.ux[0], b.uz[0]) || 1;
    const k = 0.9 * block.mass;
    block.body.applyTorqueImpulse({ x: (b.uz[0] / lean) * k, y: 0, z: (-b.ux[0] / lean) * k }, true);
    this.emit({ t: this.simT, kind: 'collapse', block: 'floor:1', merged });

    // Ground story: columns snap in two, panels and shutters fall free.
    const r = this.rand;
    const dir = { x: b.ux[0] / lean, z: b.uz[0] / lean };
    for (const p of layout.groundStory) {
      const sb = this.bodies.get(p.id)!;
      const vel = { x: gv.x + b.vx[0] * (p.center[1] / STORY_H), z: gv.z + b.vz[0] * (p.center[1] / STORY_H) };
      if (p.kind === 'column') {
        const tr = sb.body.translation(), rot = sb.body.rotation();
        world.removeRigidBody(sb.body);
        this.bodies.delete(p.id);
        this.emit({ t: this.simT, kind: 'remove', id: p.id });
        const halfH = p.half[1] / 2;
        for (const [s, sign] of [['a', -1], ['b', 1]] as const) {
          const id = `${p.id}:${s}`;
          const nb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(tr.x, tr.y + sign * halfH, tr.z).setRotation(rot));
          const col = world.createCollider(R.ColliderDesc.cuboid(p.half[0], halfH * 0.96, p.half[2]).setMass(p.mass / 2).setFriction(0.6)
            .setCollisionGroups(groups(DEBRIS, 0xffff & ~BLOCK)), nb);
          this.crushed.push({ collider: col, until: this.simT + CRUSH_TIME });
          const kick = sign * 1.6;
          nb.setLinvel({ x: vel.x + dir.x * kick + (r() - 0.5), y: 0, z: vel.z + dir.z * kick + (r() - 0.5) }, true);
          nb.setAngvel({ x: (r() - 0.5) * 4, y: (r() - 0.5) * 2, z: (r() - 0.5) * 4 }, true);
          this.add(id, nb, 'piece', p.mass / 2);
          this.emit({ t: this.simT, kind: 'spawn', id, from: p.id, half: [p.half[0], halfH, p.half[2]], role: 'column-half' });
        }
      } else {
        // Panels and shutters topple outward: push out through their face and tip the top out.
        const n = p.id.startsWith('panel:L') ? { x: -1, z: 0 } : p.id.startsWith('panel:R') ? { x: 1, z: 0 }
          : p.id.startsWith('panel:B') ? { x: 0, z: -1 } : { x: 0, z: 1 };
        sb.body.setBodyType(R.RigidBodyType.Dynamic, true);
        sb.body.setLinvel({ x: vel.x + n.x * (0.8 + r() * 0.6), y: 0, z: vel.z + n.z * (0.8 + r() * 0.6) }, true);
        // Top tips outward: rotation axis is up x n.
        const w = 1.2 + r() * 0.8;
        sb.body.setAngvel({ x: n.z * w, y: (r() - 0.5) * 0.4, z: -n.x * w }, true);
        const col = sb.body.collider(0);
        col.setCollisionGroups(groups(DEBRIS, 0xffff & ~BLOCK));
        this.crushed.push({ collider: col, until: this.simT + CRUSH_TIME });
        sb.kind = 'piece';
      }
    }
    // Shop contents under the block are crushed too: same brief pass-through as the walls.
    for (const p of layout.props) {
      if (p.floor !== 0) continue;
      const col = this.bodies.get(p.id)!.body.collider(0);
      col.setCollisionGroups(groups(DEBRIS, 0xffff & ~BLOCK));
      this.crushed.push({ collider: col, until: this.simT + CRUSH_TIME });
    }
    // Concrete chunks spalling off the slab edge above the failed story.
    const [, y1] = this.floorRest(1);
    const btr = block.body.translation();
    for (let i = 0; i < 18; i++) {
      const s = 0.08 + r() * 0.16;
      const half: [number, number, number] = [s / 2, s * 0.35, s * 0.6];
      const side = r() < 0.6;
      const x = side ? btr.x + (r() - 0.5) * layout.W : btr.x + (r() < 0.5 ? -1 : 1) * layout.W / 2;
      const z = side ? btr.z + layout.D / 2 - 0.1 : btr.z + (r() - 0.5) * layout.D;
      const nb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y1 - 0.3, z));
      world.createCollider(R.ColliderDesc.cuboid(...half).setMass(4).setFriction(0.6).setRestitution(0.2), nb);
      nb.setLinvel({ x: gv.x + (r() - 0.5) * 3, y: r() * 2, z: gv.z + (r() - 0.5) * 3 + 1 }, true);
      const id = `chunk:${i}`;
      this.add(id, nb, 'piece', 4);
      this.emit({ t: this.simT, kind: 'spawn', id, from: 'slab', half, role: 'chunk' });
    }
  }

  /** Sudden velocity changes become impact events for sound and dust (prototype detectImpacts). */
  private detectImpacts() {
    for (const o of this.bodies.values()) {
      if (o.kind === 'ground' || o.kind === 'story1' || o.kind === 'neighbor' || (o.kind === 'floor' && !o.body.isDynamic())) continue;
      const v = o.body.linvel();
      const dv = Math.hypot(v.x - o.pv.x, v.y - o.pv.y, v.z - o.pv.z);
      o.pv = { x: v.x, y: v.y, z: v.z };
      o.cool -= DT;
      if (dv > 1.6 && o.cool <= 0) {
        const J = o.mass * dv;
        if (J < 25) continue;
        o.cool = 0.3;
        const t = o.body.translation();
        const heavy = o.kind === 'floor' || J > 2000;
        this.emit({ t: this.simT, kind: 'impact', p: Math.min(1, J / (heavy ? 2e5 : 600)), heavy, pos: [t.x, t.y, t.z] });
      }
    }
  }

  /** Summary used by tests, the HUD and window.__lab. */
  report() {
    const blk = this.bodies.get('floor:1')!.body.translation();
    return {
      quakeTime: this.quakeTime,
      failedAt: this.failedAt,
      periods: this.building.periods.slice(0, 3),
      stories: this.building.stories.map(s => ({ ...s })),
      blockY: blk.y,
      blockDrop: this.floorRest(1)[1] - blk.y,
      bodies: this.bodies.size,
      neighbors: this.neighbors.map(nb => ({
        id: nb.spec.id,
        period: nb.model.periods[0],
        roof: Math.hypot(nb.model.ux[nb.model.n - 1], nb.model.uz[nb.model.n - 1]),
        roofDrift: Math.hypot(nb.model.ux[nb.model.n - 1], nb.model.uz[nb.model.n - 1]) / (nb.model.n * STORY_H),
        peakDrift: Math.max(...nb.model.stories.map(st => st.peak)),
        damage: Math.max(...nb.model.stories.map(st => st.damage)),
      })),
    };
  }

  free() { this.world.free(); }
}

function quatXZ(ax: number, az: number) {
  // Rotation about x then z, small angles: good enough for a leaning column.
  const cx = Math.cos(ax / 2), sx = Math.sin(ax / 2), cz = Math.cos(az / 2), sz = Math.sin(az / 2);
  return { x: sx * cz, y: sx * sz, z: cx * sz, w: cx * cz };
}
