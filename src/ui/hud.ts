import type { StoryState } from '../sim/structure/shearBuilding';
import { rockPga, siteAmp, type Site } from '../sim/quake/groundMotion';
import { QUAKE_PRESETS, type QuakePreset } from '../config/scenarios';

export interface QuakeSettings { magnitude: number; distanceKm: number; site: Site }

/**
 * The on-screen controls and readouts. On-screen text follows the lab's writing rules:
 * no em dashes, no semicolons, no middle dots.
 */
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

export class Hud {
  onStart = () => {};
  onReset = () => {};
  onSlow = (_on: boolean) => {};
  onSound = (_on: boolean) => {};
  onCamera = (_name: string) => {};
  onSky = (_name: string) => {};
  onQuake = (_q: QuakeSettings) => {};
  quake: QuakeSettings = { magnitude: 6.5, distanceKm: 12, site: 'rock' };
  private slow = false;
  private sound = true;
  private lastNote = '';

  constructor() {
    $('#startBtn').onclick = () => this.onStart();
    $('#resetBtn').onclick = () => this.onReset();
    $('#slowBtn').onclick = () => { this.slow = !this.slow; $('#slowBtn').setAttribute('aria-pressed', String(this.slow)); this.onSlow(this.slow); };
    $('#soundBtn').onclick = () => {
      this.sound = !this.sound;
      $('#soundBtn').setAttribute('aria-pressed', String(this.sound));
      $('#soundBtn').textContent = this.sound ? 'Sound on' : 'Sound off';
      this.onSound(this.sound);
    };
    this.segment('#segCam', v => this.onCamera(v));
    this.segment('#segSky', v => this.onSky(v));
    this.segment('#segSite', v => { this.quake.site = v as Site; this.quakeChanged(); });
    this.segment('#segPreset', v => { this.setQuake({ ...QUAKE_PRESETS[v as QuakePreset] }); this.quakeChanged(); });
    const inM = $<HTMLInputElement>('#inM'), inD = $<HTMLInputElement>('#inD');
    inM.oninput = () => { this.quake.magnitude = +inM.value; this.quakeChanged(true); };
    inD.oninput = () => { this.quake.distanceKm = +inD.value; this.quakeChanged(true); };
  }

  /** Show quake settings in the controls (without firing onQuake). */
  setQuake(q: QuakeSettings) {
    this.quake = { magnitude: q.magnitude, distanceKm: q.distanceKm, site: q.site };
    $<HTMLInputElement>('#inM').value = String(q.magnitude);
    $<HTMLInputElement>('#inD').value = String(q.distanceKm);
    this.select('#segSite', q.site);
    this.refreshQuakeLabels();
  }

  private quakeChanged(custom = false) {
    if (custom) this.select('#segPreset', '');
    this.refreshQuakeLabels();
    this.onQuake({ ...this.quake });
  }

  private refreshQuakeLabels() {
    const q = this.quake;
    $('#outM').textContent = q.magnitude.toFixed(1);
    $('#outD').textContent = `${q.distanceKm} km`;
    const rock = rockPga(q.magnitude, q.distanceKm);
    const pga = Math.min(1.2, rock * siteAmp(q.site, rock));
    const sp = q.distanceKm * (1 / 3.5 - 1 / 6);
    $('#quakeHint').textContent = `Peak shaking about ${pga.toFixed(2)} g. The S wave arrives ${sp.toFixed(1)} s after the P wave. Model values.`;
  }

  setQuakeLocked(on: boolean) {
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#segPreset button, #segSite button, #inM, #inD')) el.disabled = on;
  }

  private segment(sel: string, fn: (v: string) => void) {
    for (const b of document.querySelectorAll<HTMLButtonElement>(`${sel} button`)) {
      b.onclick = () => {
        for (const o of document.querySelectorAll(`${sel} button`)) o.setAttribute('aria-pressed', String(o === b));
        fn(b.dataset.v!);
      };
    }
  }

  loading(msg: string) { $('#loadMsg').textContent = msg; }
  ready() { $('#loader').hidden = true; }

  setRunning(on: boolean) {
    const b = $<HTMLButtonElement>('#startBtn');
    b.disabled = on || b.dataset.done === '1';
    if (on) { b.textContent = 'Shaking'; b.dataset.done = '1'; } else if (b.dataset.done === '1') b.textContent = 'Quake over';
  }

  setPeriod(T: number) { $('#roT').textContent = `(period ${T.toFixed(2)} s)`; }

  /** Mark a segmented control's choice without firing its callback (for URL options). */
  select(sel: string, v: string) {
    for (const o of document.querySelectorAll<HTMLButtonElement>(`${sel} button`)) o.setAttribute('aria-pressed', String(o.dataset.v === v));
  }

  neighbors(list: { label: string; period: number; roof: number; damage: number }[]) {
    const wrap = $('#neighbors');
    if (wrap.childElementCount !== list.length) {
      wrap.innerHTML = list.map(() => '<div class="story"><span></span><span class="dr"></span><span class="dr"></span></div>').join('');
    }
    list.forEach((n, i) => {
      const row = wrap.children[i];
      row.children[0].textContent = n.label;
      row.children[1].textContent = `${n.period.toFixed(1)} s`;
      row.children[2].textContent = `${Math.round(n.roof * 100)} cm`;
      (row.children[0] as HTMLElement).style.color = n.damage > 0.01 ? 'var(--amber)' : '';
    });
  }

  note(msg: string) {
    if (msg === this.lastNote) return;
    this.lastNote = msg;
    $('#note').textContent = msg;
  }

  update(s: { t: number; g: number; stories: StoryState[]; failedAt: number | null; fps: number; backend: string }) {
    $('#roTime').textContent = s.t < 0 ? 'waiting' : `${s.t.toFixed(1)} s`;
    $('#roG').textContent = `${s.g.toFixed(2)} g`;
    const wrap = $('#stories');
    if (wrap.childElementCount !== s.stories.length) {
      wrap.innerHTML = s.stories.slice().reverse().map(() => '<div class="story"><span></span><span class="pill"></span><span class="dr"></span></div>').join('');
    }
    s.stories.slice().reverse().forEach((st, i) => {
      const row = wrap.children[i];
      const collapsed = s.failedAt !== null;
      const [cls, label] = st.failed ? ['fail', 'Failed'] : collapsed ? ['fail', 'Fell'] : st.damage > 0.01 ? ['crack', 'Cracking'] : ['ok', 'OK'];
      row.children[0].textContent = st.label;
      row.children[1].className = `pill ${cls}`;
      row.children[1].textContent = label;
      row.children[2].textContent = collapsed ? '' : `${(st.drift * 100).toFixed(1)}%`;
    });
    $('#status').textContent = `${s.backend}  ${s.fps} fps`;
  }
}
