import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(resolve => app.server.once('listening', resolve));
const out = 'tools/shots/mast-radar'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition');
  await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  const live = await page.evaluate(async () => {
    const g = window.__app.game, read = () => ({ time: g.frameWorld.time, angle: g.models.radar.rotation.y });
    const first = read(); await new Promise(resolve => setTimeout(resolve, 700)); return [first, read()];
  });
  assert.ok(live[1].time > live[0].time + .4, 'The live voyage advances');
  assert.notEqual(live[0].angle, live[1].angle, 'The radar runs during ordinary anchored play');
  await page.evaluate(() => {
    const a = window.__app, g = a.game; a.running = false; a.beforeUpdate = a.afterUpdate = null; g.net.close(); g.root.hidden = true;
    const world = structuredClone(g.frameWorld); world.ship.pitch = world.ship.roll = 0;
    const radarMesh = g.models.radar.children[0], waterMesh = g.models.copies[g.models.originals.indexOf(radarMesh)];
    const history = [];
    for (const [side, mesh] of [['air', radarMesh], ['water', waterMesh]]) {
      const before = mesh.onBeforeRender;
      mesh.onBeforeRender = function(...args) {
        before.apply(this, args);
        if (args[4].uniforms?.uPrevModelMatrix) history.push({ side, previous: args[4].uniforms.uPrevModelMatrix.value.toArray(), current: this.matrixWorld.toArray() });
      };
    }
    window.radarQA = { world, history, radarMesh, waterMesh };
    window.showRadar = (time = 0, condition = 'day', view = 'mast') => {
      const weather = { day: { sunElevation: .55, cloudCoverage: .35, storm: 0 }, golden: { sunElevation: .07, cloudCoverage: .35, storm: 0 }, storm: { sunElevation: .25, cloudCoverage: .98, storm: .9 } }[condition];
      const storm = weather.storm; world.storm = storm;
      Object.assign(weather, { windSpeed: 5 + storm * 18, swellHs: .7 + storm * 3.2, cloudDensity: .55 + storm * .7, rain: storm * .65, fog: storm * .25, spray: storm * .45 });
      world.time = time; a.time = time; a.weather.set(weather, true); a.weather.update(0); g.models.update(world, g.net.id, view === 'deck' ? 'deck' : 'chase');
      const vector = (x, y, z) => a.camera.position.clone().set(x, y, z), ship = g.models.ship;
      const eye = view === 'mast' ? [2.8, 8.2, -1.8] : view === 'deck' ? [2.5, 3.6, -1.7] : view === 'wide' ? [14, 10, -23] : [0, view, -view * .35];
      const target = view === 'mast' ? [0, 7.1, 2] : view === 'deck' ? [0, 6, 2] : [0, 3, 0];
      a.camera.position.copy(ship.localToWorld(vector(...eye))); a.camera.lookAt(ship.localToWorld(vector(...target)));
      a.camera.fov = 55; a.camera.aspect = innerWidth / innerHeight; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld();
      a.post.reset = a.clouds.reset = true;
      for (let i = 0; i < 12; i++) a.render(0);
      const copy = g.models.copies[g.models.originals.indexOf(g.models.radar)];
      const shadow = g.models.shadow.copy[g.models.shadow.source.indexOf(g.models.radar)];
      return { angle: g.models.radar.rotation.y, copyMatches: copy.quaternion.equals(g.models.radar.quaternion), shadowMatches: shadow.quaternion.equals(g.models.radar.quaternion), error: a.renderer.getContext().getError() };
    };
  });
  const phases = [];
  for (const time of [0, 1, 2, 3, 4, 40001]) {
    const sample = await page.evaluate(time => window.showRadar(time), time);
    assert.equal(sample.error, 0); assert.ok(sample.copyMatches, 'Both water passes use the identical orientation');
    assert.ok(sample.shadowMatches, 'The shadow caster follows the current scanner pose');
    phases.push({ time, ...sample });
    if (time < 4) await page.screenshot({ path: `${out}/01-phase-${time}.png` });
  }
  assert.equal(phases[0].angle, phases[4].angle, 'A full scan returns to the same bearing');
  assert.equal(phases[1].angle, phases[5].angle, 'Rejoining a long voyage has the same scan phase');
  assert.ok(new Set(phases.slice(0, 4).map(p => p.angle)).size === 4, 'All four quarter-turns are distinct');
  const motion = await page.evaluate(() => {
    window.showRadar(0); const a = window.__app, g = a.game, qa = window.radarQA;
    const before = qa.radarMesh.matrixWorld.toArray(); qa.history.length = 0;
    qa.world.time = .1; g.models.update(qa.world, g.net.id, 'chase'); a.render(0);
    return { before, samples: qa.history };
  });
  const air = motion.samples.find(s => s.side === 'air');
  assert.ok(air, 'The animated scanner is drawn through the production material');
  assert.deepEqual(air.previous, motion.before, 'Motion vectors use the preceding scanner pose');
  assert.notDeepEqual(air.current, air.previous, 'Rotation contributes actual object motion');
  const conditions = [];
  for (const condition of ['day', 'golden', 'storm']) for (const view of ['wide', 'deck']) {
    const sample = await page.evaluate(({ condition, view }) => window.showRadar(.5, condition, view), { condition, view });
    assert.equal(sample.error, 0); conditions.push({ condition, view, ...sample });
    await page.screenshot({ path: `${out}/02-${condition}-${view}.png` });
  }
  for (const height of [200, 1000]) {
    await page.evaluate(height => window.showRadar(.5, 'day', height), height);
    await page.screenshot({ path: `${out}/03-scale-${height}.png` });
  }
  const timing = await page.evaluate(async () => {
    window.showRadar(0, 'day', 'wide'); const a = window.__app, r = a.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return { available: false };
    const draw = () => { r.setRenderTarget(a.hdrRT); r.clear(); r.render(a.scene, a.camera); };
    const samples = { stationary: [], rotating: [] };
    for (let i = 0; i < 8; i++) draw(); gl.finish();
    for (let i = 0; i < 20; i++) for (const variant of ['stationary', 'rotating']) {
      a.game.models.radar.rotation.y = variant === 'stationary' ? 0 : i / 20 * Math.PI * 2;
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); draw(); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise(resolve => setTimeout(resolve, 10));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples[variant].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
    }
    return Object.fromEntries(Object.entries(samples).map(([key, values]) => { values.sort((a, b) => a - b); return [key, { median: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], samples: values.length }]; }));
  });
  assert.deepEqual(errors, []);
  const result = { live, phases, motionHistory: true, conditions, airSceneGpuMs: timing, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
