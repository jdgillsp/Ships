// Diagnostic ablations of cloud sampling; does not change production settings.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
const out = 'tools/shots/cloud-sampling'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 960, height: 640 } });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(vite.resolvedUrls.local[0] + '?mode=expedition&preset=low&adaptive=0');
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.evaluate(async () => {
    const a = window.__app; a.running = false; a.beforeUpdate = a.afterUpdate = null; document.getElementById('game').style.display = 'none';
    a.time = 0;
    const { DataUtils } = await import('/node_modules/three/build/three.module.js');
    const { updateFrameUniforms } = await import('/src/core/SharedUniforms.js');
    const { FullScreenPass } = await import('/src/gfx/FullScreenPass.js');
    a.weather.set({ sunElevation: .55, sunAzimuth: 2.1, cloudCoverage: .35, cloudDensity: .55, cloudBottom: 900, cloudTop: 2600, windSpeed: 5, storm: 0, rain: 0 }, true); a.weather.update(0);
    a.camera.fov = 55; a.camera.updateProjectionMatrix(); a.camera.position.set(-140, 3.6, 440); a.camera.lookAt(-140, 30, 300);
    a.render(0);
    const c = a.clouds, source = c.reprojPass.material.fragmentShader;
    window.productionCloudBudget = { steps: c.marchPass.uniforms.uSteps.value, interleave: c.interleave };
    const display = new FullScreenPass('uniform sampler2D src; in vec2 vUv; out vec4 color; void main(){vec4 c=texture(src,vUv);color=vec4(pow(max(vec3(0),c.rgb+vec3(.08,.2,.35)*c.a),vec3(1./2.2)),1);}', { src: { value: null } });
    const fields = {};
    window.cloudScene = ({ sunElevation, storm, height }) => {
      c.reprojPass.material.fragmentShader = source; c.reprojPass.material.needsUpdate = true;
      a.setQualityPreset('low');
      a.weather.set({ sunElevation, sunAzimuth: 2.1, cloudCoverage: .35 + storm * .55, cloudDensity: .55 + storm * .4, cloudBottom: 900 - storm * 300, cloudTop: 2600 + storm * 4000, windSpeed: 5 + storm * 18, storm, rain: storm * .65 }, true); a.weather.update(0);
      a.camera.position.set(-60, height, 440); a.camera.lookAt(-60, height + 15, 300); a.camera.updateMatrixWorld(true);
      c.reset = a.post.reset = true;
      for (let i = 0; i < 96; i++) a.render(1 / 60);
      return { height, sunElevation, storm, steps: c.marchPass.uniforms.uSteps.value, interleave: c.interleave };
    };
    window.sample = ({ name, interleave = 4, steps = 48, clamp = true, frames = 128 }) => {
      c.reprojPass.material.fragmentShader = clamp ? source : source.replace('hist = clamp(hist, lo - tol, hi + tol);', ''); c.reprojPass.material.needsUpdate = true;
      c.interleave = interleave; c.activeSlots = interleave === 1 ? [[0, 0]] : interleave === 2 ? c.slots.filter(([x, y]) => x < 2 && y < 2) : c.slots;
      for (const p of [c.marchPass, c.reprojPass, c.upsamplePass]) p.set('uInterleave', interleave);
      c.marchPass.set('uSteps', steps); c.setSize(c.fullW, c.fullH, true); c.frame = 0; c.lastUpdateFrame = undefined; c.reset = true;
      updateFrameUniforms(a.camera, a.camera.projectionMatrix, 1 / 60, 0, 0);
      for (let f = 0; f < frames; f++) { updateFrameUniforms(a.camera, a.camera.projectionMatrix, 1 / 60, 0, f); c.update(0, 1 / 60); }
      const raw = new Uint16Array(c.lowW * c.lowH * 4); a.renderer.readRenderTargetPixels(c.history.read, 0, 0, c.lowW, c.lowH, raw);
      fields[name] = Float32Array.from(raw, DataUtils.fromHalfFloat); display.set('src', c.screenTexture).render(a.renderer);
      return { name, interleave, steps, frames, resolution: [c.lowW, c.lowH] };
    };
    window.compare = () => Object.fromEntries(Object.entries(fields).filter(([name]) => name !== 'reference').map(([name, field]) => {
      const ref = fields.reference; let delta = 0, energy = 0, count = 0;
      for (let y = Math.ceil(c.lowH * .4); y < c.lowH - 2; y++) for (let x = 2; x < c.lowW - 2; x++) {
        const i = (y * c.lowW + x) * 4 + 3; delta += Math.abs(field[i] - ref[i]); energy += 1 - field[i]; count++;
      }
      return [name, { opacityMAE: delta / count, cloudOpacity: energy / count }];
    }));
    window.cost = async steps => {
      c.interleave = 4; c.activeSlots = c.slots;
      for (const p of [c.marchPass, c.reprojPass, c.upsamplePass]) p.set('uInterleave', 4);
      c.marchPass.set('uSteps', steps); c.setSize(c.fullW, c.fullH, true);
      const gl = a.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return { available: false };
      for (let i = 0; i < 8; i++) c.marchPass.render(a.renderer, c.quarterRT);
      const values = [];
      for (let i = 0; i < 24; i++) {
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); c.marchPass.render(a.renderer, c.quarterRT); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
        while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise(r => setTimeout(r, 10));
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) values.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
      }
      values.sort((a, b) => a - b); return { median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)], samples: values.length };
    };
  });
  const production = await page.evaluate(() => window.productionCloudBudget);
  const cases = [{ name: 'production', ...production }, { name: 'baseline' }, { name: 'no-clamp', clamp: false }, { name: 'dense', interleave: 1, frames: 8 }, { name: 'steps-66', steps: 66 }, { name: 'steps-80', steps: 80 }, { name: 'more-steps', steps: 96 }, { name: 'reference', interleave: 1, steps: 192, frames: 64 }];
  const samples = [];
  for (const setup of cases) {
    samples.push(await page.evaluate(setup => window.sample(setup), setup));
    await page.screenshot({ path: `${out}/${setup.name}.png` });
  }
  const timing = {}; for (const steps of [48, 66, 80, 96]) timing[steps] = await page.evaluate(steps => window.cost(steps), steps);
  const comparison = await page.evaluate(() => window.compare()), scenes = [];
  for (const [condition, sunElevation, storm] of [['day', .55, 0], ['golden', .06, 0], ['storm', .25, .95]]) for (const height of [3.6, 200, 1000]) {
    scenes.push({ condition, ...await page.evaluate(setup => window.cloudScene(setup), { sunElevation, storm, height }) });
    await page.screenshot({ path: `${out}/${condition}-${height}.png` });
  }
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), samples, comparison, timing, scenes, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  if (process.argv.includes('--verify')) {
    assert.ok(result.comparison.production.cloudOpacity > .05 && result.comparison.production.cloudOpacity < .95, 'The fixture must contain cloud and clear sky');
    assert.ok(result.comparison.production.opacityMAE < .02, 'The performance preset must preserve cloud coverage without large gaps from exhausted ray budgets');
  }
} finally { await browser.close(); await vite.close(); }
