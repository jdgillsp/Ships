import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { voyageSites } from '../src/game/VoyageSites.js';

const site = voyageSites().find(s => s.id === 'reef');
const { server } = createGameServer({ ...simulation, addPlayer(world, id, name) {
  const existing = !!world.players[id], p = simulation.addPlayer(world, id, name);
  if (!existing) Object.assign(p, { mode: 'diver', x: site.x + (name === 'Mira' ? 4 : 0), y: site.y, z: site.z });
  return p;
} });
server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const out = 'tools/shots/survey'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(name, room) {
  const context = await browser.createBrowserContext(), p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await useExpandedTools(p); await p.goto(`http://127.0.0.1:${server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.$eval('#crew-name', (e, name) => { e.value = name; }, name); await p.click('#start-expedition');
  await p.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'diver'); return p;
}
const record = p => p.evaluate(() => window.__app.game.state.surveys.reef);
try {
  const a = await open('Rowan'), room = await a.evaluate(() => window.__app.game.net.room), b = await open('Mira', room);
  await a.keyboard.press('n'); await a.select('#voyage-destination', 'reef'); await a.click('#plot-course');
  await b.waitForSelector('#survey-site:not([disabled]):not([hidden])');
  await a.waitForFunction(() => { const m = document.getElementById('objective-marker'); return !m.hidden && !m.classList.contains('offscreen') && !m.textContent.includes('behind you'); });
  await a.click('#sound'); await a.waitForFunction(() => window.__app.game.sound.enabled && window.__app.game.sound.context);
  await a.evaluate(() => { const sound = window.__app.game.sound, tone = sound.tone; window.surveyTones = []; sound.tone = function(notes, ...rest) { window.surveyTones.push(notes); return tone.call(this, notes, ...rest); }; });
  // A crewmate can discover surveying from the activity panel and reach its
  // keyboard controls without starting a scan or retaining a buddy waypoint.
  await a.bringToFront(); await a.select('#track-crewmate', await b.evaluate(() => window.__app.game.net.id));
  await a.click('#crew-activities'); await a.waitForSelector('#crew-activities-dialog[open]');
  assert.match(await a.$eval('#activity-survey-detail', e => e.textContent), /combined diver effort/);
  await a.click('#activity-survey'); await a.waitForFunction(() => document.activeElement.id === 'survey-site');
  assert.equal(await a.evaluate(() => window.__app.game.crewTracking.id), '');
  assert.equal((await record(a))?.seconds || 0, 0, 'Opening the controls never starts an unattended survey');
  const surveyDepth = await a.evaluate(() => { const g = window.__app.game; return g.state.players[g.net.id].y; });
  await a.keyboard.down('Space'); await a.waitForFunction(() => window.__app.game.state.surveys.reef?.seconds > .4); await a.keyboard.up('Space');
  assert.equal(await a.evaluate(() => { const g = window.__app.game; return g.state.players[g.net.id].y; }), surveyDepth);
  await a.bringToFront();
  await a.keyboard.down('x'); await a.waitForFunction(() => window.__app.game.state.surveys.reef?.seconds > 1); await a.keyboard.up('x');
  await sleep(400); const partial = await record(a); await sleep(650);
  assert.equal((await record(a)).seconds, partial.seconds, 'Releasing X pauses scanning');
  const depth = await b.evaluate(() => { const g = window.__app.game; return g.state.players[g.net.id].y; });
  await b.focus('#survey-site'); await b.keyboard.down('Space'); await sleep(500); await b.keyboard.up('Space'); await sleep(400);
  assert.equal(await b.evaluate(() => { const g = window.__app.game; return g.state.players[g.net.id].y; }), depth, 'Keyboard activation of the survey button does not ascend');
  const buttonPause = await record(b); await sleep(400); assert.equal((await record(b)).seconds, buttonPause.seconds, 'Releasing the focused button pauses scanning');
  assert.ok(buttonPause.seconds > partial.seconds, 'The survey button supports keyboard hold activation');
  await a.screenshot({ path: `${out}/01-partial.png` });
  await a.keyboard.down('x'); await a.keyboard.press('n'); await sleep(400);
  const dialogPause = await record(a); await a.keyboard.down('x'); await sleep(500); await a.keyboard.up('x');
  assert.equal((await record(a)).seconds, dialogPause.seconds, 'The chart cannot keep a held scan running');
  await a.keyboard.press('Escape');
  await b.bringToFront(); await b.click('#crew-activities'); await b.waitForSelector('#crew-activities-dialog[open]');
  await a.keyboard.down('x');
  await b.waitForFunction(() => [...document.querySelectorAll('#activities-crew tbody tr')].some(row => row.querySelector('th').textContent.includes('Rowan') && row.querySelector('td').textContent.startsWith('Surveying')));
  await b.waitForFunction(() => document.getElementById('activity-survey-detail').textContent.includes('Rowan scanning'));
  await b.screenshot({ path: `${out}/06-crew-briefing.png` });
  await a.keyboard.up('x'); await b.keyboard.press('Escape');
  // Modal closure and the next rendered survey-control state arrive separately.
  await b.waitForSelector('#crew-activities-dialog:not([open])');
  await b.waitForSelector('#survey-site:not([disabled]):not([hidden])');
  await a.keyboard.down('x'); const button = await b.$eval('#survey-site', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await b.mouse.move(button.x, button.y); await b.mouse.down();
  await a.waitForFunction(() => window.__app.game.state.surveys.reef?.active === 2);
  const teamStart = await record(a); await sleep(550); const teamEnd = await record(a);
  assert.ok(teamEnd.seconds - teamStart.seconds >= .8, 'Two actual clients contribute faster than one');
  await a.screenshot({ path: `${out}/02-team-scanning.png` });
  await a.waitForFunction(() => window.__app.game.state.surveys.reef?.completedAt != null, { timeout: 10000 });
  await b.mouse.up(); await a.keyboard.up('x');
  await b.waitForFunction(() => document.getElementById('survey-percent').textContent.includes('LOGGED'));
  await a.waitForFunction(() => window.surveyTones.some(notes => notes[0] === 523.25));
  assert.equal(await a.evaluate(() => window.surveyTones.filter(notes => notes[0] === 523.25).length), 1, 'One shared completion produces one audible cue');
  const completed = await record(a); assert.deepEqual(await record(b), completed);
  assert.deepEqual(completed.contributors.map(p => p.name).sort(), ['Mira', 'Rowan']);
  assert.equal(await a.evaluate(() => window.__app.game.state.cargo.attached), false);
  await a.screenshot({ path: `${out}/03-logged.png` });
  await a.keyboard.press('n');
  assert.match(await a.$eval('#voyage-progress', e => e.textContent), /1 of 15 sites recorded/);
  assert.match(await a.$eval('#voyage-record', e => e.textContent), /Rowan.*Mira/);
  assert.match(await a.$eval('#voyage-destination', e => e.selectedOptions[0].textContent), /^✓/);
  await a.screenshot({ path: `${out}/04-chart.png` });
  for (const width of [600, 390]) {
    await a.setViewport({ width, height: 800 }); await sleep(300);
    const layout = await a.$eval('#voyage-chart', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: innerWidth }; });
    assert.ok(layout.left >= 0 && layout.right <= width && layout.bottom <= 800);
    await a.$eval('#voyage-record', e => e.scrollIntoView({ block: 'center' })); await a.screenshot({ path: `${out}/05-chart-${width}.png` });
    await a.keyboard.press('Escape'); await sleep(250);
    const overlap = await a.evaluate(() => {
      const s = document.getElementById('habitat-survey').getBoundingClientRect(), c = document.querySelector('.ship-console').getBoundingClientRect();
      return { bottom: s.bottom, top: c.top, right: s.right, chartLeft: document.querySelector('.nav-panel').getBoundingClientRect().left, width: innerWidth };
    });
    assert.ok(overlap.bottom < overlap.top && overlap.right <= width, 'Phone survey status leaves room for controls');
    assert.ok(overlap.right <= overlap.chartLeft - 8, 'Survey details stay clear of the phone chart');
    await a.screenshot({ path: `${out}/06-status-${width}.png` }); await a.keyboard.press('n');
  }
  await a.keyboard.press('Escape'); await a.reload();
  await a.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await a.click('#start-expedition'); await a.waitForFunction(() => window.__app.game.net.ready);
  assert.deepEqual(await record(a), completed, 'Rejoining retains the shared survey log');
  await a.keyboard.press('n'); await a.click('#clear-course');
  await b.waitForFunction(() => window.__app.game.state.course === null);
  await b.waitForSelector('#habitat-survey[hidden]');
  assert.deepEqual(await record(b), completed); assert.equal(await b.$eval('#habitat-survey', e => e.hidden), true);
  assert.deepEqual(errors, []); console.log(JSON.stringify({ partial, teamStart, teamEnd, completed, errors }));
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ partial, teamStart, teamEnd, completed, errors }, null, 2));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
