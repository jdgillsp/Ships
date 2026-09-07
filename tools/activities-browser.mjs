import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/activities'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(name, room) {
  const context = await browser.createBrowserContext(), p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.$eval('#crew-name', (e, name) => { e.value = name; }, name); await p.click('#start-expedition');
  await p.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck'); return p;
}
async function activities(p) { await p.bringToFront(); await p.click('#crew-activities'); await p.waitForSelector('#crew-activities-dialog[open]'); }
try {
  const a = await open('Mira'); await a.keyboard.press('h');
  await a.waitForFunction(() => window.__app.game.lastMode === 'helm');
  const room = await a.evaluate(() => window.__app.game.net.room), b = await open('Rowan', room);
  const captain = await a.evaluate(() => window.__app.game.net.id);
  await b.keyboard.down('w'); await activities(b); await b.keyboard.up('w');
  await b.waitForFunction(() => window.__app.game.keys.size === 0);
  const deck = await b.evaluate(() => { const g = window.__app.game, p = g.state.players[g.net.id]; return { x: p.deckX, z: p.deckZ }; });
  await b.keyboard.down('w'); await b.keyboard.press('v'); await sleep(450); await b.keyboard.up('w');
  assert.equal(await b.evaluate(() => window.__app.game.lastMode), 'deck', 'Role shortcuts cannot act behind the activities dialog');
  const settled = await b.evaluate(() => { const g = window.__app.game, p = g.state.players[g.net.id]; return { x: p.deckX, z: p.deckZ }; });
  assert.ok(Math.hypot(deck.x - settled.x, deck.z - settled.z) < .4, 'Opening the panel clears held walking');
  assert.match(await b.$eval('#activities-intro', e => e.textContent), /Mira has the helm/);
  assert.equal(await b.$eval('#activity-recover', e => e.disabled), true);
  await b.screenshot({ path: `${out}/01-deck-activities.png` });
  await b.click('#activity-lookout'); await b.waitForFunction(() => window.__app.game.lookout);
  assert.equal(await b.evaluate(() => window.__app.game.state.ship.pilot), captain, 'Scouting leaves the captain in control');
  await b.keyboard.press('l'); await activities(b); await b.click('#activity-navigate'); await b.waitForSelector('#voyage-chart[open]');
  await b.select('#voyage-destination', 'reef'); await b.click('#plot-course'); await b.waitForSelector('#voyage-chart:not([open])');
  await a.waitForFunction(() => window.__app.game.state.course?.id === 'reef');
  assert.equal(await a.evaluate(() => window.__app.game.state.ship.pilot), captain);
  await activities(b);
  for (const width of [600, 390]) {
    await b.setViewport({ width, height: 800 });
    await b.$eval('#crew-activities-dialog', e => { e.scrollTop = 0; });
    const layout = await b.$eval('#crew-activities-dialog', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, content: e.scrollWidth, width: e.clientWidth }; });
    assert.ok(layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom <= 800 && layout.content <= layout.width, 'Phone dialog fits without horizontal overflow');
    await b.screenshot({ path: `${out}/02-activities-${width}.png` });
    await b.$eval('#activity-dive', e => e.scrollIntoView({ block: 'center' })); await b.screenshot({ path: `${out}/03-dive-${width}.png` });
  }
  await b.setViewport({ width: 1440, height: 900 }); await b.click('#activity-dive');
  await b.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await activities(b); assert.equal(await b.$eval('#activity-lookout', e => e.disabled), true);
  await b.screenshot({ path: `${out}/04-diver-activities.png` });
  await b.click('#activity-dive'); await b.waitForFunction(() => window.__app.game.naturalist.open);
  assert.equal(await b.$eval('#crew-activities-dialog', e => e.open), false);
  await b.keyboard.press('o');
  await activities(b); await b.click('#activities-journal'); await b.waitForSelector('#crew-journal[open]'); await b.keyboard.press('Escape');
  // The captain can release the helm and start scouting through one card.
  await activities(a); await a.click('#activity-lookout'); await a.waitForFunction(() => window.__app.game.lookout && window.__app.game.lastMode === 'deck');
  await sleep(400); assert.equal(await a.evaluate(() => window.__app.game.lookout), true, 'Camera mode transition retains the requested lookout view');
  await b.waitForFunction(() => window.__app.game.state.ship.pilot === null);
  await a.keyboard.press('l'); await a.setViewport({ width: 390, height: 800 });
  const overlap = await a.evaluate(() => { const c = document.querySelector('.ship-console').getBoundingClientRect(), m = document.querySelector('.mission-panel').getBoundingClientRect(), b = document.getElementById('crew-activities').getBoundingClientRect(); return { consoleTop: c.top, missionBottom: m.bottom, left: b.left, right: b.right, bottom: b.bottom }; });
  assert.ok(overlap.consoleTop > overlap.missionBottom && overlap.left >= 0 && overlap.right <= 390 && overlap.bottom <= 800, 'Crew entry stays visible without covering the mission');
  await a.screenshot({ path: `${out}/05-phone-console.png` });
  assert.deepEqual(errors, []); console.log(JSON.stringify({ crewScouting: true, sharedNavigation: true, divingAndStudy: true, helmReleaseToLookout: true, phoneWidths: [600, 390], errors }));
} finally { await browser.close(); await app.stop(); }
