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
  targetPeriod: number;  // s, first mode
  zeta: number;          // damping ratio
  stories: StorySpec[];  // bottom to top
}

export interface StoryState {
  label: string;
  drift: number;   // current drift ratio (horizontal, both directions)
  peak: number;    // largest drift ratio so far
  damage: number;  // 0 to 1
  failed: boolean;
}

const G = 9.81;

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

  constructor(readonly spec: ShearBuildingSpec) {
    const n = (this.n = spec.stories.length);
    const masses = Array(n).fill(spec.floorMass);
    this.k = tuneToPeriod(masses, spec.stories.map(s => s.stiffnessShare), spec.targetPeriod);
    this.periods = shearBuildingPeriods(masses, this.k);
    const w1 = (2 * Math.PI) / this.periods[0], w2 = (2 * Math.PI) / (this.periods[1] ?? this.periods[0] / 3);
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
    for (let i = 0; i < n; i++) {
      const dx = ux[i] - (i ? ux[i - 1] : 0), dz = uz[i] - (i ? uz[i - 1] : 0);
      const dvx = vx[i] - (i ? vx[i - 1] : 0), dvz = vz[i] - (i ? vz[i - 1] : 0);
      const ks = this.storyK(i), kNet = ks - this.kGeo[i];
      const cs = this.a1 * ks;
      const sx = kNet * dx + cs * dvx, sz = kNet * dz + cs * dvz;
      // Story force acts up on floor i and down on floor i-1.
      fx[i] -= sx; fz[i] -= sz;
      if (i) { fx[i - 1] += sx; fz[i - 1] += sz; }
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
    for (let i = 0; i < n; i++) {
      const axi = fx[i] / m - this.a0 * vx[i] - agx;
      const azi = fz[i] / m - this.a0 * vz[i] - agz;
      vx[i] += axi * dt; vz[i] += azi * dt;
      ux[i] += vx[i] * dt; uz[i] += vz[i] * dt;
    }
  }
}
