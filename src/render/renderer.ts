import * as THREE from 'three/webgpu';

/**
 * Checks that this browser's WebGPU accepts what three r186 sends. three always passes
 * `swizzle: 'rgba'` when it creates texture views. Some Chrome builds (seen on Chromium 141)
 * declare `swizzle` with a different type and throw on every frame, so the scene never draws.
 * When the probe fails we use three's WebGL2 backend instead.
 */
async function webgpuUsable(): Promise<boolean> {
  // Loosely typed so the project does not need @webgpu/types for one probe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as any).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return false;
    const device = await adapter.requestDevice();
    const tex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: 0x04 /* GPUTextureUsage.TEXTURE_BINDING */ });
    tex.createView({ swizzle: 'rgba' });
    tex.destroy();
    device.destroy();
    return true;
  } catch {
    return false;
  }
}

export async function createRenderer(opts: { antialias: boolean; forceWebGL: boolean }) {
  const forceWebGL = opts.forceWebGL || !(await webgpuUsable());
  const renderer = new THREE.WebGPURenderer({ antialias: opts.antialias, forceWebGL });
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback';
  return { renderer, backend };
}
