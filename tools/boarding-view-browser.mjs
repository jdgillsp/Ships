import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/boarding-view'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition');
  await page.waitForFunction(() => { const g = window.__app.game; return g.net.ready && g.lastMode === 'deck'; });
  await page.keyboard.press('v'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await page.waitForFunction(() => window.__app.game.contextAction() === 'board');
  await page.keyboard.press('f'); await page.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await page.evaluate(async () => { for (let i = 0; i < 16; i++) await new Promise(requestAnimationFrame); });
  const inspect = () => page.evaluate(() => {
    const a = window.__app, g = a.game, ray = new g.crewAwareness.ray.constructor();
    const hits = [];
    for (let y = -.6; y <= .61; y += .2) for (let x = -.8; x <= .81; x += .2) {
      ray.setFromCamera({ x, y }, a.camera); ray.far = 1.5;
      const hit = ray.intersectObject(g.models.ship, true)[0];
      if (hit) hits.push({ x, y, distance: hit.distance, point: g.models.ship.worldToLocal(hit.point.clone()).toArray() });
    }
    const eye = g.models.ship.worldToLocal(a.camera.position.clone());
    return { eye: eye.toArray(), ownCrewVisible: g.models.crew[0].visible, orbit: g.orbit, hits, obstructed: hits.length / 63 };
  });
  const view = await inspect();
  await page.screenshot({ path: `${out}/01-boarded.png` });
  assert.ok(view.obstructed < .2, `Boarding should reveal the deck, not fill the view with nearby equipment (${Math.round(view.obstructed * 100)}% blocked)`);
  assert.ok(view.hits.every(h => h.distance > .3), 'Visible equipment must stay out of the near eye');
  const identity = await page.evaluate(() => { const g = window.__app.game; return { room: g.net.room, id: g.net.id }; });
  const world = app.rooms.get(identity.room).world, player = world.players[identity.id], poses = [];
  for (const side of [1, -1]) {
    Object.assign(player, { deckX: side * 2.5, deckZ: -5.5 }); world.storm = side === 1 ? 0 : .9;
    await page.waitForFunction(x => { const g = window.__app.game; return Math.abs(g.frameWorld.players[g.net.id].deckX - x) < .001; }, {}, player.deckX);
    await page.keyboard.press('Home');
    for (let turn = 0; turn < 8; turn++) {
      const from = await page.evaluate(() => window.__app.game.orbit);
      await page.keyboard.down('q');
      await page.waitForFunction(from => window.__app.game.orbit > from + Math.PI / 4, {}, from);
      await page.keyboard.up('q');
      const pose = await inspect();
      assert.ok(pose.hits.every(h => h.distance > .3), `Turning beside support ${side} must not enter the equipment`);
      assert.ok(Math.hypot(pose.eye[0] - player.deckX, pose.eye[1] - 3.6, pose.eye[2] - player.deckZ) < .6, 'Clearance stays close to the player');
      assert.equal(player.deckX, side * 2.5); assert.equal(player.deckZ, -5.5);
      poses.push({ side, orbit: pose.orbit, eye: pose.eye, nearest: Math.min(...pose.hits.map(h => h.distance)) });
    }
  }
  Object.assign(player, { deckX: 2.5, deckZ: -5.5 }); world.storm = 0;
  await page.waitForFunction(() => { const g = window.__app.game; return g.frameWorld.players[g.net.id].deckX === 2.5; });
  await page.keyboard.press('Home'); await page.setViewport({ width: 390, height: 800 });
  await page.evaluate(async () => { for (let i = 0; i < 16; i++) await new Promise(requestAnimationFrame); });
  const phone = await inspect(); assert.ok(phone.hits.every(h => h.distance > .3));
  await page.screenshot({ path: `${out}/02-boarded-phone.png` });
  assert.deepEqual(errors, []);
  const result = { recordedAt: new Date().toISOString(), view, poses, phone, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
