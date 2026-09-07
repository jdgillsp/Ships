import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 960, height: 720 } });
const out = 'tools/shots/vessel-surface'; await fs.mkdir(out, { recursive: true });
try {
  const p = await browser.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(vite.resolvedUrls.local[0] + 'tools/fixtures/vessel-surface.html'); await p.waitForFunction(() => window.ready);
  for (const mode of ['original', 'no-bump', 'no-shadow', 'normals']) {
    await p.evaluate(mode => window.surface(mode), mode); await p.screenshot({ path: `${out}/${mode}.png` });
  }
  const probes = [];
  const coverage = await p.evaluate(() => window.shadowCoverage());
  const profile = process.argv.includes('--profile') ? await p.evaluate(() => window.surfaceCost()) : undefined;
  await p.evaluate(nearest => { window.nearestFilter = nearest; }, process.argv.includes('--nearest'));
  for (const height of [.65, .1]) for (const occluder of [false, true]) {
    const result = await p.evaluate(({ height, occluder }) => window.shadowProbe(height, occluder), { height, occluder });
    probes.push({ height, occluder, ...result });
  }
  const vertical = await p.evaluate(() => window.shadowProbe(.65, false, true));
  const continuity = await p.evaluate(() => window.shadowProbe(.65, true, false, true));
  const result = { probes, vertical, continuity, coverage, profile, errors }; console.log(JSON.stringify(result));
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); assert.deepEqual(errors, []);
  for (const r of probes) {
    if (!r.occluder) assert.ok(r.litFraction > .995, `Unobstructed plane self-shadows at sun height ${r.height}: ${r.litFraction}`);
    else assert.ok(r.dark > 100 && r.litFraction > .6, 'The block must still cast a visible shadow');
  }
  assert.ok(vertical.litFraction > .99, 'A rounded vertical panel stays lit except at its beveled edges');
  assert.ok(coverage.radius < coverage.coverage - .2, 'The whole cutter stays inside the shadow map through heave, pitch, roll and any light direction');
  assert.ok(continuity.maxJump < .05, 'Sub-texel motion cannot jump between discrete shadow levels');
} finally { await browser.close(); await vite.close(); }
