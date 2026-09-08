import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import { voyageSites } from '../src/game/VoyageSites.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';
import { RECIPE } from '../src/game/Simulation.js';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/depth-sounder'; await fs.mkdir(out, { recursive: true });
const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck');
  const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  await page.keyboard.press('k'); await page.waitForSelector('#navigation-glance-panel:not([hidden])');
  assert.match(await page.$eval('#navigation-glance-panel', e => e.textContent), /Seabed.*below Kestrel/);
  assert.equal(await page.$eval('#seabed-sounder', e => e.checkVisibility()), false, 'Quiet play keeps the instrument out of the persistent view');
  await page.keyboard.press('k'); await page.keyboard.press('i');
  await page.waitForFunction(() => document.getElementById('sounder-value').textContent.includes('m'));
  assert.equal(await page.$eval('#seabed-sounder', e => e.checkVisibility()), true);
  await page.screenshot({ path: `${out}/tools-desktop.png` });
  // Sample a genuinely deep part of this ocean without making a long voyage
  // part of the instrument UI check.
  const deep = voyageSites().find(s => s.id === 'deep'); Object.assign(world.ship, { x: deep.x, z: deep.z });
  await page.waitForFunction(() => parseFloat(document.getElementById('sounder-value').textContent) > 1000);
  await page.setViewport({ width: 390, height: 800 });
  assert.ok(await page.$eval('.ship-console', e => e.scrollWidth <= e.clientWidth));
  await page.$eval('#seabed-sounder', e => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${out}/tools-phone.png` });
  await page.keyboard.press('i'); await page.keyboard.press('v'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  const id = await page.evaluate(() => window.__app.game.net.id), diver = world.players[id];
  Object.assign(diver, { x: -140, z: 140, y: oceanFloor(-140, 140, RECIPE) + 6, input: {} });
  await page.keyboard.press('k');
  await page.waitForFunction(() => document.getElementById('navigation-glance-panel').textContent.includes('6.0 m above the seabed'));
  await page.screenshot({ path: `${out}/diver-phone.png` });
  await page.keyboard.down('Space'); await page.waitForFunction(() => document.getElementById('navigation-glance-panel').textContent.match(/(?:[7-9]|1\d)\.\d m above the seabed/)); await page.keyboard.up('Space');
  await page.keyboard.press('i');
  await page.waitForFunction(() => document.getElementById('sounder-label').textContent === 'Above seabed');
  const paused = await page.evaluate(() => { const g = window.__app.game; g.net.ready = false; g.updateUI(g.state); const text = document.getElementById('sounder-value').textContent; g.net.ready = true; return text; });
  assert.equal(paused, '—');
  assert.deepEqual(errors, []);
  console.log('Depth sounder: native Tools and Bearing controls, deep terrain, diver ascent, phone layouts and paused reading passed.');
} finally { await browser.close(); await app.stop(); }
