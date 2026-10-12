/**
 * Procedural sound with Web Audio and no files, ported from the prototype:
 * a low rumble that follows the ground shaking, impacts and cracks.
 */
export class Sound {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private rumble!: GainNode;
  private noise!: AudioBuffer;
  private budget = 0;
  enabled = true;
  slow = false;

  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      const ac = (this.ac = new AudioContext());
      this.master = ac.createGain();
      this.master.gain.value = this.enabled ? 0.9 : 0;
      this.master.connect(ac.destination);
      this.noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      // Brown noise through a low-pass: the deep roar of the ground.
      const bb = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
      const bd = bb.getChannelData(0);
      let l = 0;
      for (let i = 0; i < bd.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = l * 3.5; }
      const src = ac.createBufferSource();
      src.buffer = bb;
      src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 120;
      this.rumble = ac.createGain();
      this.rumble.gain.value = 0;
      src.connect(lp).connect(this.rumble).connect(this.master);
      src.start();
    } catch { this.ac = null; }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ac) this.master.gain.value = on ? 0.9 : 0;
  }

  /** Called every frame with the ground acceleration in g. */
  tick(groundG: number) {
    this.budget = Math.max(0, this.budget - 0.5);
    if (!this.ac) return;
    this.rumble.gain.setTargetAtTime(Math.min(1, groundG * 2.4) * 0.9, this.ac.currentTime, 0.08);
  }

  impact(p: number, heavy: boolean) {
    const ac = this.ac;
    if (!ac || this.budget > 8) return;
    this.budget++;
    const t = ac.currentTime, slow = this.slow ? 0.5 : 1;
    const n = ac.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = slow;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = (heavy ? 260 : 1400 + 1800 * Math.random()) * slow;
    const g = ac.createGain();
    g.gain.setValueAtTime((heavy ? 1.0 : 0.35) * (0.25 + 0.75 * p), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 1.4 : 0.18) / slow);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 1.6 / slow);
    if (heavy) {
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(70 * slow, t);
      o.frequency.exponentialRampToValueAtTime(26, t + 0.7 / slow);
      const og = ac.createGain();
      og.gain.setValueAtTime(0.9 * p, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.9 / slow);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + 1 / slow);
    }
  }

  crack(p: number) {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    for (let i = 0; i < 5; i++) {
      const n = ac.createBufferSource();
      n.buffer = this.noise;
      const f = ac.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800 + Math.random() * 2500;
      f.Q.value = 2;
      const g = ac.createGain();
      const st = t + i * (0.03 + Math.random() * 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setValueAtTime(0.7 * p, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.07);
      n.connect(f).connect(g).connect(this.master);
      n.start(t, Math.random());
      n.stop(st + 0.1);
    }
  }
}
