import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  const p = await browser.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(vite.resolvedUrls.local[0] + 'tools/fixtures/dive-splash.html'); await p.waitForFunction(() => window.ready);
  const visible = await p.evaluate(() => window.runSplash());
  assert.ok(visible.pixels > 40 && visible.maxColor > .005 && visible.maxAlpha < .8);
  assert.ok(visible.error < 1e-5 && visible.expectedMotion > .01, 'Motion attachment follows the droplets');
  const near = await p.evaluate(() => window.runSplash(true)); assert.equal(near.pixels, 0, 'Spray cannot obscure the eye');
  const dark = await p.evaluate(() => window.runSplash(false, true)); assert.equal(dark.maxColor, 0, 'Spray is not self-lit');
  for (const sample of [visible, near, dark]) assert.equal(sample.glError, 0);
  assert.deepEqual(errors, []); console.log(JSON.stringify({ visible, near, dark, errors }));
} finally { await browser.close(); await vite.close(); }
