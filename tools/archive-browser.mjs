import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';

const tag = process.argv[2] || 'review', out = `tools/shots/archive-${tag}`;
const securedOnly = process.argv.includes('--secured-only');
await fs.mkdir(out, { recursive: true });
const app = createGameServer({ ...simulation, createWorld() { const w = simulation.createWorld(); Object.assign(w.ship, { x: w.cargo.x, z: w.cargo.z + 6.82, heading: 0 }); w.mission = 'dive'; return w; },
  addPlayer(w, id, name) { const p = simulation.addPlayer(w, id, name); Object.assign(p, { mode: 'diver', x: w.cargo.x + 3, y: w.cargo.y + 2.5, z: w.cargo.z + 5 }); return p; } });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${app.server.address().port}` } } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage(), errors = [], views = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const settle = () => page.evaluate(async () => { for (let i = 0; i < 24; i++) await new Promise(requestAnimationFrame); });
try {
  await page.goto(`${vite.resolvedUrls.local[0]}?mode=expedition&preset=high&adaptive=0&profile=1`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver' && window.__app.game.net.ready);
  await page.evaluate(() => {
    const a = window.__app, g = a.game, w = structuredClone(g.state); w.time = 20; window.archiveFixture = w;
    g.net.interpolated = () => w; g.root.style.visibility = 'hidden';
    const before = a.beforeUpdate; a.beforeUpdate = (scaled, dt) => { g.state = w; before(scaled, dt); if (window.archiveSun != null) { a.weather.set({ sunElevation: window.archiveSun }, true); a.weather.update(0); } };
  });
  const capture = async (name, offset, { sun = .55, storm = 0, recovered = false, cargoY, lamp = 'off' } = {}) => {
    await page.evaluate(({ sun, storm, recovered, cargoY, lamp }) => {
      const g = window.__app.game, w = window.archiveFixture;
      window.archiveSun = sun; w.storm = storm; w.cargo.recovered = recovered; w.cargo.attached = recovered || cargoY !== undefined;
      if (cargoY !== undefined) w.cargo.y = cargoY;
      g.diveLight.mode = lamp;
    }, { sun, storm, recovered, cargoY, lamp });
    await settle();
    await page.evaluate(offset => {
      const g = window.__app.game, w = window.archiveFixture, p = w.players[g.net.id], target = g.models.crate.position.clone();
      target.y += .35; Object.assign(p, { x: target.x + offset[0], y: target.y + offset[1], z: target.z + offset[2] });
      g.yaw = Math.atan2(-offset[0], -offset[2]); g.pitch = Math.atan2(-offset[1], Math.hypot(offset[0], offset[2])); g.cameraSnap = true;
    }, offset);
    await settle(); await page.screenshot({ path: `${out}/${name}.png` });
    const state = await page.evaluate(() => {
      const a = window.__app, g = a.game, m = g.models, water = m.copies[m.originals.indexOf(m.crate)], point = a.camera.position.clone();
      const eye = m.crate.localToWorld(point.clone().set(0, 1.39, 0));
      return { camera: a.camera.position.toArray(), crate: m.crate.position.toArray(), cable: m.cable.visible,
        cableError: m.cable.visible ? m.cable.localToWorld(point.clone().set(0, .5, 0)).distanceTo(eye) : null,
        waterPositionError: water.position.distanceTo(m.crate.position), waterRotationError: water.quaternion.angleTo(m.crate.quaternion) };
    });
    assert.ok(state.waterPositionError < 1e-8 && state.waterRotationError < 1e-6);
    if (state.cable) assert.ok(state.cableError < 1e-6);
    views.push({ name, ...state });
  };
  if (!securedOnly) {
    await capture('01-seabed-day', [3, 2.5, 5]);
    await capture('02-seabed-golden', [3, 2.5, 5], { sun: .08 });
    await capture('03-seabed-storm', [3, 2.5, 5], { sun: .3, storm: .85, lamp: 'on' });
    await capture('04-eye-close', [1.5, 1.8, 2.4], { lamp: 'on' });
    await capture('05-lifting', [3, 2, 5], { cargoY: -8 });
    await capture('06-waterline', [3, .8, 5], { cargoY: .2 });
  }
  await capture('07-secured', [3, 2.3, -5], { recovered: true });
  if (!securedOnly) {
    await capture('08-high-200', [40, 200, 80], { recovered: true });
    await capture('09-high-1000', [180, 1000, 350], { recovered: true });
  }
  await capture('10-secured-close', [1.7, 1.6, -2.8], { recovered: true });
  const technical = await page.evaluate(async () => {
    const a = window.__app, m = a.game.models; let meshes = 0, triangles = 0, finite = true;
    m.crate.traverse(o => { if (!o.isMesh) return; meshes++; triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; finite &&= o.geometry.attributes.position.array.every(Number.isFinite); });
    a.profiler.reset(); for (let i = 0; i < 40; i++) await new Promise(requestAnimationFrame);
    return { meshes, triangles, finite, passes: a.profiler.report() };
  });
  assert.ok(technical.finite && technical.meshes <= 12 && technical.triangles < 20000); assert.deepEqual(errors, []);
  const result = { recordedAt: new Date().toISOString(), source: 'current Vite source', preset: 'high', views, technical, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await vite.close(); await app.stop(); }
