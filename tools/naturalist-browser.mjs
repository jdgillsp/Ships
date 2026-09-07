import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';

// Place a new crew at the reef. All subsequent swimming and study use production controls.
const { server } = createGameServer({ ...simulation, addPlayer(world, id, name) {
  const p = simulation.addPlayer(world, id, name);
  p.mode = 'diver'; p.x = -140; p.z = 140; p.y = oceanFloor(p.x, p.z, simulation.RECIPE) + 6; return p;
} });
server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`, out = 'tools/shots/naturalist'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], results = {}, sleep = ms => new Promise(r => setTimeout(r, ms));
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const pose = () => p.evaluate(() => { const g = window.__app.game, s = g.state.players[g.net.id]; return [s.x, s.y, s.z, g.yaw, g.pitch]; });
try {
  await useExpandedTools(p); await p.goto(`${base}?mode=expedition&preset=low&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'diver');
  const before = await pose(); await p.keyboard.press('o');
  await p.waitForSelector('#crew-naturalist:not([hidden])');
  await sleep(1800); assert.deepEqual(await pose(), before, 'Observation never steers or moves a diver');
  // Look around the actual reef population; do not inject an observation or animal.
  for (let n = 0; n < 12 && !await p.evaluate(() => window.__app.game.naturalist.entries.length); n++) {
    await p.evaluate(n => { const g = window.__app.game; g.yaw = n * Math.PI / 6; g.pitch = -.25; }, n);
    await sleep(2000);
  }
  assert.ok(await p.evaluate(() => window.__app.game.naturalist.entries.length), 'A rendered animal can be identified and saved');
  results.entries = await p.evaluate(() => window.__app.game.naturalist.entries);
  results.study = await p.$eval('#crew-naturalist', e => e.innerText);
  console.log('Live study recorded', JSON.stringify(results.entries));
  await p.screenshot({ path: `${out}/01-observation.png` });
  const marker = await p.$eval('#study-marker', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.click(marker.x, marker.y);
  await p.waitForFunction(() => window.__app.game.naturalist.candidate && window.__app.game.naturalist.hold.elapsed > 0);
  results.studyCPU = await p.evaluate(async () => {
    const n = window.__app.game.naturalist, update = n.update, samples = [];
    n.update = function(now) { const last = this.lastUpdate, start = performance.now(); update.call(this, now); if (this.lastUpdate !== last) samples.push(performance.now() - start); };
    try { for (let i = 0; i < 40; i++) await new Promise(requestAnimationFrame); }
    finally { n.update = update; }
    samples.sort((a, b) => a - b);
    return { samples: samples.length, medianMs: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)] };
  });
  const swimBefore = await pose(); await p.keyboard.down('w'); await sleep(650); await p.keyboard.up('w');
  const swimAfter = await pose(); assert.ok(Math.hypot(...swimAfter.slice(0, 3).map((v, i) => v - swimBefore[i])) > 1, 'Swimming stays available while studying');
  await p.keyboard.press('j'); await p.waitForSelector('#crew-journal[open]');
  assert.ok(await p.$$eval('#crew-journal article', es => es.length));
  assert.ok(await p.$eval('#crew-journal', e => { const r = e.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 1; }), 'Journal is centered in the viewport');
  // Let the preceding swim's neutral input reach the server and its next snapshot.
  await sleep(350);
  const paused = await pose(); await p.keyboard.down('w'); await sleep(600); await p.keyboard.up('w');
  assert.deepEqual(await pose(), paused, 'Journal keyboard input does not swim');
  await p.screenshot({ path: `${out}/02-journal.png` }); await p.keyboard.press('Escape');
  assert.equal(await p.$eval('#crew-journal', e => e.open), false);
  results.layouts = [];
  for (const width of [600, 390]) {
    await p.setViewport({ width, height: 800 }); await sleep(500);
    const layout = await p.evaluate(() => {
      const r = document.getElementById('crew-naturalist').getBoundingClientRect(), console = document.querySelector('.ship-console').getBoundingClientRect();
      return { width: innerWidth, left: r.left, right: r.right, bottom: r.bottom, consoleTop: console.top };
    });
    results.layouts.push(layout); assert.ok(layout.left >= 0 && layout.right <= width && layout.bottom < layout.consoleTop - 60, 'Study panel leaves room to see and swim');
    await p.screenshot({ path: `${out}/03-study-${width}.png` });
    await p.keyboard.press('j'); await p.waitForSelector('#crew-journal[open]');
    assert.ok(await p.$eval('#crew-journal', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    await p.keyboard.press('Escape');
  }
  await p.keyboard.press('Escape'); assert.equal(await p.evaluate(() => window.__app.game.naturalist.open), false);
  await p.keyboard.press('o'); await p.click('[data-action="rescue"]');
  await p.waitForFunction(() => { const g = window.__app.game; return g.lastMode === 'deck' && !g.naturalist.open; });
  assert.equal(await p.$eval('#observe-wildlife', e => e.hidden), true);
  await p.keyboard.press('j'); await p.waitForSelector('#crew-journal[open]'); await p.keyboard.press('Escape');
  results.entries = await p.evaluate(() => window.__app.game.naturalist.entries);
  await p.reload(); await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  assert.deepEqual(await p.evaluate(() => window.__app.game.naturalist.entries), results.entries, 'Sightings survive reload');
  // The shared sampling extraction must also preserve the original exploration UI.
  await useExpandedTools(p); await p.goto(`${base}?mode=explore&site=reef&preset=low&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#dive-observe'); await p.waitForSelector('#wildlife-watch:not([hidden])'); await sleep(600);
  assert.ok(await p.evaluate(() => window.__app.expedition.watch.samples.length > 0));
  await p.click('#watch-journal'); await p.waitForSelector('.field-journal[open]');
  assert.ok(await p.$$eval('#journal-entries article', es => es.length) >= results.entries.length, 'Original exploration reads the same saved field journal');
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log('PASS: live animal identification, free movement, journal isolation and persistence, responsive study, boarding, original explorer compatibility', JSON.stringify(results));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
