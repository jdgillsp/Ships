import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  const p = await browser.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(vite.resolvedUrls.local[0] + 'tools/fixtures/bubble-material.html'); await p.waitForFunction(() => window.ready);
  const visible = await p.evaluate(() => window.runBubbles());
  assert.ok(visible.pixels > 40 && visible.maxColor > .005, 'The bubble draws a visible translucent rim');
  assert.ok(visible.maxAlpha < .8 && visible.maxAlpha > .1, 'The bubble stays translucent');
  assert.ok(visible.error < 1e-5 && visible.expectedMotion > .01, 'Both render attachments carry the actual bubble movement');
  const near = await p.evaluate(() => window.runBubbles(true)); assert.equal(near.pixels, 0, 'A bubble next to the eye cannot cover the view');
  const deep = await p.evaluate(() => window.runBubbles(false, 600));
  const lit = await p.evaluate(() => window.runBubbles(false, 600, 1));
  assert.ok(deep.maxColor < .0001, 'Bubbles do not glow in unlit deep water');
  assert.ok(lit.maxColor > .005, 'A nearby dive lamp reveals bubbles in the deep');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ visible, near, deep, lit, errors }));
} finally { await browser.close(); await vite.close(); }
