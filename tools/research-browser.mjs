import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { voyageSites } from '../src/game/VoyageSites.js';

const app = createGameServer({ ...simulation, createWorld() {
  const w = simulation.createWorld(); w.mission = 'complete'; w.cargo.recovered = w.cargo.attached = true; return w;
} });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/research'; await fs.mkdir(out, { recursive: true });
const errors = [];
async function open(name, room = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.$eval('#crew-name', (e, value) => { e.value = value; }, name); await page.click('#start-expedition');
  await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck'); return page;
}
try {
  const a = await open('Mira');
  await a.click('#crew-activities'); await a.select('#research-site', 'reef');
  await a.$eval('#research-jobs', e => e.scrollIntoView({ block: 'center' })); await a.screenshot({ path: `${out}/request-desktop.png` });
  await a.click('#accept-research'); await a.waitForFunction(() => window.__app.game.state.research?.site === 'reef');
  const room = await a.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]');
  assert.equal(await a.$eval('#plan-salvage', e => e.textContent), 'Plan research dive');
  await a.select('#voyage-destination', 'kelp'); await a.click('#plot-course');
  await a.waitForFunction(() => window.__app.game.state.course?.id === 'kelp');
  await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]');
  assert.equal(await a.$eval('#clear-course', e => e.textContent), 'Resume research guidance');
  await a.click('#clear-course'); await a.waitForFunction(() => window.__app.game.state.course === null);
  await a.waitForFunction(() => document.getElementById('range').textContent.toLowerCase().includes('coral'));
  assert.doesNotMatch(await a.$eval('#range', e => e.textContent), /undefined/);
  await a.click('#crew-activities');
  assert.match(await a.$eval('#crew-activities-dialog', e => e.textContent), /Set sail for/);
  await a.keyboard.press('Escape');

  const b = await open('Rowan', room); await b.click('#crew-activities');
  assert.equal(await b.$eval('#mission-complete', e => e.open), false, 'Joining active research does not reopen the old archive delivery');
  assert.match(await b.$eval('#research-brief', e => e.textContent), /Survey the habitat/);
  assert.equal(await b.$eval('#accept-salvage', e => e.disabled), true);
  // Sailing is exercised by the logic journey. Here position the cutter at
  // the actual reef, then perform native diving and survey input.
  const site = voyageSites().find(s => s.id === 'reef'); Object.assign(world.ship, { x: site.x, z: site.z });
  await a.bringToFront(); await a.keyboard.press('v'); await a.waitForFunction(() => window.__app.game.lastMode === 'diver');
  const id = await a.evaluate(() => window.__app.game.net.id); Object.assign(world.players[id], { x: site.x, y: site.y, z: site.z, input: {} });
  await a.waitForSelector('#survey-site:enabled'); await a.keyboard.down('x');
  await a.waitForFunction(() => window.__app.game.state.surveys.reef?.completedAt != null, { timeout: 15000 }); await a.keyboard.up('x');
  await b.waitForFunction(() => window.__app.game.state.course?.id === 'pelican-station');
  await b.bringToFront(); await b.waitForFunction(() => document.getElementById('research-brief').textContent.includes('Survey complete'));
  assert.match(await b.$eval('#research-brief', e => e.textContent), /Survey complete/);
  await b.bringToFront(); await b.waitForSelector('#activity-recover-request:enabled');
  assert.match(await b.$eval('#activity-recover-detail', e => e.textContent), /1 diver still in the water/);
  await b.$eval('[data-activity="recover"]', e => e.scrollIntoView({ block: 'center' }));
  await b.screenshot({ path: `${out}/recall-desktop.png` });
  await b.click('#activity-recover-request');
  await a.waitForFunction(() => Object.values(window.__app.game.state.calls).some(c => c.kind === 'recall'));
  await a.bringToFront(); await a.waitForSelector('#ack-crew-call:enabled'); await a.click('#ack-crew-call');
  await b.waitForFunction(() => Object.values(window.__app.game.state.calls).some(c => c.kind === 'recall' && c.returning?.length === 1));

  Object.assign(world.ship, simulation.BASE); Object.assign(world.players[id], { x: simulation.BASE.x + 7, y: -.5, z: simulation.BASE.z, input: {} });
  await b.waitForFunction(() => document.getElementById('research-status').textContent.includes('diver'));
  assert.equal(await b.$eval('#file-research', e => e.disabled), true);
  await a.waitForFunction(() => window.__app.game.contextAction() === 'board'); await a.keyboard.press('f');
  await a.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await b.waitForFunction(() => document.getElementById('activity-recover-request').hidden);
  assert.equal(await b.$eval('#activity-recover', e => e.textContent), 'File research report');

  await b.bringToFront(); await b.waitForSelector('#file-research:enabled');
  await b.setViewport({ width: 390, height: 800 }); await b.$eval('#research-jobs', e => e.scrollIntoView({ block: 'center' }));
  assert.ok(await b.$eval('#crew-activities-dialog', e => e.scrollWidth <= e.clientWidth)); await b.screenshot({ path: `${out}/report-phone.png` });
  await b.click('#file-research'); await b.waitForFunction(() => window.__app.game.state.research === null);
  await b.waitForFunction(() => document.getElementById('research-receipt').textContent.includes('Report received'));
  assert.match(await b.$eval('#research-receipt', e => e.textContent), /Rowan.*Survey team: Mira/);
  assert.match(await b.$eval('#research-experience', e => e.textContent), /1 completed dive.*deepest recorded dive.*combined dive time.*Strongest seas/);
  await b.$eval('#research-receipt', e => e.scrollIntoView({ block: 'center' })); await b.screenshot({ path: `${out}/experience-phone.png` });
  assert.equal(await b.$eval('#research-site', e => [...e.options].some(o => o.value === 'reef')), false);
  await b.$eval('#voyage-log', e => { e.open = true; }); await b.type('#search-voyage-log', 'research');
  await b.waitForFunction(() => document.querySelector('#voyage-log ol').textContent.includes('Filed research report'));
  await b.$eval('#voyage-log', e => e.scrollIntoView({ block: 'start' })); await b.screenshot({ path: `${out}/log-phone.png` });
  assert.equal(world.researchHistory[0].status, 'filed'); assert.deepEqual(errors, []);
  console.log('Research: shared acceptance, detour and restored research guidance, late join, native dive/survey/boarding, homeward course, notebook recall and diver acknowledgement, crew-return requirement, filing, receipt, searchable history and phone layout passed.');
} finally { await browser.close(); await app.stop(); }
