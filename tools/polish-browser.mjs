import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
const { server } = createGameServer(); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const out = 'tools/shots/polish'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage(), errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /shader.*warning/i.test(m.text())) errors.push(m.text()); });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=expedition&preset=low&adaptive=0&profile=1`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready);
  await sleep(500);
  assert.match(await page.$eval('#controls', e => e.textContent), /walk/);
  await page.keyboard.press('f'); await sleep(500); await page.keyboard.press('f');
  await page.keyboard.down('w'); await sleep(4500); await page.keyboard.down('d'); await sleep(3000); await page.keyboard.up('d'); await page.keyboard.up('w');
  assert.ok(await page.evaluate(() => window.__app.oceanMesh.uniforms.uShipWakeCount.value > 5));
  await page.screenshot({ path: `${out}/01-underway.png` });
  // Freeze a private test world to inspect repeatable weather and dive states.
  await page.evaluate(() => {
    const a = window.__app, g = a.game; g.net.input({}); g.net.close(); a.beforeUpdate = () => {}; a.afterUpdate = () => {};
    window.reviewWorld = structuredClone(g.state);
    const w = window.reviewWorld; w.time = 30; w.ship = { ...w.ship, x: -100, z: 310, y: 0, heading: Math.PI / 2, speed: 8, pitch: 0, roll: 0 };
    g.models.wake.points = []; g.models.wake.lastTime = null;
    for (let t = 16; t <= 30; t += .1) {
      const angle = (t - 16) / 14 * Math.PI / 2;
      g.models.wake.update({ ...w.ship, x: -160 + 60 * (1 - Math.cos(angle)), z: 370 - 60 * Math.sin(angle), heading: Math.PI - angle }, t);
    }
    g.models.update(w, g.net.id, 'chase'); a.time = w.time; a.ocean.time = w.time;
    a.oceanMesh.uniforms.uNavigationSea.value.set(1, w.time, 0);
    document.getElementById('game').style.display = 'none';
  });
  for (const [name, sun, storm, pos] of [
    ['02-wake-day', .55, 0, [-132, 36, 275]], ['03-wake-dusk', .09, 0, [-132, 36, 275]],
    ['04-wake-storm', .3, .85, [-132, 36, 275]], ['05-waterline', .55, 0, [-122, 1.4, 307]],
    ['06-aerial', .55, 0, [-130, 250, 330]], ['07-distant', .55, 0, [-130, 1000, 330]],
  ]) {
    await page.evaluate(({ sun, storm, pos }) => {
      const a = window.__app; a.camera.position.set(...pos); a.camera.lookAt(-120, 0, 325); a.camera.updateMatrixWorld();
      a.weather.set({ sunElevation: sun, sunAzimuth: 2.1, storm, cloudCoverage: .35 + storm * .65, rain: storm * .5, windSpeed: 5 + storm * 18 }, true); a.weather.update(0);
    }, { sun, storm, pos });
    await sleep(1500); await page.screenshot({ path: `${out}/${name}.png` });
  }
  const timing = await page.evaluate(async () => {
    const a = window.__app; a.camera.position.set(-132, 36, 275); a.camera.lookAt(-120, 0, 325); a.camera.updateMatrixWorld();
    const measure = async () => { a.profiler.reset(); const times = []; for (let i = 0; i < 120; i++) { await new Promise(requestAnimationFrame); if (i >= 30) times.push(a.frameMs); } times.sort((a, b) => a - b); return { median: times[45], p95: times[85], passes: a.profiler.report() }; };
    const wake = await measure(), count = a.oceanMesh.uniforms.uShipWakeCount.value; a.oceanMesh.uniforms.uShipWakeCount.value = 0;
    const noWake = await measure(); a.oceanMesh.uniforms.uShipWakeCount.value = count; return { wake, noWake };
  });
  await page.evaluate(() => {
    const a = window.__app, g = a.game, w = window.reviewWorld, p = w.players[g.net.id];
    document.getElementById('game').style.display = ''; w.mission = 'dive'; w.cargo.attached = false; w.cargo.recovered = false;
    p.mode = 'diver'; p.x = w.cargo.x; p.y = w.cargo.y + 9; p.z = w.cargo.z - 16;
    a.camera.position.set(p.x, p.y, p.z); a.camera.lookAt(w.cargo.x, w.cargo.y, w.cargo.z); a.camera.updateMatrixWorld();
    g.state = w; g.updateUI(w); g.models.update(w, g.net.id, 'deck'); g.objectiveMarker.update(w, g.net.id, a.camera, true);
  });
  await sleep(1200); await page.screenshot({ path: `${out}/08-dive-signal.png` });
  assert.match(await page.$eval('#objective-marker', e => e.textContent), /ARCHIVE SIGNAL/);
  await page.evaluate(() => {
    const a = window.__app, g = a.game, w = window.reviewWorld;
    w.cargo.attached = true; w.winch = null; w.ship.x = w.cargo.x; w.ship.z = w.cargo.z; w.ship.anchor = true;
    g.updateUI(w); g.objectiveMarker.update(w, g.net.id, a.camera, true);
  });
  assert.match(await page.$eval('#objective-marker', e => e.textContent), /KESTREL/);
  assert.match(await page.$eval('#salvage-status', e => e.textContent), /operate the winch/);
  await page.screenshot({ path: `${out}/09-return-signal.png` });
  await page.setViewport({ width: 600, height: 800 }); await sleep(300);
  const bounds = await page.evaluate(() => {
    const a = window.__app, g = a.game; g.updateUI(window.reviewWorld); g.objectiveMarker.update(window.reviewWorld, g.net.id, a.camera, true);
    const r = document.getElementById('objective-marker').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= 600 && bounds.top >= 0 && bounds.bottom <= 800, 'offscreen guidance stays visible on a narrow screen');
  await page.screenshot({ path: `${out}/10-narrow.png` });
  assert.deepEqual(errors, []); await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, errors, timing, bounds }, null, 2)); console.log(JSON.stringify({ passed: true, errors, timing, bounds }));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
