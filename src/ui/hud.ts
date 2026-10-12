import type { StoryState } from '../sim/structure/shearBuilding';

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
