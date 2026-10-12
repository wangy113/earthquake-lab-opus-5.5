// Takes a headless screenshot of the running dev server (npm run dev -- --port 5199).
// Usage: node scripts/shot.mjs "?sky=b" out.png
import { chromium } from '@playwright/test';

const [, , query = '', out = 'shot.png'] = process.argv;
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', m => { if (m.type() !== 'debug') console.log(`console.${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => console.log(`pageerror: ${e.message}`));
await page.goto(`http://localhost:5199/${query}`);
await page.waitForFunction(() => window.__lab?.ready || window.__lab?.error, null, { timeout: 90_000 });
await page.waitForTimeout(5000);
console.log(JSON.stringify(await page.evaluate(() => window.__lab.stats ?? window.__lab.error)));
await page.screenshot({ path: out, timeout: 120_000 });
await browser.close();
