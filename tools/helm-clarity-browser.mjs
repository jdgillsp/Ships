import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = `tools/shots/helm-clarity${process.argv[2] ? `-${process.argv[2]}` : ''}`; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [], views = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.net.ready && g.lastMode === 'deck'; });
  await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm'); await page.keyboard.press('c');
  await page.evaluate(() => { const g = window.__app.game, w = structuredClone(g.frameWorld); w.time = 20; w.ship.pitch = w.ship.roll = 0; g.net.interpolated = () => w; });
  for (const width of [1280, 390]) for (const [preset, taa] of [['low', true], ['high', true], ['high', false]]) {
    await page.setViewport({ width, height: 800 });
    await page.evaluate(({ preset, taa }) => { const a = window.__app; a.setQualityPreset(preset); a.post.settings.taa = taa; a.post.reset = a.clouds.reset = true; a.game.cameraSnap = true; }, { preset, taa });
    await page.evaluate(async () => { for (let i = 0; i < 32; i++) await new Promise(requestAnimationFrame); });
    const name = `${width}-${preset}-${taa ? 'taa' : 'raw'}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    const view = await page.evaluate(() => {
      const a = window.__app, p = a.post.settings;
      const dial = a.game.models.helm.compass, v = a.camera.position.clone();
      const left = dial.localToWorld(v.set(-.12, 0, 0)).project(a.camera).x;
      const right = dial.localToWorld(v.set(.12, 0, 0)).project(a.camera).x;
      return { width: innerWidth, renderWidth: a.renderWidth, renderHeight: a.renderHeight, dof: p.dof, motionBlur: p.motionBlur, taa: p.taa, dialPixels: Math.abs(left - right) * .5 * a.renderWidth };
    });
    assert.equal(view.dof, false); assert.equal(view.motionBlur, false); views.push({ name, ...view });
  }
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), views, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
