import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/anchor'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  await page.keyboard.press('b'); await page.waitForFunction(() => window.__app.game.frameWorld.ship.anchorDrop < .8);
  const raising = await page.evaluate(() => { const g = window.__app.game; return { drop: g.frameWorld.ship.anchorDrop, gypsy: g.models.anchorGear.gypsy.rotation.x, room: g.net.room }; });
  assert.equal(raising.gypsy, -raising.drop * 24);
  const joined = await (await fetch(`${base}/api/rooms/${raising.room}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rowan' }) })).json();
  assert.ok(joined.state.ship.anchorDrop > 0 && joined.state.ship.anchorDrop < 1);
  await page.waitForFunction(() => window.__app.game.frameWorld.ship.anchorDrop === 0);
  await page.keyboard.press('b'); await page.waitForFunction(() => window.__app.game.frameWorld.ship.anchorDrop > .25);
  await page.keyboard.press('b'); await page.waitForFunction(() => window.__app.game.frameWorld.ship.anchorDrop === 0);
  await page.keyboard.press('b'); await page.waitForFunction(() => window.__app.game.frameWorld.ship.anchorDrop === 1);
  await page.evaluate(() => {
    const a = window.__app, g = a.game; a.running = false; a.beforeUpdate = a.afterUpdate = null; g.net.close(); g.root.hidden = true;
    const world = structuredClone(g.frameWorld); Object.assign(world.ship, { x: -140, z: 300, y: 0, heading: 0, speed: 0, yawRate: 0, pitch: 0, roll: 0 }); world.players = {};
    const line = g.models.copies[g.models.originals.indexOf(g.models.anchorGear.line)], history = [], before = line.onBeforeRender;
    line.onBeforeRender = function(...args) { before.apply(this, args); if (args[4].uniforms?.uPrevModelMatrix) history.push({ previous: args[4].uniforms.uPrevModelMatrix.value.toArray(), current: this.matrixWorld.toArray() }); };
    window.anchorQA = { world, line, history };
    window.showAnchor = (drop = 0, condition = 'day', view = 'bow') => {
      const storm = condition === 'storm' ? .9 : 0; world.ship.anchorDrop = drop; world.storm = storm;
      a.weather.set({ sunElevation: condition === 'golden' ? .07 : .55, sunAzimuth: 2.1, storm, cloudCoverage: storm ? .98 : .35, windSpeed: 5 + storm * 18, swellHs: .7 + storm * 3.2, cloudDensity: .55 + storm * .7, rain: storm * .65, fog: storm * .25, spray: storm * .45 }, true); a.weather.update(0);
      g.models.update(world, g.net.id, 'chase');
      const v = (...args) => a.camera.position.clone().set(...args), ship = g.models.ship, gear = g.models.anchorGear;
      if (view.startsWith('seabed')) { a.camera.position.copy(gear.anchor.position).add(view === 'seabed-reverse' ? v(-2.5, 1.25, -3) : v(2.5, 1.25, 3)); a.camera.lookAt(gear.anchor.position); }
      else {
        const eye = view === 'deck' ? [2.4, 3.9, 7.4] : view === 'waterline' ? [3.5, .35, 12] : view === 'bow' ? [3.2, 2.9, 12.7] : [0, Number(view), Number(view) * .4];
        a.camera.position.copy(ship.localToWorld(v(...eye))); a.camera.lookAt(ship.localToWorld(v(0, view === 'deck' ? 2.25 : 1.4, 8.9)));
      }
      a.camera.fov = 52; a.camera.aspect = innerWidth / innerHeight; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld(); a.post.reset = a.clouds.reset = true;
      for (let i = 0; i < 12; i++) a.render(0);
      const m = g.models, errors = [gear.gypsy, gear.anchor, gear.line].map(o => {
        const water = m.copies[m.originals.indexOf(o)], shadow = m.shadow.copy[m.shadow.source.indexOf(o)];
        return { water: water.position.distanceTo(o.position) + water.quaternion.angleTo(o.quaternion) + water.scale.distanceTo(o.scale), shadow: shadow.position.distanceTo(o.position) + shadow.quaternion.angleTo(o.quaternion) + shadow.scale.distanceTo(o.scale) };
      });
      const lineEnd = gear.line.localToWorld(v(0, .5, 0)), eye = gear.anchor.localToWorld(v(0, .64, 0));
      return { drop, errors, endpointError: lineEnd.distanceTo(eye), seabedClearance: gear.anchor.position.y - gear.floorY, error: a.renderer.getContext().getError() };
    };
  });
  const poses = [];
  for (const drop of [0, .25, .5, 1]) {
    const pose = await page.evaluate(drop => window.showAnchor(drop), drop); assert.equal(pose.error, 0); assert.ok(pose.endpointError < 1e-7); assert.ok(pose.errors.every(e => e.water < 1e-7 && e.shadow < 1e-7)); poses.push(pose);
    await page.screenshot({ path: `${out}/drop-${drop}.png` });
  }
  assert.ok(Math.abs(poses.at(-1).seabedClearance - .56) < 1e-7);
  const motion = await page.evaluate(() => {
    window.showAnchor(.1, 'day', 'waterline'); const a = window.__app, q = window.anchorQA, old = q.line.matrixWorld.toArray(); q.history.length = 0;
    q.world.ship.anchorDrop = .15; a.game.models.update(q.world, a.game.net.id, 'chase'); a.render(0); return { old, sample: q.history[0] };
  });
  assert.ok(motion.sample); assert.deepEqual(motion.sample.previous, motion.old); assert.notDeepEqual(motion.sample.current, motion.old);
  for (const condition of ['day', 'golden', 'storm']) for (const view of ['deck', 'waterline', 'seabed']) {
    await page.evaluate(({ condition, view }) => window.showAnchor(view === 'seabed' ? 1 : 0, condition, view), { condition, view }); await page.screenshot({ path: `${out}/${condition}-${view}.png` });
  }
  for (const view of ['200', '1000']) { await page.evaluate(view => window.showAnchor(0, 'day', view), view); await page.screenshot({ path: `${out}/scale-${view}.png` }); }
  await page.evaluate(() => window.showAnchor(1, 'day', 'seabed-reverse')); await page.screenshot({ path: `${out}/seabed-reverse.png` });
  const timings = await page.evaluate(async () => {
    window.showAnchor(0, 'day', 'bow'); const a = window.__app, m = a.game.models, gear = m.anchorGear, r = a.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return { available: false };
    const objects = [gear.mount, gear.gypsy, gear.anchor, gear.line], samples = { hidden: [], visible: [] };
    for (let i = 0; i < 24; i++) for (const state of ['hidden', 'visible']) {
      objects.forEach(o => { o.visible = state === 'visible'; }); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); r.setRenderTarget(a.hdrRT); r.clear(); r.render(a.scene, a.camera); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise(r => setTimeout(r, 10));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples[state].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
    }
    return Object.fromEntries(Object.entries(samples).map(([state, values]) => { values.sort((a, b) => a - b); return [state, { median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)], samples: values.length }]; }));
  });
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), nativeRaiseLowerReverse: true, joiningProgress: joined.state.ship.anchorDrop, poses, motionHistory: true, airSceneGpuMs: timings, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
