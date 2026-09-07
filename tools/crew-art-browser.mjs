import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const tag = process.argv[2] || 'after', out = `tools/shots/crew-art-${tag}`;
await fs.mkdir(out, { recursive: true });
const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0&profile=1`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck');
  const geometry = await page.evaluate(() => {
    const a = window.__app, g = a.game; a.running = false; a.beforeUpdate = a.afterUpdate = null; g.net.close(); g.root.hidden = true;
    const world = structuredClone(g.frameWorld), p = structuredClone(world.players[g.net.id]);
    world.players = { review: { ...p, id: 'review', deckX: 2.5, deckZ: 0, deckYaw: Math.PI, connected: true } };
    Object.assign(world.ship, { heading: 0, pitch: 0, roll: 0, y: 0 }); world.time = 10;
    window.crewArt = { world };
    window.showCrew = (condition = 'day', view = 'front') => {
      const p = world.players.review, storm = condition === 'storm' ? .9 : 0;
      world.storm = storm; p.mode = view === 'dive' || view === 'swim' ? 'diver' : 'deck';
      Object.assign(p, { x: -135, y: -8, z: 140, yaw: Math.PI, pitch: 0 });
      a.weather.set({ sunElevation: condition === 'golden' ? .07 : .55, sunAzimuth: 2.1, storm, cloudCoverage: storm ? .98 : .35, windSpeed: 5 + storm * 18, swellHs: .7 + storm * 3.2, cloudDensity: .55 + storm * .7, rain: storm * .65, fog: storm * .25, spray: storm * .45 }, true); a.weather.update(0);
      g.models.update(world, g.net.id, 'chase');
      const v = (x, y, z) => a.camera.position.clone().set(x, y, z), ship = g.models.ship;
      if (p.mode === 'diver') {
        a.camera.position.set(-133.2, -8.1, 136.3); a.camera.lookAt(-135, -8.7, 140);
      } else {
        const eye = view === 'rear' ? [3.9, 3.6, 3.5] : view === 'front' || view.startsWith('walk') ? [3.7, 3.55, -3.2] : [0, Number(view), -Number(view) * .35];
        a.camera.position.copy(ship.localToWorld(v(...eye))); a.camera.lookAt(ship.localToWorld(v(2.5, 2.95, 0)));
      }
      if (view === 'swim' || view.startsWith('walk')) {
        const rig = g.models.crewRigs[0], sign = view === 'walk-a' ? 1 : -1;
        const pose = view === 'swim' ? { bodyPitch: 1.3, headPitch: -1.3, bob: 0, legs: [-.25, .25], knees: [.2, .4], arms: [-.3, -.2], elbows: [-.55, -.55], ankles: [1, 1.2] }
          : { bodyPitch: 0, headPitch: 0, bob: .02, legs: [-.38 * sign, .38 * sign], knees: sign === 1 ? [.4, .08] : [.08, .4], arms: [.25 * sign, -.25 * sign], elbows: [-.14, -.14], ankles: [-.05, -.05] };
        const eye = rig.apply(pose, p.mode === 'diver');
        if (p.mode === 'diver') g.models.crew[0].position.set(p.x, p.y, p.z).sub(eye.applyQuaternion(g.models.crew[0].quaternion));
        for (let i = 0; i < g.models.originals.length; i++) { const o = g.models.originals[i], c = g.models.copies[i]; c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale); c.visible = o.visible; }
        g.models.shadow.update(g.models.ship);
      }
      a.camera.fov = 45; a.camera.aspect = innerWidth / innerHeight; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld(); a.post.reset = a.clouds.reset = true;
      for (let i = 0; i < 12; i++) a.render(0);
      return { error: a.renderer.getContext().getError() };
    };
    let triangles = 0, meshes = 0; g.models.crew[0].traverse(o => { if (o.isMesh) { meshes++; const geo = o.geometry; triangles += (geo.index?.count ?? geo.attributes.position.count) / 3; assertFinite(geo.attributes.position.array); } });
    function assertFinite(values) { if (!values.every(Number.isFinite)) throw new Error('Non-finite crew geometry'); }
    return { triangles, meshes };
  });
  for (const condition of ['day', 'golden', 'storm']) for (const view of ['front', 'rear', 'dive', 'swim', 'walk-a', 'walk-b']) {
    assert.equal((await page.evaluate(({ condition, view }) => window.showCrew(condition, view), { condition, view })).error, 0);
    await page.screenshot({ path: `${out}/${condition}-${view}.png` });
  }
  for (const view of ['200', '1000']) { await page.evaluate(view => window.showCrew('day', view), view); await page.screenshot({ path: `${out}/scale-${view}.png` }); }
  const timings = await page.evaluate(async () => {
    window.showCrew(); const a = window.__app, r = a.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return { available: false };
    const times = [];
    for (let i = 0; i < 25; i++) {
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); r.setRenderTarget(a.hdrRT); r.clear(); r.render(a.scene, a.camera); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise(resolve => setTimeout(resolve, 10));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
    }
    times.sort((a, b) => a - b); return { samples: times.length, median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * .95)] };
  });
  assert.deepEqual(errors, []); const result = { tag, recordedAt: new Date().toISOString(), geometry, airSceneGpuMs: timings, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
