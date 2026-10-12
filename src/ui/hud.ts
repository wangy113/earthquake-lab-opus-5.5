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
    for (const b of document.querySelectorAll<HTMLButtonElement>('#segCam button')) {
      b.onclick = () => {
        for (const o of document.querySelectorAll('#segCam button')) o.setAttribute('aria-pressed', String(o === b));
        this.onCamera(b.dataset.v!);
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

  setPeriod(T: number) { $('#roT').textContent = `${T.toFixed(2)} s`; }

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
