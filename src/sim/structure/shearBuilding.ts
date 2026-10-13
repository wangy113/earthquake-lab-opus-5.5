import { shearBuildingPeriods, tuneToPeriod } from './modal';

/**
 * Shear-building model: one mass per floor, moving in x and z relative to the ground.
 *   M u'' + C u' + F(u) = -M a_ground
 * Story springs soften as damage builds up past the yield drift (ported from the prototype's
 * applySprings). P-Delta is included: the weight above a leaning story pushes it further over,
 * so a badly damaged soft story runs away on its own instead of just crossing a threshold.
 * Damping is Rayleigh (mass and stiffness proportional), set to `zeta` in modes 1 and 2.
 * Integrated with semi-implicit Euler at a small fixed step (about 1 kHz).
 */
export interface StorySpec {
  label: string;
  stiffnessShare: number; // relative lateral stiffness, scaled to hit the target period
  yieldDrift: number;     // drift ratio where damage starts
  ultDrift: number;       // drift ratio where the story fails
  canFail: boolean;
}

export interface ShearBuildingSpec {
  floorMass: number;     // kg per floor
  storyHeight: number;   // m
  targetPeriod: number;  // s, first mode with a fixed base
  zeta: number;          // damping ratio
  stories: StorySpec[];  // bottom to top
  isolation?: IsolationSpec;
}

/**
 * Base isolation (docs/PLAN.md, building 5): the building sits on a base slab carried by
 * bearings that are stiff for small motions and soft once they yield, like lead-rubber
 * bearings. A moat around the building limits how far the base can travel.
 * All values are Model values.
 */
export interface IsolationSpec {
  period: number;      // s, isolated period from the post-yield stiffness
  strength: number;    // bearing yield force as a share of the building's weight
  stiffRatio: number;  // initial stiffness over post-yield stiffness
  zeta: number;        // added viscous damping of the isolation mode
  moatGap: number;     // m, clear gap to the moat wall
}

export interface StoryState {
  label: string;
  drift: number;   // current drift ratio (horizontal, both directions)
  peak: number;    // largest drift ratio so far
  damage: number;  // 0 to 1
  failed: boolean;
}

const G = 9.81;

/** Elastic-plastic part of a bearing force along one axis: returns [force, new plastic offset]. */
function bearing(u: number, up: number, kh: number, qd: number): [number, number] {
  let h = kh * (u - up);
  if (h > qd) { h = qd; up = u - qd / kh; } else if (h < -qd) { h = -qd; up = u + qd / kh; }
  return [h, up];
}

export class ShearBuilding {
  readonly n: number;
  readonly k: number[];
  readonly periods: number[];
  readonly ux: Float64Array; readonly uz: Float64Array; // floor displacement relative to ground
  readonly vx: Float64Array; readonly vz: Float64Array;
  readonly stories: StoryState[];
  private a0: number; private a1: number;
  private kGeo: number[];
  failedStory = -1;
  onCrack?: (story: number) => void;
  onFail?: (story: number) => void;
  /** The isolated base touched its moat wall, at this speed (m/s). */
  onMoat?: (speed: number) => void;
  /** Fixed-base periods of the superstructure (the same as `periods` without isolation). */
  readonly fixedPeriods: number[];
  // Isolated base: displacement and velocity relative to the ground, bearing plastic offsets.
  bx = 0; bz = 0; bvx = 0; bvz = 0;
  peakBase = 0;
  moatHits = 0;
  private upx = 0; private upz = 0; private inMoat = false;
  private iso: { mb: number; k1: number; k2: number; qd: number; cb: number; kMoat: number; cMoat: number } | null = null;

  constructor(readonly spec: ShearBuildingSpec) {
    const n = (this.n = spec.stories.length);
    const masses = Array(n).fill(spec.floorMass);
    this.k = tuneToPeriod(masses, spec.stories.map(s => s.stiffnessShare), spec.targetPeriod);
    this.fixedPeriods = shearBuildingPeriods(masses, this.k);
    this.periods = this.fixedPeriods;
    const iso = spec.isolation;
    if (iso) {
      // The base slab weighs about one floor. Post-yield stiffness sets the isolated period.
      const mb = spec.floorMass, Mtot = mb + n * spec.floorMass;
      const k2 = Mtot * (2 * Math.PI / iso.period) ** 2, k1 = k2 * iso.stiffRatio;
      const cb = 2 * iso.zeta * Math.sqrt(k2 * Mtot);
      const kMoat = 400 * k2;
      this.iso = { mb, k1, k2, qd: iso.strength * Mtot * G, cb, kMoat, cMoat: 0.2 * Math.sqrt(kMoat * mb) };
      this.periods = shearBuildingPeriods([mb, ...masses], [k2, ...this.k]);
    }
    // Rayleigh damping of the superstructure, from its fixed-base modes.
    const fp = this.fixedPeriods;
    const w1 = (2 * Math.PI) / fp[0], w2 = (2 * Math.PI) / (fp[1] ?? fp[0] / 3);
    this.a1 = (2 * spec.zeta) / (w1 + w2);
    this.a0 = this.a1 * w1 * w2;
    // Geometric (P-Delta) softening: weight carried by story i over its height.
    this.kGeo = spec.stories.map((_, i) => ((n - i) * spec.floorMass * G) / spec.storyHeight);
    this.ux = new Float64Array(n); this.uz = new Float64Array(n);
    this.vx = new Float64Array(n); this.vz = new Float64Array(n);
    this.stories = spec.stories.map(s => ({ label: s.label, drift: 0, peak: 0, damage: 0, failed: false }));
  }

  /** Story stiffness right now, after damage. */
  storyK(i: number) {
    return this.k[i] * (1 - 0.7 * this.stories[i].damage);
  }

  step(dt: number, agx: number, agz: number) {
    if (this.failedStory >= 0) return;
    const { n, ux, uz, vx, vz } = this;
    const m = this.spec.floorMass, h = this.spec.storyHeight;
    const fx = new Float64Array(n), fz = new Float64Array(n);
    const { bx, bz, bvx, bvz } = this;
    let fbx = 0, fbz = 0; // forces on the isolated base from story 1
    for (let i = 0; i < n; i++) {
      const dx = ux[i] - (i ? ux[i - 1] : bx), dz = uz[i] - (i ? uz[i - 1] : bz);
      const dvx = vx[i] - (i ? vx[i - 1] : bvx), dvz = vz[i] - (i ? vz[i - 1] : bvz);
      const ks = this.storyK(i), kNet = ks - this.kGeo[i];
      const cs = this.a1 * ks;
      const sx = kNet * dx + cs * dvx, sz = kNet * dz + cs * dvz;
      // Story force acts up on floor i and down on floor i-1.
      fx[i] -= sx; fz[i] -= sz;
      if (i) { fx[i - 1] += sx; fz[i - 1] += sz; } else { fbx += sx; fbz += sz; }
      const st = this.stories[i];
      st.drift = Math.hypot(dx, dz) / h;
      st.peak = Math.max(st.peak, st.drift);
      const sp = this.spec.stories[i];
      if (st.drift > sp.yieldDrift) {
        if (st.damage === 0) this.onCrack?.(i);
        st.damage = Math.min(1, st.damage + ((st.drift - sp.yieldDrift) / (sp.ultDrift - sp.yieldDrift)) * dt * 1.6);
      }
      if (sp.canFail && !st.failed && (st.drift > sp.ultDrift || st.damage >= 1)) {
        st.failed = true;
        this.failedStory = i;
        this.onFail?.(i);
        return;
      }
    }
    if (this.iso) this.stepBase(dt, fbx, fbz, agx, agz);
    for (let i = 0; i < n; i++) {
      // Mass-proportional damping acts on motion relative to the base, so it does not damp
      // the isolators' slow swing.
      const axi = fx[i] / m - this.a0 * (vx[i] - bvx) - agx;
      const azi = fz[i] / m - this.a0 * (vz[i] - bvz) - agz;
      vx[i] += axi * dt; vz[i] += azi * dt;
      ux[i] += vx[i] * dt; uz[i] += vz[i] * dt;
    }
  }

  private stepBase(dt: number, fbx: number, fbz: number, agx: number, agz: number) {
    const iso = this.iso!;
    const [hx, upx] = bearing(this.bx, this.upx, iso.k1 - iso.k2, iso.qd);
    const [hz, upz] = bearing(this.bz, this.upz, iso.k1 - iso.k2, iso.qd);
    this.upx = upx; this.upz = upz;
    let fx = fbx - iso.k2 * this.bx - hx - iso.cb * this.bvx;
    let fz = fbz - iso.k2 * this.bz - hz - iso.cb * this.bvz;
    // Moat wall: a stiff, damped stop all round, once the base has used up its gap.
    const r = Math.hypot(this.bx, this.bz), gap = this.spec.isolation!.moatGap;
    if (r > gap) {
      const nx = this.bx / r, nz = this.bz / r, vn = this.bvx * nx + this.bvz * nz;
      if (!this.inMoat) { this.inMoat = true; this.moatHits++; this.onMoat?.(Math.abs(vn)); }
      const f = iso.kMoat * (r - gap) + (vn > 0 ? iso.cMoat * vn : 0);
      fx -= f * nx; fz -= f * nz;
    } else if (r < gap - 0.01) this.inMoat = false;
    this.bvx += (fx / iso.mb - agx) * dt; this.bvz += (fz / iso.mb - agz) * dt;
    this.bx += this.bvx * dt; this.bz += this.bvz * dt;
    this.peakBase = Math.max(this.peakBase, Math.hypot(this.bx, this.bz));
  }
}
