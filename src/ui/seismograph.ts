/**
 * A three-channel seismograph drawn from the quake record: east-west, north-south and up-down
 * ground acceleration over the last `window` seconds. Once the P and S waves have reached the
 * street, their arrivals are picked with a marked line, as a seismologist would mark them.
 * On-screen text follows the lab's writing rules (no em dashes, semicolons or middle dots).
 */
export interface SeismoRecord {
  dt: number; n: number;
  ax: Float64Array; az: Float64Array; ay?: Float64Array;
  tP?: number; tS?: number;
}

const CHANNELS = [
  { key: 'ax', label: 'E-W', color: '#4cc9f0' },
  { key: 'az', label: 'N-S', color: '#36d47c' },
  { key: 'ay', label: 'Up', color: '#ffb020' },
] as const;

export class Seismograph {
  private ctx: CanvasRenderingContext2D;
  private rec: SeismoRecord | null = null;
  private peak = 1;

  constructor(private canvas: HTMLCanvasElement, private window = 20) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const { width, height } = canvas;
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.draw(-1);
  }

  setRecord(rec: SeismoRecord | null) {
    this.rec = rec;
    let pk = 1e-6;
    if (rec) for (const c of CHANNELS) {
      const a = rec[c.key];
      if (a) for (let i = 0; i < rec.n; i++) pk = Math.max(pk, Math.abs(a[i]));
    }
    this.peak = pk;
  }

  /** Redraw up to quake time `t` (seconds, negative before the quake starts). */
  draw(t: number) {
    const { ctx } = this;
    const W = parseFloat(this.canvas.style.width) || this.canvas.width;
    const H = parseFloat(this.canvas.style.height) || this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    const rowH = H / 3, left = 30;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    const t1 = Math.max(t, 0), t0 = t1 - this.window;
    const x = (time: number) => left + ((time - t0) / this.window) * (W - left - 4);
    CHANNELS.forEach((c, row) => {
      const mid = rowH * (row + 0.5);
      ctx.fillStyle = '#a3b2be';
      ctx.fillText(c.label, 3, mid);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.moveTo(left, mid); ctx.lineTo(W - 4, mid); ctx.stroke();
      const rec = this.rec, a = rec?.[c.key];
      if (!rec || !a || t < 0) return;
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const px = W - left - 4, k = (rowH * 0.46) / this.peak;
      for (let i = 0; i <= px; i++) {
        const time = t0 + (i / px) * this.window;
        const j = Math.round(time / rec.dt);
        const v = j >= 0 && j < rec.n && time <= t ? a[j] : 0;
        const yy = mid - v * k;
        if (i === 0) ctx.moveTo(left + i, yy); else ctx.lineTo(left + i, yy);
      }
      ctx.stroke();
    });
    // Picks: a line and a letter once each wave has arrived.
    const rec = this.rec;
    if (!rec || t < 0) return;
    for (const [name, at] of [['P', rec.tP], ['S', rec.tS]] as const) {
      if (at === undefined || t < at || at < t0) continue;
      const px = x(at);
      ctx.strokeStyle = name === 'P' ? '#ffffff' : '#ff4d3d';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = 'bold 12px Barlow, sans-serif';
      ctx.fillText(name, px + 3, 9);
      ctx.font = '11px "JetBrains Mono", monospace';
    }
  }
}
