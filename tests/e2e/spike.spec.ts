import { test, expect } from '@playwright/test';

// Phase 0 spike: both sky strategies load every Poly Haven asset and render without errors.
// Headless Chromium uses SwiftShader, so frame rates here mean nothing. Screenshots land in
// test-results/ for side-by-side review.
for (const sky of ['a', 'b']) {
  test(`facade spike renders with sky strategy ${sky.toUpperCase()}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/?sky=${sky}`);
    await page.waitForFunction(() => (window as any).__lab?.ready || (window as any).__lab?.error, null, { timeout: 90_000 });
    expect(await page.evaluate(() => (window as any).__lab.error ?? null)).toBeNull();
    await page.waitForTimeout(5000);
    const stats = await page.evaluate(() => (window as any).__lab.stats);
    console.log(`sky ${sky}:`, JSON.stringify(stats));
    await page.screenshot({ path: info.outputPath(`sky-${sky}.png`), timeout: 120_000 });
    expect(stats.fps).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
