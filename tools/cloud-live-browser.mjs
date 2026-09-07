import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
const { server } = createGameServer(); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const out = 'tools/shots/cloud-live'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1280, height: 800 } });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`http://127.0.0.1:${server.address().port}/?mode=expedition&preset=low&adaptive=0&profile=1`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready);
  const samples = [];
  for (const [name, frames] of [['01-arrival', 16], ['02-settled', 80]]) {
    const frame = await p.evaluate(() => window.__app.frame);
    await p.waitForFunction(frame => window.__app.frame >= frame, { timeout: 30000 }, frame + frames);
    samples.push(await p.evaluate(() => { const a = window.__app, c = a.clouds.shared; return { frame: a.frame, time: a.time, cloudTop: c.uCloudTop.value, aspect: c.uCloudAspect.value }; }));
    await p.screenshot({ path: `${out}/${name}.png` });
  }
  await p.keyboard.down('w'); await new Promise(r => setTimeout(r, 3400)); await p.keyboard.up('w');
  await p.keyboard.down('d'); await new Promise(r => setTimeout(r, 700)); await p.keyboard.up('d');
  await p.keyboard.press('l'); await p.waitForFunction(() => window.__app.game.lookout);
  const opticsFrame = await p.evaluate(() => window.__app.frame);
  await p.waitForFunction(frame => window.__app.frame > frame + 20, {}, opticsFrame);
  await p.screenshot({ path: `${out}/03-binoculars.png` });
  const budgets = [];
  await p.keyboard.press('Escape');
  for (const [preset, steps, slots] of [['medium', 96, 16], ['high', 96, 4], ['low', 80, 16]]) {
    await p.keyboard.press('i'); await p.click('#game-settings'); await p.select('#graphics-quality', preset); await p.click('#close-settings'); await p.keyboard.press('Escape');
    const frame = await p.evaluate(() => window.__app.frame); await p.waitForFunction(frame => window.__app.frame > frame + 32, {}, frame);
    const budget = await p.evaluate(() => { const a = window.__app, c = a.clouds; return { preset: a.quality.presetName, steps: c.marchPass.uniforms.uSteps.value, slots: c.activeSlots.length, freshFraction: c.quarterRT.width * c.quarterRT.height / (c.lowW * c.lowH) }; });
    assert.deepEqual(budget, { preset, steps, slots, freshFraction: 1 / slots }); budgets.push(budget);
    await p.screenshot({ path: `${out}/04-${preset}.png` });
  }
  const timing = await p.evaluate(async () => {
    const a = window.__app, values = [], cpu = [], render = a.render.bind(a);
    a.render = dt => { const start = performance.now(); render(dt); cpu.push(performance.now() - start); };
    a.profiler.reset(); for (let n = 0; n < 100; n++) { await new Promise(requestAnimationFrame); if (n >= 20) values.push(a.frameMs); }
    values.sort((x, y) => x - y); const costs = cpu.slice(20).sort((x, y) => x - y), passes = a.profiler.report();
    // An empty RAF baseline distinguishes browser scheduling from game work.
    a.running = false; await new Promise(requestAnimationFrame); const empty = []; let last = performance.now();
    for (let n = 0; n < 30; n++) { await new Promise(requestAnimationFrame); const now = performance.now(); empty.push(now - last); last = now; }
    empty.sort((x, y) => x - y);
    return { median: values[40], p95: values[76], renderCpuMedian: costs[Math.floor(costs.length / 2)], emptyRafMedian: empty[15], passes };
  });
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), samples, budgets, timing, errors }; await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
