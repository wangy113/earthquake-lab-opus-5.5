import * as THREE from 'three/webgpu';

/**
 * Dust puffs: a pool of soft sprites, ported from the prototype. Phase 5 replaces this
 * with GPU particles and a lit dust volume.
 */
export class Dust {
  private pool: { s: THREE.Sprite; m: THREE.SpriteNodeMaterial; v: THREE.Vector3; life: number; max: number; size: number }[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, count = 260) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteNodeMaterial({ map: tex, color: 0xcfc4b4, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      this.pool.push({ s, m, v: new THREE.Vector3(), life: 0, max: 1, size: 1 });
    }
  }

  puff(x: number, y: number, z: number, n: number, power: number, spread = 2.4) {
    for (let i = 0; i < n; i++) {
      const d = this.pool[this.next++ % this.pool.length];
      d.s.visible = true;
      d.life = 0;
      d.max = 2 + Math.random() * 3 * Math.min(1.5, power);
      d.size = 0.5 + Math.random() * 0.8 * power;
      d.s.position.set(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.3) * 0.8, z + (Math.random() - 0.5) * spread);
      d.v.set((Math.random() - 0.5) * 2.6 * power, Math.random() * 0.8 * power, (Math.random() - 0.5) * 2.6 * power);
    }
  }

  update(dt: number) {
    for (const d of this.pool) {
      if (!d.s.visible) continue;
      d.life += dt;
      const k = d.life / d.max;
      if (k >= 1) { d.s.visible = false; continue; }
      d.v.multiplyScalar(Math.pow(0.35, dt));
      d.v.y += 0.1 * dt;
      d.s.position.addScaledVector(d.v, dt);
      const sz = d.size * (1 + k * 4);
      d.s.scale.set(sz, sz, sz);
      d.m.opacity = 0.8 * Math.sin(Math.PI * Math.min(1, k * 1.15)) * (1 - k);
    }
  }

  clear() { for (const d of this.pool) d.s.visible = false; }
}
