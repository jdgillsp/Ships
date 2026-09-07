import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/marker-detail'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck');
  const results = [];
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 800 });
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const result = await page.evaluate(() => {
      const a = window.__app, g = a.game, marker = g.objectiveMarker, camera = a.camera, w = g.frameWorld;
      // Hold the rendered scene; move a signal through small, repeatable aiming
      // and range changes at the detail thresholds using its production DOM.
      a.running = false; a.beforeUpdate = a.afterUpdate = null;
      camera.lookAt(camera.position.clone().add(camera.position.clone().set(1, 0, 0).applyQuaternion(g.models.ship.quaternion)));
      camera.updateMatrixWorld(true);
      const tan = Math.tan(camera.fov * Math.PI / 360);
      const update = (dx, dy = 0, distance = 100, key = 'buoy') => {
        const point = camera.localToWorld(camera.position.clone().set(dx * 100 * tan * camera.aspect, -dy * 100 * tan, -100));
        marker.update(w, g.net.id, camera, true, { key, label: 'Survey buoy', x: point.x, y: point.y, z: point.z, distance });
        return marker.element.classList.contains('marker-detail');
      };
      const reset = () => marker.update(w, g.net.id, camera, false);
      const jitter = (axis, threshold) => {
        reset(); update(0); const samples = [];
        for (let i = 0; i < 24; i++) samples.push(axis === 'x' ? update(threshold + (i % 2 ? .001 : -.001)) : update(0, threshold + (i % 2 ? .001 : -.001)));
        return samples;
      };
      const horizontal = jitter('x', .22), vertical = jitter('y', .25);
      reset(); update(.6, 0, 19.9); const range = [];
      for (let i = 0; i < 24; i++) range.push(update(.6, 0, i % 2 ? 20.1 : 19.9));
      const leavesRange = !update(.6, 0, 23), leavesAim = (update(0), !update(.35, .35));
      update(0); reset(); const hiddenResets = !update(.24);
      update(0); const targetResets = !update(.24, 0, 100, 'new-target');
      update(0); const retained = update(.225);
      a.post.reset = a.clouds.reset = true; for (let i = 0; i < 8; i++) a.render(0);
      return { width: innerWidth, horizontal, vertical, range, leavesRange, leavesAim, hiddenResets, targetResets, retained,
        labelVisible: marker.label.checkVisibility({ visibilityProperty: true }) };
    });
    console.log(JSON.stringify(result));
    await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('objective-marker')).opacity) > .99);
    await page.screenshot({ path: `${out}/${width}.png` });
    for (const field of ['horizontal', 'vertical', 'range']) assert.ok(result[field].every(Boolean), `${field}: small movements must not repeatedly flash signal details`);
    for (const field of ['leavesRange', 'leavesAim', 'hiddenResets', 'targetResets', 'retained', 'labelVisible']) assert.equal(result[field], true, field);
    results.push(result);
  }
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), results, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2));
} finally { await browser.close(); await app.stop(); }
