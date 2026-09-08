import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { voyageSites } from '../src/game/VoyageSites.js';

const deep = voyageSites().find(s => s.id === 'deep');
const app = createGameServer({ ...simulation, tick() {}, createWorld() {
  const w = simulation.createWorld(); Object.assign(w, { time: 390, mission: 'complete', explorationWeather: { time: 0, storm: 0 } });
  Object.assign(w.ship, { x: deep.x + 100, z: deep.z }); w.cargo.recovered = w.cargo.attached = true; return w;
} });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/dive-return'; await fs.mkdir(out, { recursive: true });
const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  const base = `http://127.0.0.1:${app.server.address().port}`;
  await page.goto(`${base}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck');
  const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  const post = async (path, body, token) => { const response = await fetch(`${base}/api/rooms/${room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); assert.ok(response.ok); return response.json(); };
  const a = await post('join', { name: 'Mira' }), b = await post('join', { name: 'Rowan' });
  for (const [peer, depth] of [[a, 10], [b, 600]]) {
    await post('action', { action: 'dive' }, peer.token);
    Object.assign(world.players[peer.id], { x: deep.x, y: -depth, z: deep.z });
    Object.assign(world.players[peer.id].diveRecord, { maximumDepth: depth, startedAt: world.time - depth / 5 - 30 });
  }
  await page.click('#crew-activities');
  await page.waitForFunction(() => document.querySelectorAll('#dive-return-briefing li').length === 2);
  const rows = await page.$$eval('#dive-return-briefing li', es => es.map(e => e.textContent));
  assert.match(rows[0], /Mira.*25 sec.*Fair sea/); assert.match(rows[1], /Rowan.*2 min 20 sec.*Rough sea/);
  await page.$eval('#dive-return-briefing', e => e.scrollIntoView({ block: 'center' })); await page.screenshot({ path: `${out}/crew-desktop.png` });
  await page.setViewport({ width: 390, height: 800 }); await page.$eval('#dive-return-briefing', e => e.scrollIntoView({ block: 'center' }));
  assert.ok(await page.$eval('#crew-activities-dialog', e => e.scrollWidth <= e.clientWidth)); await page.screenshot({ path: `${out}/crew-phone.png` });
  world.ship.x += 100; world.ship.speed = 1;
  await page.waitForFunction(() => document.querySelector('#dive-return-briefing li').textContent.includes('45 sec') && document.querySelector('#dive-return-briefing li').textContent.includes('Kestrel is moving'));
  const paused = await page.evaluate(() => { const g = window.__app.game; g.net.ready = false; g.activities.updateUI(g.state); const text = document.querySelector('#dive-return-briefing').textContent; g.net.ready = true; return text; });
  assert.match(paused, /paused while reconnecting/);
  await post('action', { action: 'rescue' }, a.token);
  await page.waitForFunction(() => document.querySelectorAll('#dive-return-briefing li').length === 1);
  await post('leave', {}, b.token); await page.waitForFunction(() => document.getElementById('dive-return-briefing').hidden);
  await page.keyboard.press('Escape'); await page.keyboard.press('v'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await page.keyboard.press('k'); await page.waitForFunction(() => document.getElementById('navigation-glance-panel').textContent.includes('Return via surface'));
  await page.screenshot({ path: `${out}/diver-phone.png` }); assert.deepEqual(errors, []);
  console.log('Dive return: live crew briefing, different-depth forecasts, moving ship, phone layout, paused state, boarding/disconnect cleanup and native diver Bearing passed.');
} finally { await browser.close(); await app.stop(); }
