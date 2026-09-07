import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createGameServer } from '../server/index.mjs';

const { server } = createGameServer(); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const vite = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${server.address().port}` } } }); await vite.listen();
const out = 'tools/shots/frame-profile'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1280, height: 800 } });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(vite.resolvedUrls.local[0] + '?mode=expedition&preset=low&adaptive=0');
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready);
  const frame = await p.evaluate(() => window.__app.frame); await p.waitForFunction(n => window.__app.frame > n + 70, {}, frame);
  await p.evaluate(() => {
    const a = window.__app; window.frameCosts = {};
    for (const [name, object, method] of [
      ['frame', a, 'render'], ['game', a.game, 'update'], ['crewUI', a.game, 'updateUI'],
      ['vessels', a.game.models, 'update'], ['waterUpdate', a.underwater, 'update'], ['waterRender', a.underwater, 'render'],
      ['draws', a.renderer, 'render'], ['clouds', a.clouds, 'update'], ['post', a.post, 'render'],
    ]) {
      const original = object[method];
      object[method] = function (...args) { const start = performance.now(); try { return original.apply(this, args); } finally { (window.frameCosts[name] ??= []).push(performance.now() - start); } };
    }
  });
  const cdp = await p.createCDPSession(); await cdp.send('Profiler.enable');
  const results = {};
  for (const enabled of [false, true]) {
    await p.evaluate(enabled => { window.__app.profiler.enabled = enabled; window.frameCosts = {}; }, enabled);
    await cdp.send('Profiler.start');
    const timing = await p.evaluate(async () => {
      for (let i = 0; i < 70; i++) await new Promise(requestAnimationFrame);
      const results = {};
      for (const [name, all] of Object.entries(window.frameCosts)) {
        const values = all.slice(Math.floor(all.length / 7)).sort((a, b) => a - b);
        results[name] = { median: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * .95)], samples: values.length };
      }
      return results;
    });
    const { profile } = await cdp.send('Profiler.stop');
    const nodes = new Map(profile.nodes.map(n => [n.id, n])), times = new Map();
    for (let i = 0; i < profile.samples.length; i++) times.set(profile.samples[i], (times.get(profile.samples[i]) || 0) + profile.timeDeltas[i] / 1000);
    const hottest = [...times].map(([id, ms]) => ({ ms: +ms.toFixed(2), ...nodes.get(id).callFrame })).filter(n => n.functionName !== '(idle)').sort((a, b) => b.ms - a.ms).slice(0, 25);
    results[enabled ? 'gpuProfiling' : 'normal'] = { timing, hottest };
    await fs.writeFile(`${out}/${enabled ? 'profiled' : 'normal'}.cpuprofile`, JSON.stringify(profile));
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ results, errors }, null, 2)); console.log(JSON.stringify({ results, errors }));
} finally { await browser.close(); await vite.close(); server.closeAllConnections(); server.close(); }
