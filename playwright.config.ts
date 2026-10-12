import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: { command: 'npx vite --port 5199 --strictPort', port: 5199, reuseExistingServer: true },
});
