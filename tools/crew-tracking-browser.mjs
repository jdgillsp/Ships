import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const { server } = createGameServer();
server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const out = 'tools/shots/crew-tracking'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const errors = [], results = {}, sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(room, name) {
  const context = await browser.createBrowserContext(), p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await useExpandedTools(p); await p.goto(`http://127.0.0.1:${server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.$eval('#crew-name', (e, name) => { e.value = name; }, name);
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready); return p;
}
const camera = p => p.evaluate(() => { const g = window.__app.game; return [g.orbit, g.deckPitch, g.view]; });
try {
  const a = await open(null, 'Rowan'), room = await a.evaluate(() => window.__app.game.net.room);
  assert.equal(await a.$eval('#crew-tracking', e => e.hidden), true, 'Solo play keeps the chart uncluttered');
  const b = await open(room, 'Mira'), id = await b.evaluate(() => window.__app.game.net.id);
  await a.waitForSelector('#crew-tracking:not([hidden])');
  assert.deepEqual(await a.$$eval('#track-crewmate option', es => es.map(e => e.textContent)), ['Mission guidance', 'Mira']);
  await a.bringToFront(); const before = await camera(a);
  await a.select('#track-crewmate', id);
  await a.waitForSelector('#objective-marker.crew-location:not([hidden])');
  assert.deepEqual(await camera(a), before, 'Choosing a buddy never turns the camera');
  assert.equal(await a.$eval('#objective-marker .objective-label', e => e.textContent), 'Mira');
  await b.bringToFront(); await b.keyboard.press('v');
  await b.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].mode === 'diver'; });
  await b.keyboard.down('ControlLeft'); await sleep(2000); await b.keyboard.up('ControlLeft');
  await a.waitForFunction(id => window.__app.game.state.players[id].y < -4, {}, id);
  await a.waitForFunction(() => document.querySelector('#objective-marker .objective-distance').textContent.includes('m deep'));
  results.diver = await a.evaluate(() => {
    const g = window.__app.game, t = g.crewTracking.target(g.state);
    return { target: t, text: document.querySelector('#objective-marker .objective-distance').textContent };
  });
  assert.ok(results.diver.target.distance > 4); assert.match(results.diver.text, /\d+ m deep/);
  // Focus must neutralise movement without allowing normal game key handling.
  await a.bringToFront(); await a.focus('#track-crewmate'); await a.keyboard.down('w'); await sleep(300);
  assert.equal(await a.evaluate(() => window.__app.game.keys.size), 0);
  await a.keyboard.up('w'); await a.$eval('#track-crewmate', e => e.blur());
  results.layout = [];
  for (const width of [1440, 600, 390]) {
    await a.setViewport({ width, height: 800 }); await sleep(500);
    const layout = await a.evaluate(() => {
      const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      const marker = box(document.getElementById('objective-marker')), selector = box(document.getElementById('track-crewmate'));
      const overlaps = [...document.querySelectorAll('.mission-panel,.nav-panel,.ship-console')].filter(e => {
        const r = box(e); return marker.right > r.left && marker.left < r.right && marker.bottom > r.top && marker.top < r.bottom;
      }).map(e => e.className);
      return { width: innerWidth, marker, selector, overlaps };
    });
    results.layout.push(layout); await a.screenshot({ path: `${out}/tracking-${width}.png` });
    assert.deepEqual(layout.overlaps, [], `Buddy beacon clears panels at ${width}px`);
    assert.ok(layout.marker.left >= 0 && layout.marker.right <= width && layout.marker.bottom < 800);
    assert.ok(layout.selector.left >= 0 && layout.selector.right <= width);
  }
  await b.evaluate(() => window.__app.game.net.close());
  await a.waitForFunction(id => !window.__app.game.state.players[id].connected, {}, id);
  await a.waitForFunction(() => !document.getElementById('objective-marker').classList.contains('crew-location'));
  assert.equal(await a.$eval('#track-crewmate', e => e.value), id, 'A dropped connection retains buddy selection');
  assert.match(await a.$eval('#track-crewmate', e => e.selectedOptions[0].textContent), /reconnecting/);
  await b.evaluate(async room => { await window.__app.game.net.join(room, 'Mira'); }, room);
  await a.waitForSelector('#objective-marker.crew-location:not([hidden])');
  assert.equal(await b.evaluate(() => window.__app.game.net.id), id);
  await a.select('#track-crewmate', '');
  await a.waitForFunction(() => !document.getElementById('objective-marker').classList.contains('crew-location'));
  assert.equal(await a.$eval('#game', e => e.classList.contains('tracking-crew')), false);
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log('PASS: live crew position/depth, camera independence, keyboard isolation, responsive layout, reconnect and mission guidance', JSON.stringify(results));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
