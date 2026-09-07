import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/deck-camera'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const sample = () => p.evaluate(() => { const g = window.__app.game, player = g.frameWorld.players[g.net.id], camera = g.models.ship.worldToLocal(g.app.camera.position.clone()); return { camera: camera.toArray(), x: player.deckX, z: player.deckZ, view: g.view, mode: g.lastMode }; });
try {
  await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck');
  await p.keyboard.press('c'); await p.waitForFunction(() => document.getElementById('camera-view').textContent.includes('follow'));
  await sleep(400); const start = await sample(); await p.screenshot({ path: `${out}/01-follow.png` });
  await p.keyboard.down('w'); await sleep(900); await p.keyboard.up('w'); await sleep(400);
  const walking = await sample(); assert.ok(walking.z - start.z > 1.4); assert.ok(walking.camera[2] - start.camera[2] > 1.2, 'The camera follows the crewmate along the deck');
  assert.ok(await p.evaluate(() => { const g = window.__app.game, index = Object.keys(g.frameWorld.players).indexOf(g.net.id); return g.models.crew[index].visible; }), 'The player remains visible in the follow view');
  await p.screenshot({ path: `${out}/02-walking.png` });
  await p.mouse.move(720, 420); await p.mouse.wheel({ deltaY: 400 }); await sleep(300);
  assert.ok(await p.evaluate(() => window.__app.game.walkZoom > 10));
  await p.keyboard.press('Home'); assert.equal(await p.evaluate(() => window.__app.game.walkZoom), 7.5);
  await p.keyboard.press('h'); await p.waitForFunction(() => window.__app.game.lastMode === 'helm');
  assert.equal((await sample()).view, 'chase'); await p.keyboard.press('h');
  await p.waitForFunction(() => window.__app.game.lastMode === 'deck' && document.getElementById('camera-view').textContent.includes('follow'));
  await p.keyboard.press('l'); await p.waitForFunction(() => window.__app.game.lookout); await p.keyboard.press('l'); assert.equal((await sample()).view, 'chase');
  // Orbit around the cabin from the foredeck and check the final smoothed camera.
  const results = await p.evaluate(async () => {
    const g = window.__app.game, snapshots = [];
    for (let i = 0; i < 24; i++) {
      g.orbit = i * Math.PI / 12; g.orbitPitch = .15;
      for (let j = 0; j < 4; j++) await new Promise(requestAnimationFrame);
      const q = g.models.ship.worldToLocal(g.app.camera.position.clone());
      snapshots.push(q.toArray());
    }
    return snapshots;
  });
  for (const [x, y, z] of results) assert.ok(!(Math.abs(x) < 2.15 && y > 1.8 && y < 4.45 && z > -.15 && z < 4.75), 'The follow camera stays outside the cabin');
  await p.keyboard.press('Home'); await sleep(400); await p.screenshot({ path: `${out}/03-bow.png` });
  const performance = await p.evaluate(async () => {
    const g = window.__app.game, update = g.update.bind(g), samples = [];
    g.update = dt => { const begin = window.performance.now(); update(dt); samples.push(window.performance.now() - begin); };
    for (let i = 0; i < 50; i++) await new Promise(requestAnimationFrame);
    g.update = update; samples.sort((a, b) => a - b); return { median: samples[Math.floor(samples.length / 2)], p95: samples[Math.floor(samples.length * .95)] };
  });
  for (const width of [600, 390]) {
    await p.setViewport({ width, height: 800 }); await sleep(400);
    await p.screenshot({ path: `${out}/04-follow-${width}.png` });
    const frame = await p.evaluate(() => { const g = window.__app.game, player = g.frameWorld.players[g.net.id], head = g.models.ship.localToWorld(g.app.camera.position.clone().set(player.deckX, 3.45, player.deckZ)).project(g.app.camera); return { head: (1 - head.y) * innerHeight / 2, consoleTop: document.querySelector('.ship-console').getBoundingClientRect().top }; });
    assert.ok(frame.head < frame.consoleTop - 15 && frame.head > 70, 'The crewmate is framed above the phone controls');
  }
  await p.keyboard.press('c'); await p.waitForFunction(() => window.__app.game.view === 'deck');
  await p.keyboard.press('v'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await p.click('[data-action="board"]'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck'); assert.equal((await sample()).view, 'deck');
  assert.deepEqual(errors, []);
  const result = { start, walking, collisionSamples: results.length, preferenceRestored: true, phoneWidths: [600, 390], updateCPU: performance, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
