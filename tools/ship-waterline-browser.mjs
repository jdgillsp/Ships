import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { createWorld, tick } from '../src/game/Simulation.js';

// Minimized storm phase from the submerged-deck report; no live save or credentials.
const world = createWorld();
Object.assign(world, { time: 13294.699999946783, storm: .85, stormStart: 0, mission: 'return' });
Object.assign(world.ship, { x: -113.79371699719117, z: 260.27348742617505, y: 1.6029130354476375,
  heading: 3.298912083191148, pitch: -.007816064808884488, roll: -.05285964586256091, anchor: true, speed: 0 });
const sweep = process.argv.includes('--sweep'), high = process.argv.includes('--high');
const tag = high ? 'high' : sweep ? 'sweep' : 'repro', out = 'tools/shots/ship-waterline';
const snapshots = [];
for (let i = 0; i < (sweep ? 2400 : 1); i++) {
  tick(world, .05);
  if (i % 5 === 0) snapshots.push({ time: world.time, storm: world.storm, ship: structuredClone(world.ship) });
}
const server = createGameServer(); server.server.listen(0, '127.0.0.1');
await new Promise(r => server.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1000, height: 800 } });
try {
  const p = await browser.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && /Shader Error|VALIDATE_STATUS|Program Info Log/.test(m.text())) errors.push(m.text()); });
  await p.goto(`http://127.0.0.1:${server.server.address().port}/?mode=expedition&preset=${high ? 'high' : 'low'}&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await p.evaluate(snapshot => {
    const a = window.__app, g = a.game, w = structuredClone(g.frameWorld);
    // Isolate rendered physics snapshots from live networking for this GPU fixture.
    g.net.close(); g.net.ready = true; g.net.input = async () => {}; g.status = 'Connected';
    Object.assign(w, snapshot); w.players[g.net.id].mode = 'helm';
    g.state = w; g.net.interpolated = () => w; g.view = 'chase';
    g.settings.values.views.helm = 'chase'; g.cameraSnap = true;
  }, snapshots[0]);
  await p.evaluate(async () => { for (let i = 0; i < 40; i++) await new Promise(requestAnimationFrame); });
  const result = await p.evaluate(async snapshots => {
    const a = window.__app, g = a.game, probe = a.waterInterface;
    let worst = { clearance: Infinity }, samples = 0;
    for (const snapshot of snapshots) {
      Object.assign(g.frameWorld, snapshot); await new Promise(requestAnimationFrame);
      for (const z of [-6, 0, 6]) {
        const point = g.models.ship.localToWorld(a.camera.position.clone().set(0, 2.65, z));
        probe.counter = 0;
        const water = probe.sample({ position: point }), clearance = point.y - water;
        samples++;
        if (clearance < worst.clearance) worst = { time: snapshot.time, z, deck: point.y, water, clearance, snapshot };
      }
    }
    Object.assign(g.frameWorld, worst.snapshot);
    return { samples, worst };
  }, snapshots);
  await p.evaluate(async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); });
  await fs.mkdir(out, { recursive: true }); await p.screenshot({ path: `${out}/${tag}.png` });
  await fs.writeFile(`${out}/${tag}.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }));
  assert.deepEqual(errors, []);
  assert.ok(result.worst.clearance > .5, 'Rendered water covers the working deck');
} finally { await browser.close(); await server.stop(); }
