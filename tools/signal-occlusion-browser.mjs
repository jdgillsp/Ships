import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/signal-occlusion'; await fs.mkdir(out, { recursive: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await page.keyboard.press('l'); await page.waitForSelector('#game.lookout-active');
  const result = await page.evaluate(() => {
    const a = window.__app, g = a.game, camera = a.camera, ship = g.models.ship;
    // Hold a single rendered vessel pose while testing real sightlines through
    // its cabin. The camera positions are on the walkable side deck.
    a.running = false; a.beforeUpdate = a.afterUpdate = null;
    window.occlusionHeartbeat = setInterval(() => g.net.input({}), 250);
    const point = coordinates => ship.localToWorld(camera.position.clone().fromArray(coordinates));
    camera.position.copy(point([2.5, 3.6, 2])); camera.lookAt(point([-8, 1, 2])); camera.updateMatrixWorld(true);
    const target = g.signals.aimPoint();
    const wall = g.signals.raycaster.intersectObject(ship, true)[0];
    return { target, wallDistance: wall?.distance, targetDistance: target ? camera.position.distanceTo(camera.position.clone().set(target.x, target.y, target.z)) : null };
  });
  console.log(JSON.stringify(result));
  assert.ok(result.wallDistance > 0 && result.wallDistance < 2, 'The center sightline hits the physical cabin wall');
  assert.equal(result.target, null, 'Scouting cannot mark water through the cabin');
  const identity = await page.evaluate(() => ({ room: window.__app.game.net.room, id: window.__app.game.net.id }));
  const world = app.rooms.get(identity.room).world;
  await page.click('#mark-location');
  await page.waitForFunction(() => window.__app.game.message.includes('blocks the view'));
  assert.equal(world.signalSequence, 0, 'A blocked pointer mark sends no misleading shared signal');
  await page.evaluate(() => {
    const a = window.__app; a.game.updateUI(a.game.state); a.post.reset = a.clouds.reset = true;
    for (let i = 0; i < 8; i++) a.render(0);
  });
  await page.screenshot({ path: `${out}/01-blocked-cabin.png` });
  const clear = await page.evaluate(() => {
    const g = window.__app.game, camera = g.app.camera, ship = g.models.ship;
    const point = coordinates => ship.localToWorld(camera.position.clone().fromArray(coordinates));
    camera.position.copy(point([-2.5, 3.6, 2])); camera.lookAt(point([-14, 1, 2])); camera.updateMatrixWorld(true);
    return { target: g.signals.aimPoint(), blocked: g.signals.aimObstructed };
  });
  assert.ok(clear.target); assert.equal(clear.blocked, false, 'Moving to a clear sightline resets the obstruction state');
  await page.click('#mark-location');
  await page.waitForFunction(id => !!window.__app.game.state.signals[id], {}, identity.id);
  assert.equal(world.signalSequence, 1);
  assert.equal(await page.evaluate(() => window.__app.game.message), '', 'A successful mark clears the previous obstruction response');
  assert.ok(Math.hypot(world.signals[identity.id].x - clear.target.x, world.signals[identity.id].z - clear.target.z) < .01);
  const dive = await page.evaluate(() => {
    const g = window.__app.game, camera = g.app.camera, ship = g.models.ship, p = g.frameWorld.players[g.net.id];
    const originalMode = p.mode; p.mode = 'diver';
    const point = coordinates => ship.localToWorld(camera.position.clone().fromArray(coordinates));
    camera.position.copy(point([5, -1, 0])); camera.lookAt(point([0, -1, 0])); camera.updateMatrixWorld(true);
    const target = g.signals.aimPoint(), hull = g.signals.raycaster.intersectObject(ship, true)[0];
    p.mode = originalMode;
    return { target, hull: hull?.point.toArray(), blocked: g.signals.aimObstructed };
  });
  assert.ok(dive.target && dive.hull); assert.equal(dive.blocked, false);
  assert.ok(Math.hypot(dive.target.x - dive.hull[0], dive.target.y - dive.hull[1], dive.target.z - dive.hull[2]) < .001, 'Divers can still mark the visible cutter hull');
  // A chart mark is an explicit navigation choice, independent of where the
  // binocular camera happens to face.
  world.players[identity.id].lastSignal = -Infinity;
  await page.evaluate(async () => {
    const g = window.__app.game;
    g.signals.aimObstructed = true;
    await g.signals.send({ x: g.state.ship.x, y: 0, z: g.state.ship.z - 40 });
  });
  assert.equal(world.signalSequence, 2, 'Explicit chart points remain available when the view was obstructed');
  const timing = await page.evaluate(() => {
    const g = window.__app.game, values = [], camera = g.app.camera, ship = g.models.ship;
    const point = coordinates => ship.localToWorld(camera.position.clone().fromArray(coordinates));
    camera.position.copy(point([2.5, 3.6, 2])); camera.lookAt(point([-8, 1, 2])); camera.updateMatrixWorld(true);
    for (let i = 0; i < 40; i++) { const start = performance.now(); g.signals.aimPoint(); values.push(performance.now() - start); }
    values.sort((a, b) => a - b); return { median: values[20], p95: values[38] };
  });
  console.log(JSON.stringify({ clear, dive, chartPoint: true, aimCostMs: timing, errors }));
  assert.deepEqual(errors, []);
} finally { await browser.close(); await app.stop(); }
