import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { oceanFloor, connectedHabitat } from '../src/underwater/OceanDomain.js';
import { HABITATS } from '../src/underwater/WorldMath.js';

const { server } = createGameServer({ ...simulation, addPlayer(w, id, name) {
  const p = simulation.addPlayer(w, id, name); p.mode = 'diver'; p.x = -140; p.z = 140; p.y = oceanFloor(p.x, p.z, simulation.RECIPE) + 6; return p;
} });
server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${server.address().port}` } } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const p = await browser.newPage(), errors = [], results = {}, out = 'tools/shots/dive-light'; await fs.mkdir(out, { recursive: true });
p.on('pageerror', e => errors.push(e.message));
const settle = () => p.evaluate(async () => { for (let i = 0; i < 25; i++) await new Promise(requestAnimationFrame); });
const level = () => p.evaluate(() => window.lightUniforms.uLamp.value);
try {
  await useExpandedTools(p); await p.goto(vite.resolvedUrls.local[0] + '?mode=expedition&preset=low&adaptive=0');
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver' && window.__app.game.net.ready);
  await p.evaluate(async () => {
    const { U } = await import('/src/core/SharedUniforms.js'); window.lightUniforms = U;
    const a = window.__app, g = a.game, fixed = structuredClone(g.state); fixed.time = 20;
    window.lightFixture = fixed; g.net.interpolated = () => fixed; g.yaw = Math.PI / 6; g.pitch = -.25;
    const before = a.beforeUpdate; a.beforeUpdate = (scaled, dt) => {
      g.state = fixed; before(scaled, dt);
      if (window.sunFixture !== undefined) { a.weather.set({ sunElevation: window.sunFixture }, true); a.weather.update(0); }
    };
  });
  await settle(); results.day = await level(); assert.ok(results.day < .01, 'A daylight reef does not use the full-power headlamp');
  await p.keyboard.press('t'); await settle(); results.on = await level(); assert.equal(results.on, 1);
  await p.screenshot({ path: `${out}/01-full-power.png` });
  await p.click('#dive-light'); await settle(); results.off = await level(); assert.equal(results.off, 0);
  await p.keyboard.press('t'); await settle(); assert.equal(await p.evaluate(() => window.__app.game.diveLight.mode), 'auto');
  await p.screenshot({ path: `${out}/02-day-auto.png` });
  for (const width of [600, 390]) {
    await p.setViewport({ width, height: 800 }); await settle();
    assert.ok(await p.$eval('#dive-light', e => { const r = e.getBoundingClientRect(), c = e.closest('.ship-console').getBoundingClientRect(); return r.left >= c.left && r.right <= c.right && r.bottom <= c.bottom; }));
    await p.screenshot({ path: `${out}/03-controls-${width}.png` });
  }
  await p.setViewport({ width: 1280, height: 800 });
  await p.evaluate(() => { window.sunFixture = .1; }); await settle(); results.dusk = await level();
  await p.screenshot({ path: `${out}/04-dusk-auto.png` });
  await p.evaluate(() => { delete window.sunFixture; window.lightFixture.storm = .85; }); await settle(); results.storm = await level();
  await p.screenshot({ path: `${out}/04-storm-auto.png` });
  await p.evaluate(() => { window.lightFixture.storm = 0; window.sunFixture = -.2; }); await settle(); results.night = await level(); assert.ok(results.night > .75);
  await p.screenshot({ path: `${out}/04-night-auto.png` });
  await p.evaluate(pose => {
    delete window.sunFixture; const g = window.__app.game, w = window.lightFixture, s = w.players[g.net.id];
    [s.x, s.y, s.z] = pose.eye; const [x, y, z] = pose.look;
    g.yaw = Math.atan2(x - s.x, z - s.z); g.pitch = Math.atan2(y - s.y, Math.hypot(x - s.x, z - s.z)); g.cameraSnap = true;
  }, connectedHabitat(HABITATS.find(h => h.id === 'deep'), 713));
  await settle(); results.deep = await level(); assert.ok(results.deep > .98);
  assert.equal(await p.evaluate(() => window.__app.post.settings.fixedExposure), 1.5);
  assert.equal(await p.evaluate(() => window.__app.post.settings.fixedExposureMix), 1);
  await p.screenshot({ path: `${out}/05-deep-auto.png` });
  await p.keyboard.press('t'); await p.keyboard.press('t'); await settle(); assert.equal(await level(), 0, 'Manual off works even in the abyss');
  await p.keyboard.press('t'); await p.evaluate(() => { const g = window.__app.game; window.lightFixture.players[g.net.id].mode = 'deck'; });
  await settle(); assert.equal(await level(), 0); assert.equal(await p.$eval('#dive-light', e => e.hidden), true);
  assert.deepEqual(await p.evaluate(() => { const g = window.__app.game, s = g.app.post.settings; return { fixedExposure: s.fixedExposure, fixedExposureMix: s.fixedExposureMix }; }), await p.evaluate(() => window.__app.game.diveLight.surfaceExposure));
  assert.equal(await p.$eval('#camera-view', e => e.hidden), false);
  assert.deepEqual(errors, []); await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log('PASS: daylight, night and deep automatic light; real key/button cycling; phone layout; manual off and boarding', JSON.stringify(results));
} finally { await browser.close(); await vite.close(); server.closeAllConnections(); server.close(); }
