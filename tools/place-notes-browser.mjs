import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/place-notes'; await fs.mkdir(out, { recursive: true });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#crew-name'); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('Mira');
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.started && window.__app.game.net.ready);
  const room = await page.evaluate(() => window.__app.game.net.room), w = app.rooms.get(room).world;
  w.places = { 'place-1': { id: 'place-1', name: 'Quiet anchorage', x: -110, y: 0, z: 405, time: w.time, savedBy: 'Mira' } }; w.signalSequence = 1;
  w.course = { id: 'place-1', owner: Object.keys(w.players)[0] };
  await page.waitForFunction(() => window.__app.game.state.places['place-1']);
  await page.keyboard.press('n'); await page.waitForSelector('#voyage-chart[open]'); await page.click('#place-notebook summary');
  const fill = async (selector, text) => { await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(text); };
  await fill('#edit-place-note', 'My unsaved turtle observation.');
  await page.select('#voyage-destination', 'reef'); await page.select('#voyage-destination', 'place-1');
  assert.equal(await page.$eval('#edit-place-note', e => e.value), 'My unsaved turtle observation.');
  const post = async (path, body, token) => {
    const r = await fetch(`${base}/api/rooms/${room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.ok(r.ok); return r.json();
  };
  const peer = await post('join', { name: 'Rowan' });
  await post('action', { action: 'updatePlace', destination: 'place-1', expectedRevision: 0, name: 'Turtle shallows', note: 'A ray beside the kelp.' }, peer.token);
  await page.waitForSelector('#reload-place-note:not([hidden])');
  assert.equal(await page.$eval('#edit-place-note', e => e.value), 'My unsaved turtle observation.');
  assert.equal(await page.$eval('#update-place', e => e.disabled), true);
  assert.match(await page.$eval('#voyage-description', e => e.textContent), /A ray beside the kelp/);
  await page.click('#reload-place-note');
  assert.equal(await page.$eval('#edit-place-note', e => e.value), 'A ray beside the kelp.');
  await fill('#edit-place-note', 'A ray beside the kelp.\nTwo turtles by the eastern rock.');
  await page.click('#update-place');
  await page.waitForFunction(() => window.__app.game.state.places['place-1'].revision === 2);
  assert.equal(w.course.id, 'place-1'); assert.equal(w.places['place-1'].updatedBy, 'Mira');
  assert.deepEqual([w.places['place-1'].x, w.places['place-1'].y, w.places['place-1'].z], [-110, 0, 405]);
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 800 }); await page.$eval('#place-notebook', e => e.scrollIntoView({ block: 'center' }));
    assert.ok(await page.$eval('#voyage-chart', e => e.scrollWidth <= e.clientWidth));
    await page.screenshot({ path: `${out}/notes-${width}.png` });
  }
  await page.keyboard.press('Escape'); await page.reload();
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.started && window.__app.game.net.ready);
  await page.keyboard.press('n'); await page.waitForSelector('#voyage-chart[open]'); await page.click('#place-notebook summary');
  assert.equal(await page.$eval('#edit-place-note', e => e.value), 'A ray beside the kelp.\nTwo turtles by the eastern rock.');
  assert.equal(await page.$eval('#edit-place-name', e => e.value), 'Turtle shallows');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ nativeEditing: true, draftAcrossDestinations: true, concurrentEditProtected: true, explicitReload: true, coursePreserved: true, rejoin: true, phoneLayout: true, errors }));
} finally { await browser.close(); await app.stop(); }
