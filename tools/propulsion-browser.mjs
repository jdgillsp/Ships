import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/propulsion'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm');
  await page.keyboard.press('b'); await page.waitForFunction(() => !window.__app.game.state.ship.anchor);
  await page.keyboard.down('w'); await page.keyboard.down('d');
  await page.waitForFunction(() => { const g = window.__app.game; return g.frameWorld.ship.speed > 2 && g.frameWorld.ship.yawRate < -.08 && g.models.propeller.rotation.z > 1; });
  const ahead = await page.evaluate(() => { const g = window.__app.game; return { phase: g.models.propeller.rotation.z, sharedPhase: g.frameWorld.ship.propellerAngle, rudder: g.models.rudder.rotation.y, speed: g.frameWorld.ship.speed }; });
  assert.equal(ahead.phase, ahead.sharedPhase); assert.ok(ahead.rudder > .1);
  const room = await page.evaluate(() => window.__app.game.net.room);
  const joined = await (await fetch(`${base}/api/rooms/${room}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rowan' }) })).json();
  assert.ok(joined.state.ship.propellerAngle >= ahead.sharedPhase, 'A newly joining crewmate receives the advancing shaft phase');
  await page.keyboard.up('w'); await page.keyboard.up('d'); await page.keyboard.down('s'); await page.keyboard.down('a');
  await page.waitForFunction(() => window.__app.game.frameWorld.ship.speed < -1);
  const reverseStart = await page.evaluate(() => window.__app.game.models.propeller.rotation.z);
  await page.waitForFunction(phase => window.__app.game.models.propeller.rotation.z < phase - .4, {}, reverseStart);
  assert.ok(await page.evaluate(() => window.__app.game.models.rudder.rotation.y < -.1));
  await page.keyboard.up('s'); await page.keyboard.up('a'); await page.keyboard.press('b');
  await page.waitForFunction(() => Math.abs(window.__app.game.frameWorld.ship.speed) < .005);
  const rest = await page.evaluate(async () => { const g = window.__app.game, phase = g.models.propeller.rotation.z; await new Promise(r => setTimeout(r, 400)); return Math.abs(g.models.propeller.rotation.z - phase); });
  assert.ok(rest < .003, 'The anchored shaft settles instead of spinning continuously');
  await page.evaluate(() => {
    const a = window.__app, g = a.game; a.running = false; a.beforeUpdate = a.afterUpdate = null; g.net.close(); g.root.hidden = true;
    const world = structuredClone(g.frameWorld); Object.assign(world.ship, { heading: 0, pitch: 0, roll: 0, y: 0, speed: 0, yawRate: 0, propellerAngle: 0 }); world.players = {};
    const prop = g.models.copies[g.models.originals.indexOf(g.models.propeller.children.find(o => o.isMesh))], history = [], before = prop.onBeforeRender;
    prop.onBeforeRender = function(...args) { before.apply(this, args); if (args[4].uniforms?.uPrevModelMatrix) history.push({ previous: args[4].uniforms.uPrevModelMatrix.value.toArray(), current: this.matrixWorld.toArray() }); };
    window.shaftQA = { world, prop, history };
    window.showShaft = (phase = 0, condition = 'day', view = 'underwater', rudder = 0) => {
      const storm = condition === 'storm' ? .9 : 0; Object.assign(world.ship, { propellerAngle: phase, yawRate: -.12 * rudder }); world.storm = storm;
      a.weather.set({ sunElevation: condition === 'golden' ? .07 : .55, sunAzimuth: 2.1, storm, cloudCoverage: storm ? .98 : .35, windSpeed: 5 + storm * 18, swellHs: .7 + storm * 3.2, cloudDensity: .55 + storm * .7, rain: storm * .65, fog: storm * .25, spray: storm * .45 }, true); a.weather.update(0);
      g.models.update(world, g.net.id, 'chase');
      const v = (...args) => a.camera.position.clone().set(...args), ship = g.models.ship;
      const eye = view === 'underwater' ? [2.3, -1.45, -9.3] : view === 'waterline' ? [3.8, .4, -11] : [0, Number(view), -Number(view) * .35];
      a.camera.position.copy(ship.localToWorld(v(...eye))); a.camera.lookAt(ship.localToWorld(v(0, -1.05, -7.8)));
      a.camera.fov = 52; a.camera.aspect = innerWidth / innerHeight; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld(); a.post.reset = a.clouds.reset = true;
      for (let i = 0; i < 12; i++) a.render(0);
      const m = g.models, water = m.copies[m.originals.indexOf(m.propeller)], shadow = m.shadow.copy[m.shadow.source.indexOf(m.propeller)];
      return { phase: m.propeller.rotation.z, waterError: water.quaternion.angleTo(m.propeller.quaternion), shadowError: shadow.quaternion.angleTo(m.propeller.quaternion), error: a.renderer.getContext().getError() };
    };
  });
  const phases = [];
  for (const phase of [0, .5, 1, 1.5]) {
    const sample = await page.evaluate(phase => window.showShaft(phase), phase); assert.equal(sample.error, 0); assert.ok(sample.waterError < 1e-7 && sample.shadowError < 1e-7); phases.push(sample);
    await page.screenshot({ path: `${out}/phase-${phase}.png` });
  }
  const motion = await page.evaluate(() => {
    window.showShaft(0, 'day', 'waterline'); const a = window.__app, q = window.shaftQA, old = q.prop.matrixWorld.toArray(); q.history.length = 0;
    q.world.ship.propellerAngle = .15; a.game.models.update(q.world, a.game.net.id, 'chase'); a.render(0); return { old, sample: q.history[0] };
  });
  assert.ok(motion.sample, 'The propeller draws through the production motion material'); assert.deepEqual(motion.sample.previous, motion.old); assert.notDeepEqual(motion.sample.current, motion.old);
  for (const condition of ['day', 'golden', 'storm']) for (const view of ['underwater', 'waterline']) {
    await page.evaluate(({ condition, view }) => window.showShaft(.45, condition, view, .8), { condition, view }); await page.screenshot({ path: `${out}/${condition}-${view}.png` });
  }
  for (const view of ['200', '1000']) { await page.evaluate(view => window.showShaft(.45, 'day', view), view); await page.screenshot({ path: `${out}/scale-${view}.png` }); }
  const timings = await page.evaluate(async () => {
    window.showShaft(); const a = window.__app, m = a.game.models, r = a.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return { available: false };
    const prop = m.copies[m.originals.indexOf(m.propeller)], rudder = m.copies[m.originals.indexOf(m.rudder)], samples = { hidden: [], visible: [] };
    for (let i = 0; i < 24; i++) for (const state of ['hidden', 'visible']) {
      prop.visible = rudder.visible = state === 'visible'; const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); r.setRenderTarget(a.hdrRT); r.clear(); r.render(a.underwater.scene, a.camera); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise(r => setTimeout(r, 10));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples[state].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
    }
    return Object.fromEntries(Object.entries(samples).map(([state, values]) => { values.sort((a, b) => a - b); return [state, { median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)], samples: values.length }]; }));
  });
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), ahead, reverse: true, joiningPhase: true, restDelta: rest, phases, motionHistory: true, underwaterSceneGpuMs: timings, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
