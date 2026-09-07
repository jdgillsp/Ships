import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/full-crew'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
let heartbeat;
try {
  const page = await browser.newPage(), errors = [], peers = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition');
  await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  const post = async (route, body, token, ok = true) => {
    const response = await fetch(`${base}/api/rooms/${room}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.equal(response.ok, ok); return response.json();
  };
  for (const name of ['Alexandria Northwind', 'Rowan Seabrook', 'Christopher Westward']) peers.push(await post('join', { name }));
  heartbeat = setInterval(() => { for (const peer of peers) post('input', {}, peer.token).catch(e => errors.push(e.message)); }, 700);
  await page.waitForFunction(() => Object.values(window.__app.game.frameWorld.players).filter(p => p.connected).length === 4);
  const rejected = await post('join', { name: 'Fifth crew' }, undefined, false);
  assert.match(rejected.error, /four crew/);
  const [rear, front, captain] = peers;
  // A full crew can line up in the narrow side passage. Aim at the rear head:
  // the front crewmate should occlude it, including its interactive name tag.
  Object.assign(world.players[rear.id], { deckX: 2.5, deckZ: 3.5 });
  Object.assign(world.players[front.id], { deckX: 2.5, deckZ: 1.5 });
  await post('action', { action: 'helm' }, captain.token);
  await page.waitForFunction(id => window.__app.game.frameWorld.players[id].deckZ === 3.5, {}, rear.id);
  await page.evaluate(id => {
    const g = window.__app.game, i = Object.keys(g.frameWorld.players).indexOf(id), point = g.app.camera.position.clone().set(0, .22, 0);
    g.models.crewRigs[i].head.localToWorld(point); point.sub(g.app.camera.position);
    g.orbit = Math.atan2(point.x, point.z) - g.frameWorld.ship.heading;
    g.deckPitch = Math.atan2(point.y, Math.hypot(point.x, point.z));
  }, rear.id);
  await page.waitForSelector('#crew-in-view:not([hidden])');
  const sightline = await page.evaluate(({ rear, front }) => {
    const g = window.__app.game, list = Object.keys(g.frameWorld.players), point = g.app.camera.position.clone().set(0, .22, 0);
    g.models.crewRigs[list.indexOf(rear)].head.localToWorld(point);
    const distance = point.distanceTo(g.app.camera.position), ray = g.crewAwareness.ray;
    ray.set(g.app.camera.position, point.sub(g.app.camera.position).normalize()); ray.far = distance;
    return { distance, frontHit: ray.intersectObject(g.models.crew[list.indexOf(front)], true)[0]?.distance, label: document.getElementById('crew-in-view').textContent };
  }, { rear: rear.id, front: front.id });
  await page.screenshot({ path: `${out}/01-side-deck.png` });
  assert.ok(sightline.frontHit < sightline.distance, 'The foreground crew model physically covers the rear head');
  assert.ok(sightline.label.includes('Rowan'), 'The label must identify the visible foreground crewmate');
  await page.click('#crew-in-view'); assert.equal(await page.evaluate(() => window.__app.game.crewTracking.id), front.id);
  assert.equal(world.ship.pilot, captain.id, 'Tracking a nearby crewmate preserves the captain');
  Object.assign(world.players[front.id], { deckZ: -4 });
  await page.waitForFunction(() => document.getElementById('crew-in-view').checkVisibility() && document.getElementById('crew-in-view').textContent.includes('Alexandria'));
  Object.assign(world.players[front.id], { deckZ: 1.5 });
  await page.waitForFunction(() => document.getElementById('crew-in-view').checkVisibility() && document.getElementById('crew-in-view').textContent.includes('Rowan'));
  const samplingCpuMs = await page.evaluate(async () => {
    const g = window.__app.game, n = g.crewAwareness, values = [];
    for (let i = 0; i < 30; i++) { await new Promise(requestAnimationFrame); n.lastUpdate = -Infinity; const start = performance.now(); n.update(g.frameWorld, start); values.push(performance.now() - start); }
    values.sort((a, b) => a - b); return { samples: values.length, median: values[15], p95: values[28] };
  });
  const layouts = [];
  await post('action', { action: 'dive' }, rear.token);
  await page.waitForFunction(id => window.__app.game.state.players[id].mode === 'diver', {}, rear.id);
  for (const width of [1280, 600, 390]) {
    await page.setViewport({ width, height: 800 });
    await page.click('#crew-activities'); await page.waitForSelector('#crew-activities-dialog[open]');
    const layout = await page.$eval('#crew-activities-dialog', e => {
      const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, text: e.textContent };
    });
    assert.ok(layout.left >= 0 && layout.right <= width && layout.scrollWidth <= layout.clientWidth + 1, 'The full crew notebook fits the viewport');
    for (const peer of peers) assert.ok(layout.text.includes(world.players[peer.id].name));
    const rows = await page.$$eval('#activities-crew tbody tr', rows => rows.map(row => ({ name: row.querySelector('th').textContent, duty: row.querySelector('td').textContent })));
    assert.equal(rows.length, 4, 'The manifest gives each connected crewmate a separate row');
    assert.ok(rows.some(row => row.name.includes(world.players[rear.id].name) && row.duty.startsWith('Diving')));
    assert.ok(rows.some(row => row.name.includes(world.players[captain.id].name) && row.duty === 'Captain'));
    assert.equal(rows.filter(row => row.name.includes('You')).length, 1, 'The local identity is marked once');
    await page.screenshot({ path: `${out}/02-notebook-${width}.png` });
    await page.$eval('#activities-crew', e => e.scrollIntoView({ block: 'center' }));
    const roster = await page.$eval('#activities-crew', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    assert.ok(roster.left >= 0 && roster.right <= width && roster.top >= 0 && roster.bottom <= 800, 'Every crew member can be read in the scrolled notebook');
    await page.screenshot({ path: `${out}/03-roster-${width}.png` });
    layouts.push({ width, left: layout.left, right: layout.right, overflow: layout.scrollWidth - layout.clientWidth });
    await page.keyboard.press('Escape');
  }
  clearInterval(heartbeat); heartbeat = null;
  await post('leave', {}, captain.token);
  await page.waitForFunction(() => window.__app.game.state.ship.pilot === null);
  const resumed = await post('join', { token: captain.token, resume: true });
  assert.equal(resumed.id, captain.id); assert.equal(world.ship.pilot, null, 'Rejoining does not reclaim the helm');
  await post('action', { action: 'helm' }, front.token); assert.equal(world.ship.pilot, front.id);
  assert.deepEqual(errors, []);
  const result = { recordedAt: new Date().toISOString(), fullCrew: true, rejectsFifth: true, foregroundIdentification: sightline, uncoveredCrewReappears: true, captainPreserved: true, rejoinAndTakeover: true, samplingCpuMs, layouts, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { clearInterval(heartbeat); await browser.close(); await app.stop(); }
