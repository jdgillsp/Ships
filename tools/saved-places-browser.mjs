import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/saved-places'; await fs.mkdir(out, { recursive: true });
const errors = [];
async function open(room) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.started);
  return page;
}
try {
  const a = await open(), room = await a.evaluate(() => window.__app.game.net.room), b = await open(room);
  await a.bringToFront(); await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]');
  assert.equal(await a.$eval('#save-place', e => e.disabled), true);
  // A real authenticated teammate marks the water; another crew member keeps it.
  const peer = await b.evaluate(() => { const n = window.__app.game.net; return { token: n.token, id: n.id }; });
  const response = await fetch(`${base}/api/rooms/${room}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${peer.token}` }, body: JSON.stringify({ action: 'signal', x: -110, y: 0, z: 405 }) });
  assert.ok(response.ok); await a.waitForSelector('#save-place:enabled');
  await a.click('#place-name'); await a.keyboard.down('Control'); await a.keyboard.press('a'); await a.keyboard.up('Control');
  await a.keyboard.type('Quiet anchorage'); await a.click('#save-place');
  try { await a.waitForFunction(() => document.querySelector('#voyage-name').textContent === 'Quiet anchorage'); }
  catch (e) {
    console.log(await a.evaluate(() => ({ places: window.__app.game.state.places, input: document.querySelector('#place-name').value, status: document.querySelector('#place-status').textContent, selected: document.querySelector('#voyage-destination').value })));
    await a.screenshot({ path: `${out}/save-failure.png` }); throw e;
  }
  assert.equal(await a.$eval('#voyage-progress', e => e.textContent), 'Survey log · 0 of 15 sites recorded');
  assert.equal(await a.$eval('#voyage-depth', e => e.textContent), 'Surface location');
  const placeId = await a.$eval('#voyage-destination', e => e.value);
  await b.waitForFunction(() => Object.values(window.__app.game.state.places).some(p => p.name === 'Quiet anchorage'));
  for (const width of [1280, 390]) {
    await a.setViewport({ width, height: 800 }); await a.$eval('#voyage-name', e => e.scrollIntoView({ block: 'center' }));
    assert.ok(await a.$eval('#voyage-chart', e => e.scrollWidth <= e.clientWidth));
    await a.screenshot({ path: `${out}/chart-${width}.png` });
  }
  await a.click('#plot-course'); await a.waitForSelector('#voyage-chart:not([open])');
  await b.waitForFunction(id => window.__app.game.state.course?.id === id, {}, placeId);
  const world = app.rooms.get(room).world; world.time += 20;
  for (const p of Object.values(world.players)) p.lastInput = world.time;
  await a.waitForFunction(() => Object.keys(window.__app.game.state.signals).length === 0);
  await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]');
  assert.equal(await a.$eval('#voyage-name', e => e.textContent), 'Quiet anchorage');
  await a.keyboard.press('Escape'); await a.reload();
  await a.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await a.click('#start-expedition'); await a.waitForFunction(() => window.__app.game.started && window.__app.game.net.ready);
  await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]');
  assert.equal(await a.$eval('#voyage-name', e => e.textContent), 'Quiet anchorage');
  await a.click('#remove-place');
  await b.waitForFunction(() => Object.keys(window.__app.game.state.places).length === 0 && window.__app.game.state.course === null);
  await a.waitForFunction(() => document.querySelector('#voyage-destination').options.length === 15);
  assert.equal(await a.$eval('#voyage-name', e => e.textContent), 'Coral cathedral');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ sharedSave: true, selectedOnArrival: true, surveyCountUnchanged: true, phoneLayout: true, signalExpiry: true, returnCourse: true, rejoin: true, removalClearsCourse: true, errors }));
} finally { await browser.close(); await app.stop(); }
