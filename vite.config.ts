import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { exclude: ['@dimforge/rapier3d-simd-compat'] },
  build: { target: 'es2022' },
});
