import { test, expect } from '@playwright/test';

// The street in a real (headless) browser: assets load, all five buildings render, every
// time-of-day preset loads, and the quake collapses the soft story the same way as the Node
// tests while the neighbors sway. Headless Chromium renders with SwiftShader at about 1 fps,
// so the test fast-forwards the simulation through window.__lab.
test('the street loads, and the soft story collapses in the quake', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__lab?.ready || (window as any).__lab?.error, null, { timeout: 180_000 });
  expect(await page.evaluate(() => (window as any).__lab.error ?? null)).toBeNull();
  const stats = await page.evaluate(() => (window as any).__lab.stats);
  expect(stats.buildingTris).toHaveLength(4);
  for (const t of stats.buildingTris) expect(t).toBeGreaterThan(1000);
  await page.screenshot({ path: info.outputPath('before.png'), timeout: 120_000 });

  for (const sky of ['golden', 'overcast', 'clear', 'midday']) {
    await page.evaluate(s => (window as any).__lab.sky(s), sky);
    expect(await page.evaluate(() => (window as any).__lab.stats.sky)).toBe(sky);
  }

  const rep = await page.evaluate(() => {
    const lab = (window as any).__lab;
    lab.start();
    lab.fastForward(12);
    return lab.report();
  });
  console.log('report:', JSON.stringify({ failedAt: rep.failedAt, drop: rep.blockDrop, bodies: rep.bodies, neighbors: rep.neighbors }));
  expect(rep.failedAt).toBeGreaterThan(3);
  expect(rep.failedAt).toBeLessThan(12);
  expect(rep.blockDrop).toBeGreaterThan(1.5);
  expect(rep.neighbors).toHaveLength(4);
  for (const n of rep.neighbors) expect(n.peakDrift).toBeGreaterThan(1e-4);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: info.outputPath('after.png'), timeout: 120_000 });
  expect(await page.locator('#note').textContent()).toBeTruthy();
  expect(errors).toEqual([]);
});
