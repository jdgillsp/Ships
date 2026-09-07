import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${app.server.address().port}` } } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const p = await browser.newPage(), errors = [], out = 'tools/shots/work-lights'; await fs.mkdir(out, { recursive: true });
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const settle = () => p.evaluate(async () => { for (let i = 0; i < 18; i++) await new Promise(requestAnimationFrame); });
try {
  await p.goto(vite.resolvedUrls.local[0] + '?mode=expedition&preset=low&adaptive=0&profile=1');
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready);
  await p.evaluate(async () => {
    const { U } = await import('/src/core/SharedUniforms.js'), { updateVesselLighting } = await import('/src/game/VesselLighting.js');
    window.workU = U; window.workSun = .55; window.workStorm = 0; window.workEye = [8, 7, -12]; window.workAim = [0, 2.5, -2.5];
    const a = window.__app, g = a.game, w = structuredClone(g.state); w.time = 20; g.net.interpolated = () => w; g.root.style.visibility = 'hidden';
    const before = a.beforeUpdate;
    a.beforeUpdate = (scaled, dt) => {
      w.storm = window.workStorm; before(scaled, dt);
      a.weather.set({ sunElevation: window.workSun }, true); a.weather.update(0); updateVesselLighting(g.models.ship);
      if (window.workOff) U.uVesselLightLevel.value = 0;
      a.camera.position.copy(g.models.ship.localToWorld(a.camera.position.clone().fromArray(window.workEye)));
      a.camera.lookAt(g.models.ship.localToWorld(a.camera.position.clone().fromArray(window.workAim))); a.camera.updateMatrixWorld();
    };
  });
  const levels = [];
  for (const [label, sun, storm] of [['day', .55, 0], ['dusk', .04, 0], ['storm', .3, .95]]) {
    await p.evaluate(({ sun, storm }) => { window.workSun = sun; window.workStorm = storm; window.__app.post.reset = true; window.__app.clouds.reset = true; }, { sun, storm });
    await settle(); levels.push({ label, level: await p.evaluate(() => window.workU.uVesselLightLevel.value) });
    await p.screenshot({ path: `${out}/01-${label}.png` });
  }
  await p.evaluate(() => { window.workSun = .04; window.workStorm = 0; window.workEye = [2.5, 3.7, -5.4]; window.workAim = [0, 2.4, -.5]; });
  await settle(); await p.screenshot({ path: `${out}/02-deck-lit.png` });
  await p.evaluate(() => { window.workOff = true; }); await settle(); await p.screenshot({ path: `${out}/03-deck-unlit.png` });
  await p.evaluate(() => { window.workOff = false; window.workEye = [20, 17, -32]; }); await settle(); await p.screenshot({ path: `${out}/04-wide.png` });
  const profiles = {};
  for (const [label, off] of [['off', true], ['on', false]]) {
    await p.evaluate(off => { window.workOff = off; }, off); await settle();
    profiles[label] = await p.evaluate(async () => { const a = window.__app; a.profiler.reset(); for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame); return a.profiler.report(); });
  }
  assert.equal(levels[0].level, 0); assert.ok(levels[1].level > .95); assert.ok(levels[2].level >= .85);
  assert.deepEqual(errors, []); const result = { levels, profiles, errors }; await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await vite.close(); await app.stop(); }
