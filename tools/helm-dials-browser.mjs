import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/helm-dials'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck' && window.__app.game.net.ready);
  await p.keyboard.press('h'); await p.waitForFunction(() => window.__app.game.lastMode === 'helm'); await p.keyboard.press('c'); await p.keyboard.press('Home');
  await p.evaluate(async () => { for (let i = 0; i < 16; i++) await new Promise(requestAnimationFrame); });
  await p.screenshot({ path: `${out}/01-live-helm.png` });
  const layouts = [];
  for (const width of [600, 390]) {
    await p.setViewport({ width, height: 800 }); await p.evaluate(async () => { for (let i = 0; i < 16; i++) await new Promise(requestAnimationFrame); });
    const layout = await p.evaluate(() => {
      const a = window.__app, points = [];
      for (const dial of [a.game.models.helm.compass, a.game.models.helm.speed]) for (let i = 0; i < 36; i++) {
        const angle = i * Math.PI / 18, v = a.camera.position.clone().set(Math.cos(angle) * .135, Math.sin(angle) * .135, 0);
        dial.localToWorld(v).project(a.camera); points.push((v.x * .5 + .5) * innerWidth);
      }
      return { width: innerWidth, fov: a.camera.fov, left: Math.min(...points), right: Math.max(...points) };
    });
    await p.screenshot({ path: `${out}/04-dials-${width}.png` });
    assert.ok(layout.left > 8 && layout.right < width - 8, `Both gauges must fit: ${JSON.stringify(layout)}`); layouts.push(layout);
  }
  await p.setViewport({ width: 1440, height: 900 }); await p.evaluate(async () => { for (let i = 0; i < 16; i++) await new Promise(requestAnimationFrame); });
  await p.evaluate(() => {
    const a = window.__app, g = a.game; a.running = false; a.paused = true; a.beforeUpdate = null; a.afterUpdate = null; g.net.close(); g.root.hidden = true;
    window.dialWorld = structuredClone(g.frameWorld);
    window.showDials = (bearing = 0, knots = 10, condition = 'day', height = null) => {
      const w = structuredClone(window.dialWorld), s = w.ship;
      s.heading = -bearing * Math.PI / 180; s.speed = knots / 1.944; s.pitch = s.roll = s.yawRate = 0;
      const weather = { day: { sunElevation: .55, cloudCoverage: .35, storm: 0 }, golden: { sunElevation: .07, cloudCoverage: .35, storm: 0 }, storm: { sunElevation: .25, cloudCoverage: .98, storm: .9 }, night: { sunElevation: -.25, cloudCoverage: .2, storm: 0 } }[condition];
      a.weather.set(weather, true); a.weather.update(0); g.models.update(w, g.net.id, 'deck');
      Object.assign(a.post.settings, condition === 'night' ? { fixedExposure: 2.6, fixedExposureMix: 1 } : g.diveLight.surfaceExposure);
      const ship = g.models.ship, v = (x, y, z) => a.camera.position.clone().set(x, y, z);
      a.camera.position.copy(ship.localToWorld(v(0, height ?? 3.6, height ? 5.1 - height * .2 : 5.1)));
      a.camera.lookAt(ship.localToWorld(v(0, height ? 2 : 3.6 + Math.tan(-.3) * 30, height ? 0 : 35.1)));
      a.camera.fov = 65; a.camera.aspect = innerWidth / innerHeight; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld();
      a.post.reset = a.clouds.reset = true; a.frame = 32; for (let i = 0; i < 16; i++) a.render(0);
      const card = g.models.helm.compass, letter = 'NESW'[Math.round(bearing / 90) % 4], label = card.getObjectByName(`Dial ${letter}`);
      const center = card.localToWorld(v(0, 0, 0)).project(a.camera), point = label.localToWorld(v(0, 0, 0)).project(a.camera), top = label.localToWorld(v(0, .02, 0)).project(a.camera);
      const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 90; const c = canvas.getContext('2d'); c.drawImage(a.renderer.domElement, 0, 0, 144, 90); const pixels = c.getImageData(0, 0, 144, 90).data;
      let light = 0; for (let i = 0; i < pixels.length; i += 4) light += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / (3 * 255);
      return { letter, deltaX: point.x - center.x, deltaY: point.y - center.y, upright: top.y > point.y, speedAngle: g.models.helm.speed.rotation.z, light: light / (144 * 90), error: a.renderer.getContext().getError() };
    };
  });
  const headings = [], conditions = [], scales = [];
  for (const bearing of [0, 90, 180, 270]) {
    const r = await p.evaluate(bearing => window.showDials(bearing), bearing);
    assert.ok(Math.abs(r.deltaX) < .02 && r.deltaY > .035 && r.upright, 'The heading cardinal is upright beneath the fixed top index'); assert.ok(Math.abs(r.speedAngle) < 1e-12); assert.equal(r.error, 0); assert.ok(r.light > .05);
    headings.push({ bearing, ...r }); await p.screenshot({ path: `${out}/02-bearing-${bearing}.png` });
  }
  for (const condition of ['day', 'golden', 'storm', 'night']) {
    const r = await p.evaluate(condition => window.showDials(0, 5, condition), condition); assert.equal(r.error, 0); conditions.push({ condition, ...r }); await p.screenshot({ path: `${out}/03-${condition}.png` });
  }
  for (const height of [200, 1000]) {
    const r = await p.evaluate(height => window.showDials(0, 10, 'day', height), height); assert.equal(r.error, 0); scales.push({ height, ...r }); await p.screenshot({ path: `${out}/05-scale-${height}.png` });
  }
  const timing = await p.evaluate(async () => {
    window.showDials(); const a = window.__app, r = a.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return { available: false };
    const values = [], draw = () => { r.setRenderTarget(a.hdrRT); r.clear(); r.render(a.scene, a.camera); }; for (let i = 0; i < 8; i++) draw(); gl.finish();
    for (let i = 0; i < 20; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); draw(); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise(r => setTimeout(r, 10));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) values.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
    }
    values.sort((a, b) => a - b); return { median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)], samples: values.length };
  });
  assert.deepEqual(errors, []); const result = { headings, conditions, scales, layouts, airSceneGpuMs: timing, errors }; await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
