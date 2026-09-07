import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { WINCH_VIEW } from '../src/game/RecoveryRig.js';

const { server } = createGameServer({ ...simulation, createWorld() {
  const w = simulation.createWorld(); w.ship.x = w.cargo.x; w.ship.z = w.cargo.z + 6.82;
  w.ship.heading = 0; w.ship.anchor = true; w.cargo.attached = true; w.mission = 'recovery'; return w;
} });
server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const out = 'tools/shots/recovery'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1280, height: 800 } });
const errors = [], results = {};
const open = async room => {
  const context = await browser.createBrowserContext(), p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`http://127.0.0.1:${server.address().port}/?mode=expedition&preset=low&adaptive=0&profile=1${room ? `&room=${room}` : ''}`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready); return p;
};
const inspect = p => p.evaluate(() => {
  const a = window.__app, m = a.game.models, drum = m.machinery.drum;
  const centre = drum.getWorldPosition(a.camera.position.clone()).project(a.camera);
  const start = m.cable.localToWorld(m.cable.position.clone().set(0, -.5, 0)), end = m.cable.localToWorld(m.cable.position.clone().set(0, .5, 0));
  return { angle: drum.rotation.x, water: m.waterRoot.getObjectByName('Recovery drum').rotation.x,
    shadow: m.shadow.root.getObjectByName('Recovery drum').rotation.x, lever: m.machinery.lever.rotation.x,
    active: m.machinery.active.visible, waiting: m.machinery.waiting.visible, view: a.game.view,
    centre: centre.toArray(), cable: m.cable.visible,
    startError: start.distanceTo(m.ship.localToWorld(start.clone().set(0, 5.35, -6.82))),
    endError: end.distanceTo(m.crate.localToWorld(end.clone().set(0, 1.39, 0))) };
});
try {
  const p = await open(), room = await p.evaluate(() => window.__app.game.net.room), peer = await open(room);
  await p.bringToFront(); await p.keyboard.press('r');
  await p.waitForFunction(() => window.__app.game.state.players[window.__app.game.net.id].mode === 'winch' && window.__app.game.models.machinery.drum.rotation.x < -.5);
  results.lifting = await inspect(p);
  assert.equal(results.lifting.view, 'deck');
  assert.ok(Math.abs(results.lifting.centre[0]) < .65 && Math.abs(results.lifting.centre[1]) < .65, 'Taking the station frames the drum');
  assert.ok(results.lifting.startError < 1e-5 && results.lifting.endError < 1e-5, 'The cable joins the sheave and lifting eye');
  assert.equal(results.lifting.active, true); assert.ok(results.lifting.lever < 0);
  await p.screenshot({ path: `${out}/01-lifting.png` });
  await p.keyboard.press('b'); await p.waitForFunction(() => window.__app.game.models.machinery.waiting.visible);
  await new Promise(r => setTimeout(r, 700)); results.paused = await inspect(p);
  await new Promise(r => setTimeout(r, 700)); results.held = await inspect(p); results.peer = await inspect(peer);
  assert.equal(results.held.angle, results.paused.angle, 'Paused recovery stops the drum');
  assert.equal(results.peer.angle, results.held.angle, 'Both crew members see the same stopped drum');
  for (const state of [results.held, results.peer]) {
    // Quaternion copies normalise the Euler representation after a full turn.
    for (const angle of [state.water, state.shadow]) assert.ok(Math.abs(Math.atan2(Math.sin(state.angle - angle), Math.cos(state.angle - angle))) < 1e-10, 'Surface, underwater and shadow copies share an orientation');
    assert.equal(state.waiting, true); assert.equal(state.active, false);
  }
  await p.mouse.move(760, 380); await p.mouse.down(); await p.mouse.move(940, 450, { steps: 6 }); await p.mouse.up(); await p.keyboard.press('Home');
  await p.waitForFunction(yaw => Math.abs(window.__app.game.orbit - yaw) < .001, {}, WINCH_VIEW.yaw);
  await p.screenshot({ path: `${out}/02-paused-reset.png` });
  results.performance = await p.evaluate(async () => {
    const a = window.__app; a.profiler.reset(); for (let i = 0; i < 40; i++) await new Promise(requestAnimationFrame);
    let meshes = 0; a.game.models.ship.traverse(o => { if (o.isMesh) meshes++; });
    return { passes: a.profiler.report(), shipMeshes: meshes, geometries: a.renderer.info.memory.geometries };
  });
  await p.keyboard.press('b'); await p.waitForFunction(angle => window.__app.game.models.machinery.drum.rotation.x < angle - .5, {}, results.held.angle);
  await p.waitForFunction(() => window.__app.game.state.cargo.recovered, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 500)); results.secured = await inspect(p);
  assert.equal(results.secured.cable, false); assert.equal(results.secured.lever, 0); assert.equal(results.secured.waiting, false);
  assert.equal(await p.evaluate(() => window.__app.game.state.players[window.__app.game.net.id].mode), 'deck');
  assert.ok(await p.evaluate(yaw => Math.abs(window.__app.game.orbit - yaw) < .001, WINCH_VIEW.yaw), 'Finishing recovery preserves the operator’s viewing direction');
  await p.screenshot({ path: `${out}/03-secured.png` });
  assert.deepEqual(errors, []); await fs.writeFile(`${out}/result.json`, JSON.stringify({ results, errors }, null, 2)); console.log(JSON.stringify({ results, errors }));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
