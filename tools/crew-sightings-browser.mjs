import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';

const app = createGameServer({ ...simulation, addPlayer(w, id, name) {
  const p = simulation.addPlayer(w, id, name);
  if (name === 'Mira') Object.assign(p, { mode: 'diver', x: -140, z: 140, y: oceanFloor(-140, 140, simulation.RECIPE) + 6 });
  return p;
} });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const out = 'tools/shots/crew-sightings'; await fs.mkdir(out, { recursive: true });
const errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(name, room = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0${room ? `&room=${room}` : ''}`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.$eval('#crew-name', (e, value) => { e.value = value; }, name); await page.click('#start-expedition');
  await page.waitForFunction(mode => window.__app.game.net.ready && window.__app.game.lastMode === mode, {}, name === 'Mira' ? 'diver' : 'deck'); return page;
}
try {
  const a = await open('Mira'), room = await a.evaluate(() => window.__app.game.net.room), b = await open('Rowan', room);
  await b.keyboard.press('j'); await b.waitForSelector('#crew-journal[open]');
  assert.equal(await b.$$eval('#crew-journal-entries article', es => es.length), 0);
  await a.bringToFront(); await a.keyboard.press('o'); await a.click('#toggle-study-notes');
  // The fixture starts at a populated reef; identification itself uses the
  // actual rendered animals, observation hold, light and sightline checks.
  for (let n = 0; n < 12 && await a.$eval('#share-wildlife', e => e.disabled); n++) {
    await a.evaluate(n => { const g = window.__app.game; g.yaw = n * Math.PI / 6; g.pitch = -.25; }, n); await sleep(2200);
  }
  await a.waitForSelector('#share-wildlife:enabled');
  const subject = await a.evaluate(() => window.__app.game.naturalist.candidate.sample.type);
  const personal = await a.evaluate(() => window.__app.game.naturalist.entries.map(e => e.type)); assert.ok(personal.includes(subject));
  await a.click('#share-wildlife');
  await a.waitForFunction(type => window.__app.game.state.sightings?.[type]?.observer === 'Mira', {}, subject);
  await a.screenshot({ path: `${out}/shared-observation.png` });
  await b.waitForSelector(`#journal-entry-${subject} .shared-sighting`);
  assert.match(await b.$eval(`#journal-entry-${subject}`, e => e.textContent), /Crew report.*Shared by Mira/);
  assert.equal(await b.evaluate(() => window.__app.game.naturalist.entries.length), 0, 'A crew report does not become a personal observation');
  assert.equal(await b.$$eval('#crew-journal-entries img', es => es.length), 0, 'Sharing the report does not transfer photographs');
  await b.bringToFront(); await b.setViewport({ width: 390, height: 800 });
  assert.ok(await b.$eval('#crew-journal', e => e.scrollWidth <= e.clientWidth));
  await b.screenshot({ path: `${out}/journal-phone.png` });
  await b.keyboard.press('Escape'); await b.click('#crew-activities'); await b.$eval('#voyage-log', e => { e.open = true; });
  await b.waitForSelector(`[data-sighting-location="${subject}"]`); await b.click(`[data-sighting-location="${subject}"]`);
  await b.waitForFunction(type => Object.values(window.__app.game.state.places).some(p => p.sourceSighting === type), {}, subject);
  const location = await b.evaluate(type => Object.values(window.__app.game.state.places).find(p => p.sourceSighting === type), subject);
  assert.match(location.note, /observer’s position/);
  await b.keyboard.press('Escape'); await b.keyboard.press('n'); await b.select('#voyage-destination', location.id);
  assert.match(await b.$eval('#voyage-description', e => e.textContent), /reported by Mira/);
  await b.click('#plot-course'); await a.waitForFunction(id => window.__app.game.state.course?.id === id, {}, location.id);
  assert.equal(app.rooms.get(room).world.cargo.attached, false);
  await b.reload(); await b.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await b.click('#start-expedition'); await b.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck');
  await b.keyboard.press('j'); await b.waitForSelector(`#journal-entry-${subject} .shared-sighting`);
  assert.deepEqual(errors, []);
  console.log('Crew sightings: real identification, explicit share, live peer journal, personal-history separation, phone layout, charted observer location, shared course and rejoin passed.');
} finally { await browser.close(); await app.stop(); }
