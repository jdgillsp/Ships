import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import { act } from '../src/game/Simulation.js';
import { SALVAGE_SITES } from '../src/game/SalvageVoyages.js';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
await fs.mkdir('tools/shots/salvage-voyages', { recursive: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition');
  await page.waitForFunction(() => window.__app.game.started && window.__app.game.net.ready);
  const { room, id } = await page.evaluate(() => ({ room: window.__app.game.net.room, id: window.__app.game.net.id }));
  const w = app.rooms.get(room).world;
  for (const site of SALVAGE_SITES.slice(1)) {
    // Harbor delivery fixture; full travel and recovery are covered by game.test.mjs.
    w.mission = 'return'; w.cargo.recovered = true;
    assert.equal(act(w, id, 'deliver').ok, true);
    await page.waitForFunction(() => document.querySelector('#mission-complete').open);
    await page.click('#continue-sailing');
    await page.waitForFunction(() => !document.querySelector('#mission-complete').open);
    await page.click('#crew-activities');
    await page.waitForSelector('#salvage-jobs:not([hidden])');
    await page.select('#next-salvage-site', site.id);
    for (const width of [1280, 390]) {
      await page.setViewport({ width, height: 800 });
      await page.$eval('#salvage-jobs', e => e.scrollIntoView({ block: 'center' }));
      assert.ok(await page.$eval('#crew-activities-dialog', e => e.scrollWidth <= e.clientWidth));
      await page.screenshot({ path: `tools/shots/salvage-voyages/${site.id}-${width}.png` });
    }
    await page.click('#accept-salvage');
    await page.waitForFunction(siteId => window.__app.game.state.contract?.site === siteId && !document.querySelector('#crew-activities-dialog').open, {}, site.id);
    await page.waitForFunction(x => Math.abs(window.__app.game.models.crate.position.x - x) < .01, {}, site.cargo.x);
    const render = await page.evaluate(() => {
      const g = window.__app.game;
      return { wrecks: g.models.wrecks.length, buoy: [g.models.buoy.position.x, g.models.buoy.position.z], crate: g.models.crate.position.toArray(), history: g.state.salvageHistory.length };
    });
    assert.equal(render.wrecks, 3);
    assert.deepEqual(render.buoy, [site.wreck.x + 17, site.wreck.z]);
    assert.deepEqual(render.crate, [site.cargo.x, site.cargo.y, site.cargo.z]);
    assert.equal(render.history, site.id === 'west' ? 1 : 2);
    await page.keyboard.press('n'); await page.waitForFunction(() => document.querySelector('#voyage-chart').open);
    await page.click('#plan-salvage');
    assert.equal(await page.$eval('#voyage-name', e => e.textContent), site.name);
    assert.match(await page.$eval('#voyage-depth', e => e.textContent), new RegExp(`${Math.round(-site.cargo.y)} m recovery`));
    assert.doesNotMatch(await page.$eval('#voyage-record', e => e.textContent), /Unsurveyed/);
    await page.$eval('#dive-planner', e => e.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `tools/shots/salvage-voyages/plan-${site.id}.png` });
    await page.click('#plot-course');
    await page.waitForFunction(() => window.__app.game.state.course?.id === 'salvage-active' && !document.querySelector('#voyage-chart').open);
    assert.equal(w.course.id, 'salvage-active');
    await page.keyboard.press('n'); await page.waitForFunction(() => document.querySelector('#voyage-chart').open);
    await page.click('#clear-course');
    await page.waitForFunction(() => !window.__app.game.state.course && !document.querySelector('#voyage-chart').open);
  }
  await page.reload();
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition');
  await page.waitForFunction(() => window.__app.game.state?.contract?.site === 'east');
  assert.equal(await page.evaluate(() => window.__app.game.net.id), id);
  await page.click('#crew-activities'); await page.click('#voyage-log summary');
  await page.waitForFunction(() => document.querySelector('#voyage-log ol').textContent.includes('Expedition 3'));
  const logText = await page.$eval('#voyage-log ol', e => e.textContent);
  assert.match(logText, /western survey archive/); assert.match(logText, /eastern survey archive/);
  assert.match(logText, /Accepted the next salvage expedition/); assert.match(logText, /to delivery/);
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 800 });
    await page.$eval('#voyage-log', e => e.scrollIntoView({ block: 'start' }));
    assert.ok(await page.$eval('#crew-activities-dialog', e => e.scrollWidth <= e.clientWidth));
    await page.screenshot({ path: `tools/shots/salvage-voyages/history-${width}.png` });
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#crew-activities-dialog').open);
  // Position a diver beside the archive, then attach through the real F control.
  Object.assign(w.ship, { x: w.cargo.x, z: w.cargo.z + 8, speed: 0, anchor: true });
  assert.equal(act(w, id, 'dive').ok, true);
  Object.assign(w.players[id], { x: w.cargo.x, y: w.cargo.y + 1, z: w.cargo.z });
  assert.equal(act(w, id, 'course', { destination: 'salvage-active' }).ok, true);
  await page.waitForFunction(() => {
    const g = window.__app.game, p = g.state.players[g.net.id];
    return g.state.course?.id === 'salvage-active' && p.mode === 'diver' && Math.abs(p.y - g.state.cargo.y) < 3;
  });
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__app.game.state.cargo.attached && !window.__app.game.state.course);
  await page.waitForFunction(() => document.querySelector('#range').textContent.startsWith('Kestrel'));
  assert.match(await page.$eval('#mission-detail', e => e.textContent), /Ascend|aboard/);
  assert.deepEqual(errors, []);
  console.log('Salvage jobs: native acceptance at both sites, repeated receipt, desktop/phone layout, rendered buoy/cargo relocation, retained history and rejoin passed. Harbor fixtures; full movement tested separately.');
} finally { await browser.close(); await app.stop(); }
