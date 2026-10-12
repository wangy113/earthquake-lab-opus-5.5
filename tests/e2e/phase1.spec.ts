import { test, expect } from '@playwright/test';

// Phase 1 vertical slice in a real (headless) browser: assets load, the page renders, and the
// quake collapses the soft story the same way as the Node tests. Headless Chromium renders with
// SwiftShader at about 1 fps, so the test fast-forwards the simulation through window.__lab.
test('soft story collapses in the browser', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__lab?.ready || (window as any).__lab?.error, null, { timeout: 120_000 });
  expect(await page.evaluate(() => (window as any).__lab.error ?? null)).toBeNull();
  await page.screenshot({ path: info.outputPath('before.png'), timeout: 120_000 });

  const rep = await page.evaluate(() => {
    const lab = (window as any).__lab;
    lab.start();
    lab.fastForward(12);
    return lab.report();
  });
  console.log('report:', JSON.stringify({ failedAt: rep.failedAt, drop: rep.blockDrop, bodies: rep.bodies }));
  expect(rep.failedAt).toBeGreaterThan(3);
  expect(rep.failedAt).toBeLessThan(12);
  expect(rep.blockDrop).toBeGreaterThan(1.5);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: info.outputPath('after.png'), timeout: 120_000 });
  expect(await page.locator('#note').textContent()).toContain('failed');
  expect(errors).toEqual([]);
});
