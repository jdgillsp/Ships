import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { createGameServer } from '../server/index.mjs';
const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/dive-splash'; await fs.mkdir(out, { recursive: true });
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': base } } }); await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(vite.resolvedUrls.local[0] + '?mode=expedition&preset=high&adaptive=0');
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck' && window.__app.game.net.ready);
  const room = await p.evaluate(() => window.__app.game.net.room);
  const post = async (path, body, token) => { const r = await fetch(`${base}/api/rooms/${room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); assert.ok(r.ok); return r.json(); };
  const peer = await post('join', { name: 'Rowan' });
  await p.waitForFunction(id => window.__app.game.splash.trail.players.has(id), {}, peer.id);
  assert.equal(await p.evaluate(() => window.__app.game.splash.geometry.drawRange.count), 0);
  await post('action', { action: 'dive' }, peer.token);
  await p.waitForFunction(() => {
    const a = window.__app, drops = a.game.splash.trail.drops;
    if (!drops.length) return false;
    a.running = false; a.paused = true; a.beforeUpdate = null; a.afterUpdate = null;
    window.entryDrops = structuredClone(drops); window.entryWorld = structuredClone(a.game.frameWorld); return true;
  });
  const entry = await p.evaluate(() => ({ count: window.entryDrops.length, x: window.entryDrops[0].x, z: window.entryDrops[0].z })); assert.equal(entry.count, 96);
  await p.evaluate(async () => {
    const a = window.__app, { U } = await import('/src/core/SharedUniforms.js'); window.splashU = U;
    a.game.net.close(); a.game.root.hidden = true;
    window.showEntry = (condition, height = 3, enabled = true) => {
      const weather = { day: { sunElevation: .55, cloudCoverage: .35, storm: 0 }, golden: { sunElevation: .07, cloudCoverage: .35, storm: 0 }, storm: { sunElevation: .25, cloudCoverage: .98, storm: 1 } }[condition];
      a.weather.set(weather, true); a.weather.update(0);
      const d = window.entryDrops[0], w = structuredClone(window.entryWorld); w.time = d.born + .22; w.storm = weather.storm;
      a.game.splash.trail.drops = structuredClone(window.entryDrops); a.game.splash.trail.time = w.time;
      a.camera.position.set(d.x + height * .3, height, d.z - Math.max(6, height * .2)); a.camera.lookAt(d.x, .5, d.z); a.camera.updateMatrixWorld();
      a.game.splash.previousTime = w.time; a.game.splash.update(w);
      a.game.splash.air.visible = a.game.splash.water.visible = enabled;
      a.post.reset = a.clouds.reset = true; a.frame = 32;
      for (let i = 0; i < 12; i++) a.render(0);
      return { count: a.game.splash.geometry.drawRange.count, error: a.renderer.getContext().getError() };
    };
  });
  const views = [];
  for (const condition of ['day', 'golden', 'storm']) for (const enabled of [false, true]) {
    const sample = await p.evaluate(({ condition, enabled }) => window.showEntry(condition, 3, enabled), { condition, enabled });
    assert.equal(sample.error, 0); views.push({ condition, enabled, ...sample }); await p.screenshot({ path: `${out}/${condition}-${enabled ? 'splash' : 'before'}.png` });
  }
  for (const height of [200, 1000]) {
    const sample = await p.evaluate(height => window.showEntry('day', height), height); assert.equal(sample.error, 0);
    await p.screenshot({ path: `${out}/scale-${height}.png` });
  }
  const timing = await p.evaluate(async () => {
    window.showEntry('day'); const a = window.__app, r = a.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return { available: false };
    const samples = { before: [], splash: [] }, draw = () => { r.setRenderTarget(a.hdrRT); r.clear(); r.render(a.scene, a.camera); };
    for (let i = 0; i < 6; i++) draw(); gl.finish();
    for (let i = 0; i < 16; i++) for (const name of i % 2 ? ['splash', 'before'] : ['before', 'splash']) {
      a.game.splash.air.visible = name === 'splash'; const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); draw(); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise(r => setTimeout(r, 10));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples[name].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
    }
    return Object.fromEntries(Object.entries(samples).map(([name, v]) => { v.sort((a, b) => a - b); return [name, { median: v[Math.floor(v.length / 2)], p95: v[Math.floor(v.length * .95)], samples: v.length }]; }));
  });
  assert.deepEqual(errors, []); const result = { entry, views, timing, errors }; await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await vite.close(); await app.stop(); }
