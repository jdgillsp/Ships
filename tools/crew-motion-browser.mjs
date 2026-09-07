import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';

const { server } = createGameServer({ ...simulation, addPlayer(world, id, name) {
  const p = simulation.addPlayer(world, id, name);
  p.mode = 'diver'; p.x = name === 'Observer' ? -135 : -140; p.y = -16; p.z = 140; p.yaw = 0; return p;
} });
server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const out = 'tools/shots/crew-motion'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(name, room) {
  const context = await browser.createBrowserContext(), p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`http://127.0.0.1:${server.address().port}/?mode=expedition&preset=low&adaptive=0&profile=1${room ? `&room=${room}` : ''}`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.$eval('#crew-name', (e, name) => { e.value = name; }, name); await p.click('#start-expedition');
  await p.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'diver');
  return p;
}
const inspect = p => p.evaluate(() => {
  const g = window.__app.game, m = g.models, index = Object.keys(g.state.players).findIndex(id => id !== g.net.id), root = m.crew[index], rig = m.crewRigs[index];
  const eye = rig.head.localToWorld(root.position.clone().set(0, .26, .255));
  const sample = g.frameWorld.players[Object.keys(g.state.players)[index]];
  return { pitch: rig.pose.rotation.x, head: rig.head.rotation.x, knees: rig.joints.map(j => j.knee.rotation.x),
    visible: root.visible, waterVisible: m.waterCrew[index].visible,
    waterError: m.waterCrew[index].getObjectByName('crew-pose').quaternion.angleTo(rig.pose.quaternion),
    eye: eye.toArray(), sample: [sample.x, sample.y, sample.z], fins: rig.joints.map(j => j.fin.visible) };
});
async function aim(p) {
  await p.evaluate(() => {
    const g = window.__app.game, a = g.state.players[g.net.id], b = Object.values(g.state.players).find(p => p.id !== g.net.id);
    g.yaw = Math.atan2(b.x - a.x, b.z - a.z); g.pitch = Math.atan2(b.y - a.y - .4, Math.hypot(b.x - a.x, b.z - a.z));
  }); await sleep(300);
}
try {
  const observer = await open('Observer'), room = await observer.evaluate(() => window.__app.game.net.room), swimmer = await open('Swimmer', room);
  await swimmer.evaluate(() => { const g = window.__app.game; g.yaw = 0; g.pitch = 0; });
  await aim(observer); await observer.screenshot({ path: `${out}/01-idle.png` });
  await observer.waitForFunction(() => { const g = window.__app.game; return g.bubbles.trail.bubbles.filter(b => b.owner !== g.net.id).length > 24; }, { timeout: 10000 });
  const exhalation = await observer.evaluate(() => {
    const b = window.__app.game.bubbles;
    return { count: b.trail.bubbles.length, drawn: b.geometry.drawRange.count, sharedGeometry: b.air.geometry === b.water.geometry, materials: b.air.material === b.water.material, sameClock: b.trail.time === window.__app.game.frameWorld.time };
  });
  assert.equal(exhalation.count, exhalation.drawn); assert.ok(exhalation.sharedGeometry && exhalation.materials && exhalation.sameClock);
  await observer.screenshot({ path: `${out}/01b-exhalation.png` });
  await observer.screenshot({ path: `${out}/01c-exhalation-detail.png`, clip: { x: 570, y: 180, width: 350, height: 450 } });
  await observer.evaluate(() => {
    const a = window.__app; window.motionHooks = { before: a.beforeUpdate, after: a.afterUpdate, paused: a.paused };
    a.beforeUpdate = () => {}; a.afterUpdate = () => {}; a.paused = true;
    const attrs = a.game.bubbles.geometry.attributes; attrs.aPrevious.copyArray(attrs.position.array); attrs.aPrevious.needsUpdate = true;
  });
  for (const [name, sun, storm] of [['01d-bubbles-dusk', .09, 0], ['01e-bubbles-storm', .3, .85]]) {
    await observer.evaluate(({ sun, storm }) => { const a = window.__app; a.weather.set({ sunElevation: sun, storm, cloudCoverage: .35 + storm * .65, rain: storm * .5 }, true); a.weather.update(0); a.post.reset = true; a.clouds.reset = true; }, { sun, storm });
    await sleep(1200); await observer.screenshot({ path: `${out}/${name}.png` });
  }
  await observer.evaluate(() => { const a = window.__app, hooks = window.motionHooks; a.beforeUpdate = hooks.before; a.afterUpdate = hooks.after; a.paused = hooks.paused; delete window.motionHooks; a.post.reset = true; a.clouds.reset = true; });
  const bubbleTiming = await observer.evaluate(async () => {
    const a = window.__app, b = a.game.bubbles, update = b.update, samples = [], passes = {}; let shown = true, maxParticles = 0;
    b.update = function(...args) { const start = performance.now(); update.apply(this, args); samples.push(performance.now() - start); maxParticles = Math.max(maxParticles, this.geometry.drawRange.count); if (!shown) this.air.visible = this.water.visible = false; };
    try {
      for (const visible of [false, true]) { shown = visible; a.profiler.reset(); for (let i = 0; i < 40; i++) await new Promise(requestAnimationFrame); passes[visible ? 'visible' : 'hidden'] = a.profiler.report(); }
    } finally { b.update = update; }
    samples.sort((a, b) => a - b); return { samples: samples.length, maxParticles, medianMs: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)], passes };
  });
  await swimmer.keyboard.down('w'); await sleep(1100);
  const swimming = await inspect(observer);
  assert.ok(swimming.pitch > 1.1, 'A remote player visibly leans into real forward swimming');
  assert.ok(Math.hypot(...swimming.eye.map((v, i) => v - swimming.sample[i])) < 1e-5, 'The animated eye stays on this frame’s interpolated player position');
  assert.ok(swimming.visible && swimming.waterVisible && swimming.fins.every(Boolean));
  assert.ok(swimming.waterError < 1e-7, 'The underwater rig follows the surface rig');
  await aim(observer); await observer.screenshot({ path: `${out}/02-swimming.png` });
  await swimmer.keyboard.up('w'); await sleep(1200);
  const stopped = await inspect(observer); assert.ok(Math.abs(stopped.pitch) < .03, 'A stopped swimmer settles upright');
  await swimmer.evaluate(() => { window.__app.game.pitch = .7; }); await sleep(400);
  const looking = await inspect(observer); assert.ok(Math.abs(looking.pitch + looking.head + .7) < .01, 'The visible head follows upward aim');
  await aim(observer); await observer.screenshot({ path: `${out}/03-looking-up.png` });
  const cpu = await observer.evaluate(async () => {
    const models = window.__app.game.models, update = models.updateCameraVisibility, samples = [];
    models.updateCameraVisibility = function(camera) { const start = performance.now(); update.call(this, camera); samples.push(performance.now() - start); };
    try { for (let i = 0; i < 40; i++) await new Promise(requestAnimationFrame); } finally { models.updateCameraVisibility = update; }
    samples.sort((a, b) => a - b); return { samples: samples.length, medianMs: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)] };
  });
  // Hold a deck pose for close art review through the production renderer.
  await observer.evaluate(() => {
    const a = window.__app, g = a.game; g.net.close(); a.beforeUpdate = () => {}; a.afterUpdate = () => {};
    document.getElementById('game').style.display = 'none';
    const w = structuredClone(g.state); Object.assign(w.ship, { heading: 0, pitch: 0, roll: 0, y: 0 });
    Object.values(w.players).forEach(p => Object.assign(p, { mode: 'deck', deckX: 2.5, deckZ: 1.1, deckYaw: Math.PI }));
    g.models.update(w, g.net.id, 'deck');
    a.camera.position.copy(g.models.ship.localToWorld(a.camera.position.clone().set(4.1, 3.7, -2.5)));
    a.camera.lookAt(g.models.ship.localToWorld(a.camera.position.clone().set(2.5, 2.9, 1.1))); a.camera.updateMatrixWorld();
  });
  for (const [name, sun, storm] of [['04-deck-day', .55, 0], ['05-deck-dusk', .09, 0], ['06-deck-storm', .3, .85]]) {
    await observer.evaluate(({ sun, storm }) => {
      const a = window.__app; a.weather.set({ sunElevation: sun, sunAzimuth: 2.1, storm, cloudCoverage: .35 + storm * .65, rain: storm * .5, windSpeed: 5 + storm * 18 }, true);
      a.weather.update(0); a.game.models.shadow.update(a.game.models.ship, true); a.post.reset = true; a.clouds.reset = true;
    }, { sun, storm });
    await sleep(1500); await observer.screenshot({ path: `${out}/${name}.png` });
  }
  assert.deepEqual(errors, []);
  const results = { swimming, stopped, looking, exhalation, bubbleTiming, cpu, errors }; await fs.writeFile(`${out}/result.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
