// Takes a headless screenshot of the running dev server (npm run dev -- --port 5199).
// Usage: node scripts/shot.mjs "<query and hash>" out.png [quakeSeconds] [camera]
// NOUI=1 hides the panels. With quakeSeconds, the quake is started and the simulation fast-forwarded that far first.
import { chromium } from '@playwright/test';

const [, , query = '', out = 'shot.png', quakeSeconds, camera] = process.argv;
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', m => { if (!['debug', 'info'].includes(m.type())) console.log(`console.${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => console.log(`pageerror: ${e.message}`));
await page.goto(`http://localhost:5199/${query}`);
await page.waitForFunction(() => window.__lab?.ready || window.__lab?.error, null, { timeout: 120_000 });
if (process.env.NOUI) await page.addStyleTag({ content: '#console,#readouts,#title{display:none!important}' });
if (camera) await page.evaluate(c => window.__lab.camera(c), camera);
if (quakeSeconds) {
  await page.evaluate(s => { window.__lab.start(); window.__lab.fastForward(+s); }, quakeSeconds);
  console.log(JSON.stringify(await page.evaluate(() => { const r = window.__lab.report(); return { t: r.quakeTime, failedAt: r.failedAt, drop: r.blockDrop, bodies: r.bodies }; })));
}
await page.waitForTimeout(+(process.env.WAIT ?? 4000));
console.log(JSON.stringify(await page.evaluate(() => window.__lab.stats ?? window.__lab.error)));
await page.screenshot({ path: out, timeout: 120_000 });
await browser.close();
