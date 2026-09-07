import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';

const app = createGameServer({ ...simulation, addPlayer(w, id, name) { const p = simulation.addPlayer(w, id, name); p.deckX = 0; p.deckZ = -2; return p; } });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/marker-sightlines'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], checks = [], layouts = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const faded = selector => p.waitForFunction(selector => { const e = document.querySelector(selector); return e && !e.hidden && e.classList.contains('marker-obscured') && Number(getComputedStyle(e).opacity) < .01; }, {}, selector);
const revealed = selector => p.waitForFunction(selector => { const e = document.querySelector(selector); return e && !e.hidden && !e.classList.contains('marker-obscured') && Number(getComputedStyle(e).opacity) > .99; }, {}, selector);
try {
  await p.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck' && window.__app.game.net.ready);
  await p.evaluate(() => { const g = window.__app.game; g.view = g.deckView = 'deck'; g.orbit = g.deckPitch = 0; g.cameraSnap = true; });
  await faded('#objective-marker');
  assert.equal(await p.evaluate(() => window.__app.game.objectiveMarker.bounds), null);
  assert.equal(await p.$eval('#objective-marker', e => e.getAttribute('aria-hidden')), 'true');
  await p.$eval('#objective-marker', e => e.style.setProperty('opacity', '1', 'important'));
  await p.screenshot({ path: `${out}/01-pin-reference.png` });
  await p.$eval('#objective-marker', e => e.style.removeProperty('opacity')); await faded('#objective-marker');
  await p.screenshot({ path: `${out}/02-quiet-cabin.png` }); checks.push('The cabin hides the projected pin without reserving invisible label space');
  await p.keyboard.press('i'); await revealed('#objective-marker'); await p.screenshot({ path: `${out}/03-full-tools.png` });
  await p.keyboard.press('Escape'); await faded('#objective-marker'); checks.push('Full tools restores guidance through obstructions');
  await p.keyboard.press('n'); await p.waitForSelector('#voyage-chart[open]'); await p.keyboard.press('Escape'); checks.push('The chart remains available while a pin is hidden');
  await p.keyboard.down('d'); await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].deckX < -2.45; }); await p.keyboard.up('d');
  await revealed('#objective-marker'); await p.screenshot({ path: `${out}/04-walk-clear.png` }); checks.push('Walking past the cabin restores the signal naturally');
  await p.keyboard.down('a'); await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].deckX > -.1; }); await p.keyboard.up('a'); await faded('#objective-marker');
  await p.mouse.move(250, 300); await p.mouse.down(); await p.mouse.move(1035, 300, { steps: 15 }); await p.mouse.up();
  await p.waitForSelector('#objective-marker.offscreen'); await revealed('#objective-marker'); await p.screenshot({ path: `${out}/05-edge-bearing.png` });
  checks.push('Looking away keeps the edge bearing visible'); await p.keyboard.press('Home'); await faded('#objective-marker');
  const identity = await p.evaluate(() => { const n = window.__app.game.net; return { room: n.room, id: n.id }; }), w = app.rooms.get(identity.room).world;
  const post = async (path, body, token) => { const r = await fetch(`${base}/api/rooms/${identity.room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); assert.ok(r.ok); return r.json(); };
  const peer = await post('join', { name: 'Rowan' }); Object.assign(w.players[peer.id], { deckX: 0, deckZ: 5.5 });
  await p.keyboard.press('i'); await p.waitForFunction(id => document.querySelector(`#track-crewmate option[value="${id}"]`), {}, peer.id); await p.select('#track-crewmate', peer.id); await p.keyboard.press('Escape');
  await revealed('#objective-marker'); assert.ok(await p.$eval('#objective-marker', e => e.textContent.includes('Rowan')));
  checks.push('Explicit crewmate tracking remains visible through equipment');
  await p.keyboard.press('i'); await p.select('#track-crewmate', ''); await p.keyboard.press('Escape'); await faded('#objective-marker');
  const point = await p.evaluate(() => { const g = window.__app.game, v = g.app.camera.position.clone().set(0, 3.6, 22); g.models.ship.localToWorld(v); return { x: v.x, y: v.y, z: v.z }; });
  await post('action', { action: 'signal', ...point }, peer.token); await faded('#crew-signal-0');
  checks.push('Shared crew pins follow the same obstruction rule');
  for (const width of [600, 390]) {
    await p.setViewport({ width, height: 800 }); await faded('#objective-marker');
    const layout = await p.$eval('.ship-console', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; });
    assert.ok(layout.left >= 0 && layout.right <= width); layouts.push({ width, ...layout }); await p.screenshot({ path: `${out}/06-cabin-${width}.png` });
  }
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await p.$eval('#objective-marker', e => getComputedStyle(e).transitionDuration), '0s');
  await p.keyboard.press('v'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver'); await revealed('#objective-marker'); checks.push('Diver navigation and reduced-motion settings remain intact');
  const cost = await p.evaluate(() => {
    const g = window.__app.game, w = g.frameWorld, originalMode = w.players[g.net.id].mode, timings = [];
    w.players[g.net.id].mode = 'deck';
    for (let i = 0; i < 500; i++) { const start = performance.now(); g.signals.update(w, true); timings.push(performance.now() - start); }
    w.players[g.net.id].mode = originalMode; timings.sort((a, b) => a - b); return { median: timings[250], p95: timings[475] };
  });
  assert.deepEqual(errors, []); const result = { checks, layouts, updateCostMs: cost, errors }; await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  console.error(await p.evaluate(() => { const g = window.__app?.game, e = document.getElementById('objective-marker'); return { player: g?.state?.players[g.net.id], marker: e?.outerHTML, camera: g?.app.camera.position.toArray() }; }));
  await p.screenshot({ path: `${out}/failure.png` }); throw error;
} finally { await browser.close(); await app.stop(); }
