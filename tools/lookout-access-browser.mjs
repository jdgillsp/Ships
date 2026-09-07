import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(resolve => app.server.once('listening', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/lookout-access';
await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
let heartbeat;
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await page.keyboard.press('l'); await page.waitForSelector('#game.quiet-play.lookout-active');
  const control = await page.$eval('#mark-location', button => ({ visible: button.checkVisibility(), disabled: button.disabled, display: getComputedStyle(button).display }));
  console.log(JSON.stringify({ quietLookoutMark: control }));
  assert.ok(control.visible, 'A crewmate can mark the binocular view without knowing a keyboard shortcut');
  assert.equal(control.disabled, false);
  await page.screenshot({ path: `${out}/01-lookout.png` });
  await page.click('#binoculars'); await page.waitForSelector('#game:not(.lookout-active)');
  const room = await page.evaluate(() => window.__app.game.net.room);
  const post = async (path, body, token) => {
    const response = await fetch(`${base}/api/rooms/${room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.ok(response.ok); return response.json();
  };
  const peer = await post('join', { name: 'Rowan' });
  await post('action', { action: 'helm' }, peer.token);
  heartbeat = setInterval(() => post('input', {}, peer.token).catch(error => errors.push(error.message)), 800);
  await page.waitForSelector('#scout-ahead:not([hidden]):not([disabled])');
  await page.screenshot({ path: `${out}/02-crew-deck.png` });
  await page.keyboard.press('f'); await page.waitForSelector('#game.lookout-active');
  assert.equal(await page.evaluate(() => window.__app.game.lastMode), 'deck');
  const id = await page.evaluate(() => window.__app.game.net.id);
  await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(300, 380, { steps: 8 }); await page.mouse.up();
  await page.click('#mark-location');
  await page.waitForFunction(id => !!window.__app.game.state.signals[id], {}, id);
  assert.equal(app.rooms.get(room).world.signals[id].owner, id, 'Pointer marking reaches the shared authoritative world');
  assert.equal(app.rooms.get(room).world.ship.pilot, peer.id, 'Scouting and marking preserve the captain');
  const layouts = [];
  for (const width of [600, 390]) {
    await page.setViewport({ width, height: 800 });
    const layout = await page.evaluate(() => {
      const selectors = ['#mark-location', '#binoculars', '#play-chart', '#play-tools'];
      const buttons = selectors.map(selector => { const e = document.querySelector(selector), r = e.getBoundingClientRect(); return { selector, visible: e.checkVisibility(), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      const r = document.querySelector('.ship-console').getBoundingClientRect();
      return { buttons, height: r.height };
    });
    assert.ok(layout.buttons.every(b => b.visible && b.left >= 0 && b.right <= width && b.top > 600 && b.bottom <= 800), 'All quiet lookout controls remain reachable below the viewing area');
    assert.ok(layout.height < 140); layouts.push({ width, ...layout });
    await page.screenshot({ path: `${out}/03-lookout-${width}.png` });
  }
  await page.click('#binoculars'); await page.waitForSelector('#game:not(.lookout-active)');
  await page.waitForSelector('#scout-ahead:not([hidden]):not([disabled])');
  await page.click('#scout-ahead'); await page.waitForSelector('#game.lookout-active');
  await page.keyboard.press('Escape'); await page.waitForSelector('#game:not(.lookout-active)');
  await page.setViewport({ width: 390, height: 800, hasTouch: true });
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForSelector('#scout-ahead:not([hidden]):not([disabled])');
  await page.tap('#scout-ahead'); await page.waitForSelector('#game.lookout-active');
  assert.ok(await page.$eval('#mark-location', e => e.checkVisibility() && e.getBoundingClientRect().height >= 44), 'Touch marking has a full-size tap target');
  await page.mouse.move(300, 300); await page.mouse.down(); await page.mouse.move(100, 380, { steps: 6 }); await page.mouse.up();
  await page.waitForSelector('#mark-location:not([disabled])');
  const sequence = app.rooms.get(room).world.signalSequence;
  await page.tap('#mark-location');
  await page.waitForFunction(sequence => window.__app.game.state.signalSequence > sequence, {}, sequence);
  await page.screenshot({ path: `${out}/04-touch-mark.png` });
  await page.tap('#binoculars'); await page.waitForSelector('#game:not(.lookout-active)');
  // A local station still owns F. Moving to the radio must replace the
  // fallback Scout action rather than leaving two competing primary buttons.
  await page.keyboard.press('Home');
  await page.keyboard.down('d');
  await page.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].deckX < -1.6; });
  await page.keyboard.up('d');
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__app.game.contextAction() === 'radio');
  await page.keyboard.up('w');
  await page.waitForSelector('#scout-ahead[hidden]');
  await page.keyboard.press('f'); await page.waitForSelector('#crew-radio-dialog[open]');
  await page.keyboard.press('l'); assert.equal(await page.evaluate(() => window.__app.game.lookout), false, 'A modal still isolates scouting shortcuts');
  await page.keyboard.press('Escape');
  console.log(JSON.stringify({ layouts, sharedSignal: true, captainPreserved: true, stationPriority: true, errors }));
  assert.deepEqual(errors, []);
} finally { clearInterval(heartbeat); await browser.close(); await app.stop(); }
