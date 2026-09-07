import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(), { server } = app; server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`, out = 'tools/shots/voyage'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(room, name) {
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await useExpandedTools(p); await p.goto(`${base}?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.$eval('#crew-name', (e, name) => { e.value = name; }, name); await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready); return p;
}
try {
  const a = await open(null, 'Navigator'), room = await a.evaluate(() => window.__app.game.net.room), b = await open(room, 'Captain');
  await b.keyboard.press('h'); await b.waitForFunction(() => { const g = window.__app.game; return g.state.ship.pilot === g.net.id; });
  const captain = await b.evaluate(() => window.__app.game.net.id);
  await a.waitForFunction(id => window.__app.game.state.ship.pilot === id, {}, captain);
  await a.bringToFront(); await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]');
  assert.equal(await a.$$eval('#voyage-destination option', es => es.length), 15);
  const before = await a.evaluate(() => { const g = window.__app.game, p = g.state.players[g.net.id]; return [p.deckX, p.deckZ, g.state.ship.heading, g.state.ship.pilot]; });
  await a.keyboard.down('w'); await sleep(450); await a.keyboard.up('w');
  assert.deepEqual(await a.evaluate(() => { const g = window.__app.game, p = g.state.players[g.net.id]; return [p.deckX, p.deckZ, g.state.ship.heading, g.state.ship.pilot]; }), before);
  const point = await a.evaluate(() => { const v = window.__app.game.voyage, site = v.sites.find(s => s.id === 'kelp'), r = v.$('voyage-map').getBoundingClientRect(); return { x: r.left + v.map(site.x) / 640 * r.width, y: r.top + v.map(site.z) / 640 * r.height }; });
  await a.mouse.click(point.x, point.y); assert.equal(await a.$eval('#voyage-destination', e => e.value), 'kelp');
  await a.screenshot({ path: `${out}/01-voyage-chart.png` });
  await a.select('#voyage-destination', 'reef'); await a.click('#plot-course');
  await b.waitForFunction(() => window.__app.game.state.course?.id === 'reef');
  await b.waitForSelector('#objective-marker.course-location:not([hidden])');
  assert.deepEqual(await b.evaluate(() => window.__app.game.state.course), await a.evaluate(() => window.__app.game.state.course));
  assert.equal(await b.evaluate(() => window.__app.game.state.ship.pilot), before[3]);
  assert.equal(await a.evaluate(() => window.__app.game.state.mission), 'outbound');
  await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]');
  const chartTiming = await a.evaluate(() => {
    const chart = window.__app.game.voyage;
    chart.background = null; const start = performance.now(); chart.makeBackground(); const first = performance.now() - start;
    const image = chart.background, cachedStart = performance.now(); chart.makeBackground();
    return { first, cached: performance.now() - cachedStart, reused: image === chart.background };
  });
  assert.ok(chartTiming.reused, 'Seabed sampling is cached between chart updates');
  await a.select('#voyage-destination', 'kelp');
  const paths = await a.evaluate(() => {
    const g = window.__app.game, chart = g.voyage, c = chart.$('voyage-map').getContext('2d');
    const original = c.stroke, paths = [];
    c.stroke = function () { if (this.lineWidth === 2.5) paths.push({ color: this.strokeStyle, dash: this.getLineDash() }); return original.call(this); };
    try { chart.updateUI(g.state); } finally { c.stroke = original; }
    return paths;
  });
  assert.ok(paths.some(p => p.color === '#264e43' && p.dash.length === 0));
  assert.ok(paths.some(p => p.color === '#8b5938' && p.dash.join() === '5,7'));
  assert.equal(await a.evaluate(() => window.__app.game.state.course.id), 'reef', 'Considering a different site does not change the shared course');
  assert.match(await a.$eval('#voyage-status', e => e.textContent), /Plot to change course/);
  await a.screenshot({ path: `${out}/01b-active-and-considered.png` });
  await a.keyboard.press('Escape');
  console.log(JSON.stringify({ chartTiming, routeStyles: paths }));
  console.log('Navigator plots a shared course without taking the captain’s helm');
  await b.bringToFront(); await b.keyboard.press('b'); await b.keyboard.down('w');
  await b.waitForFunction(() => window.__app.game.state.ship.z < 193, { timeout: 60000 });
  await b.keyboard.up('w'); await b.keyboard.press('b');
  await b.waitForFunction(() => Math.abs(window.__app.game.state.ship.speed) < .1);
  await a.waitForFunction(() => document.getElementById('mission-detail').textContent.includes('V to enter'));
  await b.screenshot({ path: `${out}/02-site-arrival.png` });
  await a.bringToFront(); await a.keyboard.press('v'); await a.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await a.keyboard.down('ControlLeft'); await sleep(2300); await a.keyboard.up('ControlLeft');
  await a.waitForFunction(() => document.getElementById('mission-detail').textContent.includes('O to study'));
  await a.screenshot({ path: `${out}/03-habitat-dive.png` });
  await a.select('#track-crewmate', 'ship'); await a.waitForFunction(() => document.querySelector('#objective-marker .objective-label').textContent === 'Kestrel');
  assert.match(await a.$eval('#objective-marker .objective-distance', e => e.textContent), /Return aboard/);
  await a.keyboard.press('n');
  const expectedBearing = await a.evaluate(() => { const g = window.__app.game, s = g.state.ship, t = g.voyage.sites.find(s => s.id === 'reef'); return (Math.round((Math.atan2(-(t.x - s.x), t.z - s.z) * 180 / Math.PI + 360) % 360) % 360).toString().padStart(3, '0'); });
  assert.match(await a.$eval('#voyage-range', e => e.textContent), new RegExp(`${expectedBearing}°`), 'Voyage planning uses the ship bearing even while the navigator dives');
  for (const width of [600, 390]) {
    await a.setViewport({ width, height: 800 }); await sleep(350);
    assert.ok(await a.$eval('#voyage-chart', e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    await a.$eval('#plot-course', e => e.scrollIntoView({ block: 'center' }));
    assert.ok(await a.$eval('#plot-course', e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && !e.disabled; }));
    assert.ok(await a.$eval('#close-voyage', e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'Close remains reachable after scrolling the chart');
    await a.screenshot({ path: `${out}/04-chart-${width}.png` });
  }
  await a.keyboard.press('Escape'); await a.reload(); await a.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await a.click('#start-expedition'); await a.waitForFunction(() => window.__app.game.net.ready);
  assert.equal(await a.evaluate(() => window.__app.game.state.course.id), 'reef');
  await a.keyboard.press('n'); await a.click('#clear-course'); await b.waitForFunction(() => window.__app.game.state.course === null);
  await b.waitForFunction(() => !document.getElementById('objective-marker').classList.contains('course-location'));
  assert.equal(await b.evaluate(() => window.__app.game.state.cargo.attached), false);
  assert.deepEqual(errors, []); await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, checks: ['15 sites', 'map selection', 'dialog input isolation', 'shared course', 'helm ownership', 'real sailing and anchoring', 'dive guidance', 'return-to-ship focus', 'phone layouts', 'rejoin course', 'restore mission'], errors }, null, 2));
  console.log('PASS: shared voyage planning, sailing to the reef, diving, ship focus, narrow charts and rejoin');
} finally { await browser.close(); await app.stop(); }
