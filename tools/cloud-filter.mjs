import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// Exercise the production reconstruction shader without weather, raymarch
// noise or camera history hiding a sub-texel sampling error.
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
vite.middlewares.use('/__cloud-filter', (_req, res) => res.end('<!doctype html><title>Cloud reconstruction</title>'));
await vite.listen();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(vite.resolvedUrls.local[0] + '__cloud-filter');
  const results = await p.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { Clouds } = await import('/src/sky/Clouds.js');
    const { makeRT } = await import('/src/gfx/FullScreenPass.js');
    const renderer = new T.WebGLRenderer();
    const atmosphere = { skyViewRT: { texture: null }, transmittanceRT: { texture: null } };
    const c = new Clouds(renderer, atmosphere, {}, { cloudScale: .5, cloudSteps: 64, cloudLightSteps: 4, envCloudSteps: 8, envSize: 64, cloudEnabled: true });
    const sw = 16, sh = 12, dw = 93, dh = 71;
    const target = makeRT(dw, dh, { type: T.FloatType });
    const pass = c.upsamplePass;
    pass.set('uSharpen', 0); pass.uniforms.uInvSrc.value.set(1 / sw, 1 / sh); pass.uniforms.uSrcRes.value.set(sw, sh);
    const weights = f => [-.5 * f + f * f - .5 * f ** 3, 1 - 2.5 * f * f + 1.5 * f ** 3, .5 * f + 2 * f * f - 1.5 * f ** 3, -.5 * f * f + .5 * f ** 3];
    const results = {};
    for (const [interleave, strength] of [[4, 0], [2, .85], [4, .85], [2, 1], [4, 1]]) {
    pass.set('uInterleave', interleave).set('uSharpen', strength);
    for (const [name, field] of [
      ['constant', () => .4],
      ['billows', (x, y) => .5 + .22 * Math.cos(x * 1.1) * Math.cos(y * .8)],
      ['edge', (x, y) => (x - 7) ** 2 + (y - 5) ** 2 < 12 ? .75 : .25],
      ['ramp', (x, y) => .2 + x * .025 + y * .015],
      ['two-texel-grid', (x, y) => .5 + .15 * ((x + y) % 2 ? 1 : -1)],
      ['four-texel-grid', (x, y) => .5 + .15 * Math.cos(x * Math.PI / 2) * Math.cos(y * Math.PI / 2)],
    ]) {
      if (name.endsWith('-grid') && strength !== 1) continue;
      const data = new Float32Array(sw * sh * 4);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) data.fill(field(x, y), (y * sw + x) * 4, (y * sw + x + 1) * 4);
      const texture = new T.DataTexture(data, sw, sh, T.RGBAFormat, T.FloatType);
      texture.minFilter = texture.magFilter = T.LinearFilter; texture.needsUpdate = true;
      pass.set('uSrc', texture).render(renderer, target);
      const pixels = new Float32Array(dw * dh * 4); renderer.readRenderTargetPixels(target, 0, 0, dw, dh, pixels);
      let maxError = 0, sum = 0;
      const at = (x, y) => data[(Math.max(0, Math.min(sh - 1, y)) * sw + Math.max(0, Math.min(sw - 1, x))) * 4];
      const linear = (x, y) => {
        const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j;
        return at(i,j)*(1-f)*(1-g)+at(i+1,j)*f*(1-g)+at(i,j+1)*(1-f)*g+at(i+1,j+1)*f*g;
      };
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const px = (x + .5) / dw * sw - .5, py = (y + .5) / dh * sh - .5;
        const bx = Math.floor(px), by = Math.floor(py), wx = weights(px - bx), wy = weights(py - by);
        let expected = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
          const sx = Math.max(0, Math.min(sw - 1, bx + i - 1)), sy = Math.max(0, Math.min(sh - 1, by + j - 1));
          expected += data[(sy * sw + sx) * 4] * wx[i] * wy[j];
        }
        // Independent continuous box convolution, including fractional pixel
        // positions. A snapped box gives flat plateaus between source texels.
        let box = 0;
        for (let j = 0; j < interleave; j++) for (let i = 0; i < interleave; i++)
          box += linear(px + i - (interleave - 1) / 2, py + j - (interleave - 1) / 2) / (interleave * interleave);
        expected = expected * (1 - strength) + box * strength;
        const error = Math.abs(pixels[(y * dw + x) * 4] - expected);
        maxError = Math.max(maxError, error); sum += error * error;
      }
      results[`${name}/${interleave}/${strength}`] = { maxError, rmse: Math.sqrt(sum / (dw * dh)) };
      texture.dispose();
    }
    }
    target.dispose(); c.dispose(); renderer.dispose();
    return results;
  });
  await fs.mkdir('tools/shots/cloud-filter', { recursive: true });
  await fs.writeFile('tools/shots/cloud-filter/result.json', JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }));
  assert.deepEqual(errors, []);
  // Hardware bilinear interpolation quantises the fractional coordinate. At
  // a .5-value edge, two axes with 8-bit fractions can contribute ~.004 error.
  // Gate both the worst sample and the field-wide error; the incorrect kernel
  // measured .067 maximum and .016 RMS on this same edge fixture.
  for (const [name, result] of Object.entries(results)) {
    assert.ok(result.maxError < .004, `${name}: reconstruction changes a cloud sample by ${(result.maxError * 100).toFixed(2)}%`);
    assert.ok(result.rmse < .0005, `${name}: reconstruction RMS error is ${result.rmse}`);
  }
} finally { await browser.close(); await vite.close(); }
