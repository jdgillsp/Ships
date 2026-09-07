import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
const out = 'tools/shots/cloud-continuity'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 960, height: 640 } });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(vite.resolvedUrls.local[0] + '?mode=expedition&preset=low&adaptive=0');
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.evaluate(async () => {
    const a = window.__app; a.running = false; a.game.net.close(); document.getElementById('game').style.display = 'none';
    const { DataUtils } = await import('/node_modules/three/build/three.module.js');
    const { updateFrameUniforms } = await import('/src/core/SharedUniforms.js');
    const { FullScreenPass } = await import('/src/gfx/FullScreenPass.js');
    a.weather.set({ sunElevation: .55, sunAzimuth: 2.1, cloudCoverage: .35, cloudDensity: .55, cloudBottom: 900, cloudTop: 2600, windSpeed: 5, storm: 0, rain: 0 }, true); a.weather.update(0);
    a.camera.fov = 55; a.camera.updateProjectionMatrix(); a.camera.position.set(-140, 3.6, 440); a.camera.lookAt(-140, 3.6, 300);
    const c = a.clouds; c.interleave = 1; c.activeSlots = [[0, 0]];
    for (const pass of [c.marchPass, c.reprojPass, c.upsamplePass]) pass.set('uInterleave', 1);
    c.setSize(c.fullW, c.fullH, true);
    const display = new FullScreenPass('uniform sampler2D src; in vec2 vUv; out vec4 color; void main(){vec4 c=texture(src,vUv);color=vec4(pow(max(vec3(0),c.rgb+vec3(.08,.2,.35)*c.a),vec3(1./2.2)),1);}', { src: { value: null } });
    const values = {};
    window.sampleCloud = (name, top, scale) => {
      c.frame = 0; c.lastUpdateFrame = undefined; c.reset = true; c.shared.uCloudTop.value = top; c.shared.uCloudScaleM.value = scale;
      updateFrameUniforms(a.camera, a.camera.projectionMatrix, 1 / 60, 0, 0); c.update(0, 1 / 60);
      const raw = new Uint16Array(c.lowW * c.lowH * 4); a.renderer.readRenderTargetPixels(c.history.read, 0, 0, c.lowW, c.lowH, raw);
      values[name] = Float32Array.from(raw, DataUtils.fromHalfFloat); display.set('src', c.screenTexture).render(a.renderer);
    };
    window.compareCloud = name => {
      const x = values.baseline, y = values[name]; let delta = 0, color = 0, energy = 0, opacity = 0, count = 0;
      // Stay above the horizon, where distant thin slivers are undersampled.
      for (let row = Math.ceil(c.lowH * .6); row < c.lowH - 2; row++) for (let col = 2; col < c.lowW - 2; col++) {
        const i = (row * c.lowW + col) * 4; delta += Math.abs(x[i + 3] - y[i + 3]); opacity += 1 - x[i + 3];
        for (let channel = 0; channel < 3; channel++) { color += (x[i + channel] - y[i + channel]) ** 2; energy += x[i + channel] ** 2; } count++;
      }
      return { baselineOpacity: opacity / count, opacityChange: delta / count, radianceRMSE: Math.sqrt(color / Math.max(energy, 1e-8)) };
    };
    window.weatherCut = () => {
      const opacity = () => { const raw = new Uint16Array(c.lowW * c.lowH * 4); a.renderer.readRenderTargetPixels(c.history.read, 0, 0, c.lowW, c.lowH, raw); let sum = 0, count = 0; for (let y = Math.ceil(c.lowH * .6); y < c.lowH; y++) for (let x = 0; x < c.lowW; x++) { sum += 1 - DataUtils.fromHalfFloat(raw[(y * c.lowW + x) * 4 + 3]); count++; } return sum / count; };
      c.shared.uCoverage.value = 0; c.reset = true; updateFrameUniforms(a.camera, a.camera.projectionMatrix, 1 / 60, 0, 0); c.update(0, 1 / 60);
      c.shared.uCoverage.value = .95; updateFrameUniforms(a.camera, a.camera.projectionMatrix, 1 / 60, 0, 1); c.update(0, 1 / 60); const firstFrame = opacity();
      c.reset = true; c.update(0, 1 / 60); const fresh = opacity();
      c.shared.uCoverage.value = .949; c.update(0, 1 / 60);
      return { firstFrame, fresh, ratio: firstFrame / fresh, gradualUsesHistory: c.reprojPass.uniforms.uReset.value === 0 };
    };
  });
  const results = {};
  for (const [name, top, scale] of [['baseline', 2600, 7000], ['thickness', 2600.1, 7000], ['scale', 2600, 7000.5]]) {
    await p.evaluate(({ name, top, scale }) => window.sampleCloud(name, top, scale), { name, top, scale });
    await p.screenshot({ path: `${out}/${name}.png` });
    if (name !== 'baseline') results[name] = await p.evaluate(name => window.compareCloud(name), name);
  }
  const weatherCut = await p.evaluate(() => window.weatherCut());
  console.log(JSON.stringify({ results, weatherCut, errors })); await fs.writeFile(`${out}/result.json`, JSON.stringify({ results, weatherCut, errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const [name, r] of Object.entries(results)) {
    assert.ok(r.baselineOpacity > .02 && r.baselineOpacity < .98, 'The continuity fixture must retain visible cloud shapes and clear sky');
    assert.ok(r.opacityChange < .01, `Tiny cloud ${name} adjustment jumps ${(r.opacityChange * 100).toFixed(1)}% of sky opacity`);
    // Single-offset lighting can change when the adaptive march crosses a
    // boundary; opacity tests the whole-cloud jumps this regression targets.
  }
  assert.ok(weatherCut.fresh > .2, 'A storm must produce visible cloud');
  assert.ok(weatherCut.ratio > .95, `Abrupt weather retains the old clear sky: first-frame opacity is ${(weatherCut.ratio * 100).toFixed(1)}% of a fresh render`);
  assert.equal(weatherCut.gradualUsesHistory, true, 'Gradual weather retains temporal accumulation');
} finally { await browser.close(); await vite.close(); }
