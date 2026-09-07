import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  const p = await browser.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(vite.resolvedUrls.local[0] + 'tools/fixtures/work-lights.html'); await p.waitForFunction(() => window.ready);
  const off = await p.evaluate(() => window.runWorkLights(0)), on = await p.evaluate(() => window.runWorkLights(1));
  const below = await p.evaluate(() => window.runWorkLights(1, true)), reversed = await p.evaluate(() => window.runWorkLights(1, false, true));
  assert.ok(on.red > 100 && on.lit > 500, 'The actual vessel shader illuminates the working deck');
  assert.ok(on.red > on.green && on.green > on.blue, 'The work lights have a warm spectrum');
  assert.ok(off.red < .001 && below.red < .001 && reversed.red < .001, 'Light switches off, respects its beam and cannot pass through the deck');
  assert.equal(on.calls, 1, 'Both lights shade in the existing surface draw'); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ off, on, below, reversed, errors }));
} finally { await browser.close(); await vite.close(); }
