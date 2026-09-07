import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/crew-awareness'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
let heartbeat;
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck'; });
  assert.ok(await page.$eval('#crew-in-view', e => e.hidden), 'Solo play adds no crew cue');
  const room = await page.evaluate(() => window.__app.game.net.room), self = await page.evaluate(() => window.__app.game.net.id), world = app.rooms.get(room).world;
  const post = async (route, body, token) => {
    const r = await fetch(`${base}/api/rooms/${room}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.ok(r.ok); return r.json();
  };
  const peer = await post('join', { name: 'Rowan' });
  heartbeat = setInterval(() => post('input', {}, peer.token).catch(e => errors.push(e.message)), 700);
  Object.assign(world.players[peer.id], { deckX: 2.5, deckZ: 1.5 });
  await page.waitForSelector('#crew-in-view:not([hidden])');
  assert.ok(await page.$eval('#crew-in-view', e => e.textContent.includes('Rowan') && e.textContent.includes('On deck')));
  await page.screenshot({ path: `${out}/01-nearby.png` });
  const pose = [world.players[self].deckX, world.players[self].deckZ, world.players[self].mode];
  await page.click('#crew-in-view');
  assert.equal(await page.evaluate(() => window.__app.game.crewTracking.id), peer.id);
  assert.deepEqual([world.players[self].deckX, world.players[self].deckZ, world.players[self].mode], pose, 'Showing a position never moves the player or changes station');
  assert.equal(await page.$eval('#crew-in-view', e => e.getAttribute('aria-pressed')), 'true');
  await page.click('#crew-in-view'); assert.equal(await page.evaluate(() => window.__app.game.crewTracking.id), '');

  const aim = async () => {
    const delta = await page.evaluate(id => {
      const g = window.__app.game, i = Object.keys(g.frameWorld.players).indexOf(id), head = g.models.crewRigs[i].head;
      const target = g.app.camera.position.clone().set(0, .22, 0); head.localToWorld(target); target.sub(g.app.camera.position);
      const diving = g.lastMode === 'diver', yaw = Math.atan2(target.x, target.z) - (diving ? 0 : g.frameWorld.ship.heading), pitch = Math.atan2(target.y, Math.hypot(target.x, target.z));
      const angle = Math.atan2(Math.sin((diving ? g.yaw : g.orbit) - yaw), Math.cos((diving ? g.yaw : g.orbit) - yaw));
      return { dx: angle / .004, dy: ((diving ? g.pitch : g.deckPitch) - pitch) / .004 };
    }, peer.id);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta.dx), Math.abs(delta.dy)) / 180));
    for (let i = 0; i < steps; i++) { await page.mouse.move(200, 300); await page.mouse.down(); await page.mouse.move(200 + delta.dx / steps, 300 + delta.dy / steps, { steps: 3 }); await page.mouse.up(); }
  };
  Object.assign(world.players[peer.id], { deckX: -2.5, deckZ: 1.5 });
  await page.waitForFunction(id => window.__app.game.frameWorld.players[id].deckX === -2.5, {}, peer.id); await aim();
  await page.waitForSelector('#crew-in-view[hidden]');
  const blocked = await page.evaluate(id => {
    const g = window.__app.game, i = Object.keys(g.frameWorld.players).indexOf(id), p = g.app.camera.position.clone().set(0, .22, 0); g.models.crewRigs[i].head.localToWorld(p);
    const n = g.crewAwareness, distance = p.distanceTo(g.app.camera.position); n.ray.set(g.app.camera.position, p.sub(g.app.camera.position).normalize()); n.ray.far = distance;
    return { targetDistance: distance, wallDistance: n.ray.intersectObject(g.models.ship, true)[0]?.distance };
  }, peer.id);
  assert.ok(blocked.wallDistance < blocked.targetDistance, 'The test actually looks through the cabin at the crewmate');
  await page.screenshot({ path: `${out}/02-occluded.png` });
  Object.assign(world.players[peer.id], { deckX: 2.5, deckZ: 1.5 });
  await page.waitForFunction(id => window.__app.game.frameWorld.players[id].deckX === 2.5, {}, peer.id); await aim();
  await page.waitForSelector('#crew-in-view:not([hidden])');
  await page.keyboard.press('j'); await page.waitForSelector('#crew-journal[open]'); await page.waitForSelector('#crew-in-view[hidden]');
  await page.keyboard.press('Escape'); await page.waitForSelector('#crew-in-view:not([hidden])');
  const timings = await page.evaluate(async () => {
    const g = window.__app.game, n = g.crewAwareness, values = [];
    for (let i = 0; i < 30; i++) { await new Promise(requestAnimationFrame); n.lastUpdate = -Infinity; const start = performance.now(); n.update(g.frameWorld, start); values.push(performance.now() - start); }
    values.sort((a, b) => a - b); return { samples: values.length, median: values[15], p95: values[28] };
  });
  const layouts = [];
  for (const width of [600, 390]) {
    await page.setViewport({ width, height: 800 });
    // setViewport can return before Chromium dispatches resize to the game.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForSelector('#crew-in-view:not([hidden])');
    const r = await page.$eval('#crew-in-view', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, height: r.height }; });
    await page.screenshot({ path: `${out}/03-nearby-${width}.png` });
    assert.ok(r.left >= 0 && r.right <= width && r.bottom < 700 && r.height >= 44, JSON.stringify({ width, ...r })); layouts.push({ width, ...r });
  }
  await page.mouse.move(190, 300); await page.mouse.down(); await page.mouse.move(340, 300, { steps: 6 }); await page.mouse.up();
  await page.waitForSelector('#crew-in-view[hidden]');
  await page.keyboard.press('Home'); await page.waitForSelector('#crew-in-view:not([hidden])');
  await page.click('#crew-in-view');
  await page.waitForSelector('#objective-marker[hidden]');
  await page.mouse.move(190, 300); await page.mouse.down(); await page.mouse.move(340, 300, { steps: 6 }); await page.mouse.up();
  await page.waitForSelector('#crew-in-view[hidden]'); await page.waitForSelector('#objective-marker:not([hidden])');
  await page.keyboard.press('Home'); await page.waitForSelector('#crew-in-view:not([hidden])'); await page.click('#crew-in-view');

  await post('action', { action: 'dive' }, peer.token); await page.keyboard.press('v');
  await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  world.players[self].y = -4;
  Object.assign(world.players[peer.id], { x: world.players[self].x + 3, y: -4, z: world.players[self].z - 1 });
  await page.waitForFunction(id => { const g = window.__app.game; return g.frameWorld.players[id].mode === 'diver' && g.app.camera.position.y < -3.8; }, {}, peer.id);
  await aim(); await page.waitForSelector('#crew-in-view:not([hidden])');
  assert.ok(await page.$eval('#crew-in-view', e => e.textContent.includes('Diving')));
  await page.screenshot({ path: `${out}/04-dive-buddy.png` });
  await page.click('#crew-in-view'); assert.equal(await page.evaluate(() => window.__app.game.crewTracking.id), peer.id);
  clearInterval(heartbeat); await post('leave', {}, peer.token); await page.waitForSelector('#crew-in-view[hidden]');
  assert.deepEqual(errors, []);
  const result = { identifyVisibleCrew: true, localTrackingToggle: true, cabinOcclusion: blocked, modalIsolation: true, lookAway: true, noDuplicateMarker: true, diveBuddy: true, disconnect: true, layouts, samplingCpuMs: timings, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { clearInterval(heartbeat); await browser.close(); await app.stop(); }
