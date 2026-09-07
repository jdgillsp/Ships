import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/delivery-log'; await fs.mkdir(out, { recursive: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm');
  const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  for (const name of ['Rowan Winterbourne', 'Ellis Blackwater', 'Morgan Fairweather']) {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/rooms/${room}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    assert.ok(response.ok);
  }
  world.mission = 'return'; world.cargo.recovered = true; world.time = 347;
  for (const p of Object.values(world.players)) p.lastInput = world.time;
  await page.waitForFunction(() => window.__app.game.contextAction() === 'deliver');
  await page.keyboard.press('f'); await page.waitForSelector('#mission-complete:not([hidden])');
  await page.keyboard.press('b');
  await new Promise(resolve => setTimeout(resolve, 300));
  console.log(JSON.stringify({ anchorWhileReading: world.ship.anchor }));
  assert.equal(world.ship.anchor, true, 'Reading the delivery log cannot release the ship anchor');
  await page.keyboard.press('h'); await page.keyboard.press('v'); await page.keyboard.press('n');
  assert.equal(await page.evaluate(() => window.__app.game.lastMode), 'helm');
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('#mission-complete')));
  const time = await page.$eval('#mission-time', e => e.textContent), record = structuredClone(world.delivery);
  assert.equal(record.crew.length, 4);
  assert.ok(await page.$eval('#delivery-crew', e => e.textContent.includes('Morgan Fairweather')));
  await page.screenshot({ path: `${out}/01-delivery.png` });
  for (const width of [600, 390]) {
    await page.setViewport({ width, height: 800 });
    const layout = await page.$eval('#mission-complete', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scroll: e.scrollWidth, client: e.clientWidth }; });
    assert.ok(layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom <= 800 && layout.scroll <= layout.client);
    await page.screenshot({ path: `${out}/02-delivery-${width}.png` });
  }
  await page.click('#delivery-journal'); await page.waitForSelector('#crew-journal[open]');
  assert.ok(await page.$eval('#mission-complete', e => e.hidden && !e.open));
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('#crew-journal')), 'Receipt-to-journal focus stays inside the journal');
  await page.keyboard.press('Escape');
  await page.click('#crew-activities'); await page.click('#view-delivery'); await page.waitForSelector('#mission-complete[open]');
  await page.keyboard.press('Escape'); await page.waitForSelector('#mission-complete[hidden]');
  world.time += 120; for (const p of Object.values(world.players)) p.lastInput = world.time;
  await page.click('#crew-activities'); await page.waitForSelector('#crew-activities-dialog[open]');
  await page.click('#view-delivery'); await page.waitForSelector('#mission-complete[open]');
  assert.equal(await page.$eval('#mission-time', e => e.textContent), time, 'Reopening the log retains the actual delivery time');
  await page.click('#delivery-next-dive'); await page.waitForSelector('#voyage-chart[open]');
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('#voyage-chart')), 'Closing the receipt cannot steal chart focus');
  await page.select('#voyage-destination', 'kelp'); await page.click('#plot-course');
  await page.waitForFunction(() => window.__app.game.state.course?.id === 'kelp');
  assert.deepEqual(world.delivery, record);
  await page.reload();
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.started && window.__app.game.state?.mission === 'complete');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(await page.$eval('#mission-complete', e => e.hidden && !e.open), 'Rejoining a completed voyage does not replay the completion screen');
  await page.click('#crew-activities'); await page.click('#view-delivery');
  await page.waitForSelector('#mission-complete[open]');
  assert.equal(await page.$eval('#mission-time', e => e.textContent), time);
  await page.click('#continue-sailing'); await page.waitForSelector('#mission-complete[hidden]');
  // Older saved voyages have no historical receipt. They remain readable
  // without presenting their current elapsed time as a delivery duration.
  world.delivery = null;
  await page.waitForFunction(() => window.__app.game.state.delivery === null);
  await page.click('#crew-activities'); await page.click('#view-delivery');
  await page.waitForSelector('#mission-complete[open]');
  assert.equal(await page.$eval('#mission-time', e => e.textContent), 'Archive received at Pelican Station');
  assert.ok(await page.$eval('#delivery-crew', e => e.hidden));
  console.log(JSON.stringify({ immutableTime: time, savedCrew: record.crew, modalControls: true, rejoinNoReplay: true, chartHandoff: true, journalHandoff: true, legacyReceipt: true, errors }));
  assert.deepEqual(errors, []);
} finally { await browser.close(); await app.stop(); }
