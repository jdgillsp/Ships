import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kestrel-browser-save-'));
let app, browser, port;
async function start() {
  app = createGameServer(undefined, { dataDir: directory }); await app.ready;
  app.server.listen(port || 0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r)); port = app.server.address().port;
}
const out = 'tools/shots/persistence'; await fs.mkdir(out, { recursive: true });
const errors = [];
const boot = p => p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
const aboard = p => p.waitForFunction(() => window.__app?.game?.started && window.__app.game.net.ready);
const menu = p => p.waitForSelector('.resume-expedition');
const settings = async p => {
  await p.bringToFront(); await p.waitForSelector('#voyage-chart:not([open])');
  await p.click('#game-settings'); await p.waitForSelector('#settings-dialog[open]');
};
const leave = async p => { await settings(p); await p.click('#save-expedition'); await menu(p); await boot(p); };
try {
  await start(); browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await useExpandedTools(page); await page.goto(`http://127.0.0.1:${port}/?mode=expedition&preset=low&adaptive=0`); await boot(page);
  await page.$eval('#crew-name', e => { e.value = 'Rowan'; }); await page.click('#start-expedition'); await aboard(page);
  const { room, id } = await page.evaluate(() => ({ room: window.__app.game.net.room, id: window.__app.game.net.id }));
  await page.keyboard.press('n'); await page.select('#voyage-destination', 'reef'); await page.click('#plot-course');
  const world = app.rooms.get(room).world;
  world.surveys.reef = { seconds: 8, completedAt: world.time, active: 0, contributors: [{ id, name: 'Rowan' }] };
  await page.waitForFunction(() => window.__app.game.state.surveys.reef?.seconds === 8);
  await leave(page);
  assert.match(await page.$eval('.recent-expeditions', e => e.textContent), /Rowan.*1\/15/);
  assert.equal(app.rooms.get(room).world.players[id].connected, false);
  await page.screenshot({ path: `${out}/01-resume-desktop.png` });
  for (const width of [600, 390]) {
    await page.setViewport({ width, height: 800 });
    await page.$eval('.recent-expeditions', e => e.scrollIntoView({ block: 'center' }));
    const box = await page.$eval('.recent-expeditions', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    assert.ok(box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= 800, 'Resume fits the phone viewport');
    await page.screenshot({ path: `${out}/02-resume-${width}.png` });
  }
  await page.setViewport({ width: 1440, height: 900 }); await page.close();
  await app.stop(); await start();
  // New tab, no session token: only the explicit Resume button restores Rowan.
  const resumed = await context.newPage(); resumed.on('pageerror', e => errors.push(e.message));
  await useExpandedTools(resumed); await resumed.goto(`http://127.0.0.1:${port}/?mode=expedition&preset=low&adaptive=0`); await boot(resumed); await menu(resumed);
  assert.equal(await resumed.evaluate(room => sessionStorage.getItem(`kestrel:${room}`), room), null);
  await resumed.click('.resume-expedition'); await aboard(resumed);
  assert.equal(await resumed.evaluate(() => window.__app.game.net.id), id);
  assert.equal(await resumed.evaluate(() => window.__app.game.state.course.id), 'reef');
  assert.equal(await resumed.evaluate(() => window.__app.game.state.surveys.reef.seconds), 8);
  await resumed.keyboard.press('n'); await resumed.screenshot({ path: `${out}/03-restored-chart.png` }); await resumed.keyboard.press('Escape');
  console.log('Restored voyage and survey after restart.');
  const guest = await context.newPage();
  await useExpandedTools(guest); await guest.goto(`http://127.0.0.1:${port}/?mode=expedition&preset=low&adaptive=0&room=${room}`); await boot(guest);
  console.log('Guest launch screen loaded.');
  await guest.$eval('#crew-name', e => { e.value = 'Mira'; }); await guest.click('#start-expedition'); await aboard(guest);
  const guestID = await guest.evaluate(() => window.__app.game.net.id); assert.notEqual(guestID, id);
  console.log('Guest joined as a separate identity.');
  await resumed.waitForFunction(() => Object.values(window.__app.game.state.players).filter(p => p.connected).length === 2);
  await settings(resumed);
  console.log('Checking save failure and retry.');
  await app.flush(); await fs.mkdir(app.store.file + '.tmp');
  await resumed.click('#save-expedition');
  await resumed.waitForFunction(() => document.getElementById('expedition-save-status').textContent.includes('still aboard'));
  assert.equal(await resumed.evaluate(() => window.__app.game.net.ready), true);
  await resumed.screenshot({ path: `${out}/04-save-failed.png` });
  await fs.rmdir(app.store.file + '.tmp'); await resumed.click('#save-expedition'); await menu(resumed);
  await guest.waitForFunction(() => window.__app.game.net.ready && Object.values(window.__app.game.state.players).filter(p => p.connected).length === 1);
  assert.equal(app.rooms.get(room).world.players[guestID].connected, true, 'Other crew continue when Rowan leaves');
  await boot(resumed); await resumed.click('.forget-expedition');
  assert.equal(await resumed.$$eval('.resume-expedition', list => list.length), 1, 'Forget removes one browser identity, not the voyage');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ restart: true, sameIdentity: true, newInviteNewIdentity: true, surveys: 1, viewports: [1440, 600, 390], failedSaveStaysAboard: true, errors }));
} finally {
  await browser?.close(); await app?.stop();
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'kestrel-browser-save-'));
  await fs.rm(directory, { recursive: true, force: true });
}
