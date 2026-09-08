import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import { SALVAGE_SITES } from '../src/game/SalvageSites.js';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/wreck-discoveries'; await fs.mkdir(out, { recursive: true });
const errors = [];
async function open(name, room = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.$eval('#crew-name', (e, value) => { e.value = value; }, name);
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck'); return page;
}
try {
  const a = await open('Mira'), room = await a.evaluate(() => window.__app.game.net.room), b = await open('Rowan', room);
  await b.keyboard.press('n');
  assert.equal(await b.$eval('#voyage-destination', e => [...e.options].some(o => o.value === 'wreck-west')), false);
  const world = app.rooms.get(room).world, id = await a.evaluate(() => window.__app.game.net.id), site = SALVAGE_SITES[1];
  // Place a diver at the real wreck to exercise discovery, rather than spend
  // this UI check sailing. The server's ordinary tick records the visit.
  Object.assign(world.players[id], site.cargo, { mode: 'diver', input: {} });
  await a.waitForFunction(() => window.__app.game.state.wreckDiscoveries?.west?.crew.includes('Mira'));
  await b.waitForFunction(() => [...document.querySelector('#voyage-destination').options].some(o => o.value === 'wreck-west'));
  assert.equal(world.course, null); assert.equal(world.contract, undefined); assert.equal(world.cargo.attached, false);
  await b.select('#voyage-destination', 'wreck-west');
  assert.match(await b.$eval('#voyage-record', e => e.textContent), /First explored by Mira/);
  assert.match(await b.$eval('#voyage-depth', e => e.textContent), /Explored wreck/);
  assert.doesNotMatch(await b.$eval('#voyage-record', e => e.textContent), /Unsurveyed/);
  await b.screenshot({ path: `${out}/chart-desktop.png` });
  await b.setViewport({ width: 390, height: 800 }); await b.$eval('#voyage-record', e => e.scrollIntoView({ block: 'center' }));
  assert.ok(await b.$eval('#voyage-chart', e => e.scrollWidth <= e.clientWidth));
  await b.screenshot({ path: `${out}/chart-phone.png` });
  await b.click('#plot-course'); await a.waitForFunction(() => window.__app.game.state.course?.id === 'wreck-west');
  assert.equal(world.contract, undefined); assert.equal(world.cargo.attached, false);
  await b.click('#crew-activities'); await b.$eval('#voyage-log', e => { e.open = true; });
  await b.type('#search-voyage-log', 'western');
  await b.waitForFunction(() => document.querySelector('#voyage-log ol').textContent.includes('Explored western survey wreck'));
  await b.$eval('#voyage-log', e => e.scrollIntoView({ block: 'start' }));
  await b.screenshot({ path: `${out}/log-phone.png` });
  await b.reload(); await b.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await b.click('#start-expedition'); await b.waitForFunction(() => window.__app.game.state.wreckDiscoveries?.west?.crew.includes('Mira'));
  assert.deepEqual(errors, []);
  console.log('Wreck discoveries: two-client chart arrival, first explorer, return course, mission isolation, searchable log, phone layout and rejoin passed.');
} finally { await browser.close(); await app.stop(); }
