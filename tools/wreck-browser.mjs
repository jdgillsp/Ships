import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';

const tag = process.argv[2] || 'after', floor = oceanFloor(simulation.WRECK.x, simulation.WRECK.z, simulation.RECIPE);
const app = createGameServer({ ...simulation, createWorld() { const w = simulation.createWorld(); Object.assign(w.ship, { x: w.cargo.x, z: w.cargo.z, anchor: true }); w.mission = 'dive'; return w; },
  addPlayer(w, id, name) { const p = simulation.addPlayer(w, id, name); Object.assign(p, { mode: 'diver', x: simulation.WRECK.x + 14, y: floor + 9, z: simulation.WRECK.z - 17 }); return p; } });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${app.server.address().port}` } } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const p = await browser.newPage(), errors = [], out = `tools/shots/wreck-${tag}`; await fs.mkdir(out, { recursive: true });
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const settle = () => p.evaluate(async () => { for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame); });
try {
  await p.goto(vite.resolvedUrls.local[0] + '?mode=expedition&preset=low&adaptive=0&profile=1');
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await p.evaluate(async target => {
    const { U } = await import('/src/core/SharedUniforms.js'); window.wreckUniforms = U;
    const a = window.__app, g = a.game, fixed = structuredClone(g.state); fixed.time = 20; window.wreckFixture = fixed;
    g.net.interpolated = () => fixed; g.yaw = Math.atan2(target.x - a.camera.position.x, target.z - a.camera.position.z); g.pitch = -.3; g.root.style.visibility = 'hidden';
    const before = a.beforeUpdate; a.beforeUpdate = (scaled, dt) => { g.state = fixed; before(scaled, dt); if (window.wreckSun != null) { a.weather.set({ sunElevation: window.wreckSun }, true); a.weather.update(0); } };
  }, simulation.WRECK);
  await settle(); await p.screenshot({ path: `${out}/01-approach-day.png` });
  await p.evaluate(() => { window.wreckSun = .08; }); await settle(); await p.screenshot({ path: `${out}/02-approach-dusk.png` });
  await p.evaluate(() => { window.wreckSun = null; window.wreckFixture.storm = .85; }); await settle(); await p.screenshot({ path: `${out}/03-approach-storm.png` });
  await p.evaluate(({ x, y, z }) => { const g = window.__app.game, s = window.wreckFixture.players[g.net.id]; window.wreckFixture.storm = 0; Object.assign(s, { x: x + 4, y: y + 4, z: z - 7 }); g.yaw = -.6; g.pitch = -.35; g.cameraSnap = true; g.diveLight.mode = 'on'; }, { ...simulation.WRECK, y: floor });
  await settle(); await p.screenshot({ path: `${out}/04-interior.png` });
  await p.evaluate(({ x, y, z }) => { const g = window.__app.game, s = window.wreckFixture.players[g.net.id]; Object.assign(s, { x: x + 28, y: y + 22, z: z - 32 }); g.yaw = -.72; g.pitch = -.45; g.cameraSnap = true; }, { ...simulation.WRECK, y: floor });
  await settle(); await p.screenshot({ path: `${out}/05-wide.png` });
  await p.evaluate(({ x, y, z }) => { const g = window.__app.game, s = window.wreckFixture.players[g.net.id]; Object.assign(s, { x: x + 20, y: y + 6, z: z + 6 }); g.yaw = -1.85; g.pitch = -.22; g.cameraSnap = true; }, { ...simulation.WRECK, y: floor });
  await settle(); await p.screenshot({ path: `${out}/06-mooring.png` });
  const result = await p.evaluate(async () => {
    const a = window.__app, m = a.game.models, geometry = { meshes: 0, triangles: 0, vertices: 0 };
    m.wreck.traverse(o => { if (!o.isMesh) return; geometry.meshes++; geometry.vertices += o.geometry.attributes.position.count; geometry.triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; });
    a.profiler.reset(); for (let i = 0; i < 40; i++) await new Promise(requestAnimationFrame);
    const line = m.mooring, point = a.camera.position.clone();
    const bottom = line ? line.localToWorld(point.clone().set(0, -.5, 0)).y : null;
    const top = line ? line.localToWorld(point.clone().set(0, .5, 0)).y : null;
    return { geometry, passes: a.profiler.report(), waterMatches: m.originals.length === m.copies.length, lamp: window.wreckUniforms.uLamp.value,
      mooring: line ? { bottomError: Math.abs(bottom - m.mooringFloor - .48), topError: Math.abs(top - m.buoy.position.y + .35) } : null };
  });
  assert.equal(result.waterMatches, true); assert.deepEqual(errors, []);
  if (tag !== 'before') { assert.ok(result.mooring?.bottomError < 1e-6 && result.mooring?.topError < 1e-6); assert.ok(result.geometry.meshes <= 7 && result.geometry.triangles < 20000); }
  const evidence = { recordedAt: new Date().toISOString(), ...result, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
} finally { await browser.close(); await vite.close(); await app.stop(); }
