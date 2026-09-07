import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';

let holdSpeed = false;
const app = createGameServer({ ...simulation, tick(w, dt) { if (holdSpeed) { w.ship.speed = 6; w.ship.anchor = false; } simulation.tick(w, dt); } });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/activity-requests'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1280, height: 800 } });
const errors = [], checks = [], layouts = [];
async function open(name, room = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.$eval('#crew-name', (e, name) => { e.value = name; }, name); await page.click('#start-expedition');
  await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); }); return page;
}
try {
  const captain = await open('Mira'); await captain.keyboard.press('h'); await captain.waitForFunction(() => window.__app.game.lastMode === 'helm');
  const room = await captain.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  const crew = await open('Rowan', room), id = await crew.evaluate(() => window.__app.game.net.id); holdSpeed = true;
  await crew.click('#crew-activities'); await crew.waitForSelector('#activity-dive-request:not([hidden]):enabled');
  assert.equal(await crew.$eval('#activity-dive', e => e.disabled), true);
  for (const width of [1280, 600, 390]) {
    await crew.setViewport({ width, height: 800 }); await crew.$eval('#activity-dive-request', e => e.scrollIntoView({ block: 'center' }));
    const layout = await crew.$eval('#activity-dive-request', e => { const r = e.getBoundingClientRect(), d = e.closest('dialog'); return { left: r.left, right: r.right, height: r.height, overflow: d.scrollWidth > d.clientWidth }; });
    assert.ok(layout.left >= 0 && layout.right <= width && layout.height >= 44 && !layout.overflow, JSON.stringify(layout)); layouts.push({ width, ...layout });
    await crew.screenshot({ path: `${out}/01-request-${width}.png` });
  }
  await crew.click('#activity-dive-request');
  await crew.waitForFunction(() => document.getElementById('activities-status').textContent.includes('Request sent'));
  assert.equal(world.calls[id].kind, 'slow'); const sequence = world.callSequence;
  await crew.click('#activity-dive-request'); assert.equal(world.callSequence, sequence, 'Cooldown prevents duplicate calls');
  assert.equal(await crew.$eval('#crew-activities-dialog', e => e.open), true, 'The briefing stays available after requesting help');
  await captain.bringToFront(); await captain.waitForFunction(() => document.getElementById('crew-call-banner').textContent.includes('Rowan: Slow down'));
  await captain.click('#ack-crew-call'); await captain.waitForFunction(() => document.getElementById('crew-call-banner').textContent.includes('On it'));
  checks.push('Passenger requests reach the captain and use normal acknowledgement and cooldown');
  holdSpeed = false; await captain.keyboard.press('b');
  await crew.bringToFront(); await crew.waitForSelector('#activity-dive:enabled');
  assert.equal(await crew.$eval('#activity-dive-request', e => e.hidden), true);
  await crew.click('#activity-dive'); await crew.waitForFunction(() => window.__app.game.lastMode === 'diver');
  checks.push('Slowing the cutter enables the original dive action without reopening the notebook');
  Object.assign(world.cargo, { x: world.ship.x, z: world.ship.z, y: -20 }); world.ship.anchor = false; world.ship.speed = 0; world.time += 4;
  await crew.click('#crew-activities'); await crew.waitForSelector('#activity-recover-request:not([hidden]):enabled');
  assert.match(await crew.$eval('#activity-recover-request', e => e.textContent), /hold position/);
  await crew.click('#activity-recover-request'); await crew.waitForFunction(() => document.getElementById('activities-status').textContent.includes('Request sent')); assert.equal(world.calls[id].kind, 'anchor');
  world.ship.anchor = true; world.cargo.attached = true; world.time += 4;
  await crew.waitForFunction(() => document.getElementById('activity-recover-request').textContent === 'Request winch operator');
  await crew.click('#activity-recover-request'); await crew.waitForFunction(() => document.getElementById('activities-status').textContent.includes('Request sent')); assert.equal(world.calls[id].kind, 'winch');
  await captain.bringToFront(); await captain.keyboard.press('r'); await captain.waitForFunction(() => window.__app.game.lastMode === 'winch');
  await crew.bringToFront(); await crew.waitForSelector('#activity-recover-request[hidden]');
  checks.push('Divers can request anchor and winch help; taking the station removes the fulfilled request');
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), checks, layouts, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
