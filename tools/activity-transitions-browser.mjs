import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';

const app = createGameServer({ ...simulation, addPlayer(w, id, name) {
  const p = simulation.addPlayer(w, id, name);
  Object.assign(p, { mode: 'diver', x: -140, z: 140, y: oceanFloor(-140, 140, simulation.RECIPE) + 6 }); return p;
} });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/activity-transitions'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], trials = [];
let heldEvents;
await p.setRequestInterception(true);
p.on('request', request => {
  if (!heldEvents && new URL(request.url()).pathname.endsWith('/events')) heldEvents = request;
  else request.continue();
});
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const state = () => p.evaluate(() => {
  const g = window.__app.game, b = document.getElementById('activity-dive');
  return { ready: g.net.ready, mode: g.lastMode, study: g.naturalist.open, activities: g.activities.dialog.open,
    journal: g.naturalist.journal.open, disabled: b.disabled, focus: document.activeElement.id, events: window.transitionEvents };
});
try {
  await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await p.click('#crew-activities');
  assert.equal(await p.$eval('#activity-dive', e => e.disabled), true, 'Initial room snapshot precedes the live connection');
  await p.click('#activity-dive');
  assert.equal(await p.evaluate(() => window.__app.game.naturalist.open), false, 'An early click on the disabled activity reproduces the missed transition');
  assert.match(await p.$eval('#activities-status', e => e.textContent), /connection/i);
  assert.ok(heldEvents); await heldEvents.continue();
  await p.waitForSelector('#activity-dive:enabled'); await p.click('#activity-dive');
  await p.waitForFunction(() => window.__app.game.naturalist.open);
  await p.keyboard.press('o');
  assert.equal(await p.$eval('#game-message', e => e.textContent), '', 'Joining does not replay the historical voyage message');
  await p.screenshot({ path: `${out}/01-joined-dive.png` });
  const room = await p.evaluate(() => window.__app.game.net.room);
  app.rooms.get(room).world.log = 'The crew has a new survey report.';
  await p.waitForFunction(() => document.getElementById('game-message').textContent === 'The crew has a new survey report.');
  await p.screenshot({ path: `${out}/02-live-report.png` });
  await p.evaluate(() => {
    window.transitionEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, e => {
      window.transitionEvents.push({ type, target: e.target.id, x: e.clientX, y: e.clientY, disabled: e.target.disabled });
      if (window.transitionEvents.length > 18) window.transitionEvents.shift();
    }, true);
  });
  for (const width of [1440, 600, 390]) {
    await p.setViewport({ width, height: width === 1440 ? 900 : 800 });
    for (let i = 0; i < 12; i++) {
      await p.click('#crew-activities'); await p.click('#activity-dive');
      await p.waitForFunction(() => window.__app.game.naturalist.open, { timeout: 4000 });
      assert.equal(await p.$eval('#crew-activities-dialog', e => e.open), false);
      await p.click('#crew-activities'); await p.click('#activities-journal');
      await p.waitForSelector('#crew-journal[open]', { timeout: 4000 });
      assert.ok(await p.$eval('#crew-journal', e => e.contains(document.activeElement)), 'Focus stays inside the new journal');
      await p.keyboard.press('Escape');
      assert.equal(await p.$eval('#crew-journal', e => e.open), false);
      trials.push({ width, i });
    }
  }
  assert.deepEqual(errors, []);
  await p.reload(); await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver' && window.__app.game.net.ready);
  await p.waitForFunction(() => document.getElementById('station').textContent === 'DIVE TEAM');
  assert.equal(await p.$eval('#game-message', e => e.textContent), '', 'Reload does not announce an old survey report as new');
  await p.screenshot({ path: `${out}/03-resumed-dive.png` });
  assert.deepEqual(errors, []);
  const result = { delayedConnection: 'disabled click reproduces; enabled click opens', messages: 'initial history suppressed; live report shown; reload does not replay', trials: trials.length, widths: [1440, 600, 390], errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await fs.writeFile(`${out}/failure.json`, JSON.stringify({ trials, errors, state: await state() }, null, 2));
  await p.screenshot({ path: `${out}/failure.png` }); throw error;
} finally { await browser.close(); await app.stop(); }
