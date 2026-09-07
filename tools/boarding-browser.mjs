import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import { BOARDING_LADDER, boardingEntry } from '../src/game/Boarding.js';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/boarding'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], checks = [], layouts = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck' && window.__app.game.net.ready);
  const identity = await p.evaluate(() => { const n = window.__app.game.net; return { room: n.room, id: n.id }; }), w = app.rooms.get(identity.room).world;
  assert.equal(await p.$eval('[data-action=helm]', e => e.textContent), '[F] Take helm');
  await p.keyboard.press('i'); await p.waitForFunction(() => document.querySelector('[data-action=helm]').textContent === '[F] Take helm [H]'); await p.keyboard.press('Escape');
  checks.push('Quiet actions show one shortcut; full tools retain the direct shortcut');
  await p.keyboard.down('s'); await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].deckZ < -4.9; }); await p.keyboard.up('s');
  await p.waitForFunction(() => document.getElementById('play-readout').textContent.includes('Boarding ladder'));
  assert.equal(await p.evaluate(() => window.__app.game.contextAction()), 'dive');
  assert.equal(await p.$eval('[data-action=dive]', e => e.textContent), '[F] Enter water');
  await p.mouse.move(850, 220); await p.mouse.down(); await p.mouse.move(457, 470, { steps: 15 }); await p.mouse.up();
  await p.screenshot({ path: `${out}/01-ladder-on-deck.png` });
  const post = async (path, body, token) => { const r = await fetch(`${base}/api/rooms/${identity.room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); assert.ok(r.ok); return r.json(); };
  const peer = await post('join', { name: 'Rowan' }); await post('action', { action: 'helm' }, peer.token);
  Object.assign(w.ship, { anchor: false, speed: 6 });
  await p.waitForFunction(() => document.getElementById('play-readout').textContent.includes('slow below'));
  await p.keyboard.press('f'); assert.equal(await p.evaluate(() => window.__app.game.lastMode), 'deck');
  assert.equal(await p.evaluate(() => window.__app.game.contextAction()), null);
  await p.screenshot({ path: `${out}/02-wait-for-captain.png` }); checks.push('An occupied helm does not stop ladder access; a moving cutter correctly blocks diving');
  Object.assign(w.ship, { anchor: true, speed: 0 });
  await p.waitForSelector('[data-action=dive].suggested:enabled'); const expected = boardingEntry(w.ship);
  await p.keyboard.press('f'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver');
  const entered = await p.evaluate(() => { const g = window.__app.game; return { ...g.state.players[g.net.id], cameraYaw: g.yaw }; });
  assert.ok(Math.hypot(entered.x - expected.x, entered.z - expected.z) < .25);
  assert.ok(Math.abs(entered.cameraYaw - expected.yaw) < .001);
  await p.screenshot({ path: `${out}/03-entered-water.png` }); checks.push('Native F enters beside the ladder and looks out into open water');
  await p.waitForSelector('[data-action=board].suggested:enabled'); await p.keyboard.press('f'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await p.waitForFunction(() => document.getElementById('play-readout').textContent.includes('Boarding ladder'));
  const aboard = w.players[identity.id]; assert.equal(aboard.deckX, BOARDING_LADDER.deckX); assert.equal(aboard.deckZ, -5.5);
  checks.push('F climbs back to the same deck ladder');
  for (const width of [600, 390]) {
    await p.setViewport({ width, height: 800 }); await p.waitForFunction(width => innerWidth === width, {}, width);
    const r = await p.$eval('.ship-console', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; });
    assert.ok(r.left >= 0 && r.right <= width && r.height < 115); layouts.push({ width, ...r }); await p.screenshot({ path: `${out}/04-ladder-${width}.png` });
  }
  await p.keyboard.press('v'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver'); checks.push('The V shortcut still works');
  await p.setViewport({ width: 1440, height: 900 });
  await p.evaluate(async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); });
  await p.evaluate(() => { const a = window.__app; a.running = false; a.paused = true; a.beforeUpdate = null; a.afterUpdate = null; a.game.root.hidden = true; a.game.net.close(); });
  const conditions = [];
  for (const [name, sun, storm] of [['day', .55, 0], ['golden', .07, 0], ['storm', .25, .9]]) {
    const data = await p.evaluate(({ sun, storm }) => {
      const a = window.__app, s = a.game.frameWorld.ship, x = 8, z = -7;
      a.camera.position.set(s.x + Math.cos(s.heading) * x + Math.sin(s.heading) * z, 4, s.z - Math.sin(s.heading) * x + Math.cos(s.heading) * z);
      a.camera.lookAt(s.x + Math.cos(s.heading) * 2.95 + Math.sin(s.heading) * -5, 1.5, s.z - Math.sin(s.heading) * 2.95 + Math.cos(s.heading) * -5); a.camera.updateMatrixWorld();
      a.weather.set({ sunElevation: sun, storm, cloudCoverage: .35 + storm * .65 }, true); a.weather.update(0); a.post.reset = a.clouds.reset = true;
      Object.assign(a.post.settings, a.game.diveLight.surfaceExposure); for (let i = 0; i < 16; i++) a.render(0);
      const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 90;
      const ctx = canvas.getContext('2d'); ctx.drawImage(a.renderer.domElement, 0, 0, 144, 90);
      const pixels = ctx.getImageData(0, 0, 144, 90).data; let light = 0;
      for (let i = 0; i < pixels.length; i += 4) light += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / (3 * 255);
      return { error: a.renderer.getContext().getError(), light: light / (144 * 90) };
    }, { sun, storm }); conditions.push({ name, ...data }); assert.equal(data.error, 0); assert.ok(data.light > .05, 'The review frame must contain a rendered scene'); await p.screenshot({ path: `${out}/05-${name}-ladder.png` });
  }
  assert.deepEqual(errors, []); const result = { checks, layouts, conditions, entered: { x: entered.x, z: entered.z, yaw: entered.cameraYaw }, errors }; await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  console.error(await p.evaluate(() => { const g = window.__app?.game; return { mode: g?.lastMode, player: g?.state?.players[g.net.id], readout: document.getElementById('play-readout')?.textContent }; }));
  await p.screenshot({ path: `${out}/failure.png` }); throw error;
} finally { await browser.close(); await app.stop(); }
