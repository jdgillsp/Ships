import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/deck-logbook'; await fs.mkdir(out, { recursive: true });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await page.keyboard.down('d');
  await page.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].deckX < 1.75; });
  await page.keyboard.up('d'); await page.keyboard.down('w');
  await page.waitForSelector('#deck-logbook:not([hidden]):enabled'); await page.keyboard.up('w');
  await page.screenshot({ path: `${out}/approach.png` });
  const before = await page.evaluate(() => { const g = window.__app.game; return { mode: g.lastMode, anchor: g.state.ship.anchor, pilot: g.state.ship.pilot }; });
  await page.keyboard.press('f'); await page.waitForSelector('#crew-activities-dialog[open] #voyage-log[open]');
  assert.ok(await page.$eval('#voyage-log summary', e => e === document.activeElement));
  await page.keyboard.press('b'); await page.keyboard.press('v'); await page.keyboard.press('h');
  assert.deepEqual(await page.evaluate(() => { const g = window.__app.game; return { mode: g.lastMode, anchor: g.state.ship.anchor, pilot: g.state.ship.pilot }; }), before);
  const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  world.surveys.reef = { seconds: 8, completedAt: world.time, contributors: [{ id: 'historic-crew', name: 'Rowan' }], active: 0 };
  await page.waitForFunction(() => document.querySelector('#voyage-log ol').textContent.includes('Rowan'));
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 800 }); await page.$eval('#voyage-log', e => e.scrollIntoView({ block: 'center' }));
    assert.ok(await page.$eval('#crew-activities-dialog', e => e.scrollWidth <= e.clientWidth));
    await page.screenshot({ path: `${out}/log-${width}.png` });
  }
  await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement.id === 'deck-logbook');
  await page.click('#deck-logbook'); await page.waitForSelector('#crew-activities-dialog[open] #voyage-log[open]');
  await page.keyboard.press('Escape'); await page.waitForSelector('#crew-activities-dialog:not([open])');
  await page.keyboard.down('s'); await page.waitForSelector('#deck-logbook[hidden]'); await page.keyboard.up('s');
  await page.setViewport({ width: 1280, height: 800 });
  const geometry = await page.evaluate(() => {
    const g = window.__app.game, book = g.models.ship.getObjectByName('Ship logbook');
    const copy = g.models.waterRoot.getObjectByName('Ship logbook');
    let vertices = 0, finite = true;
    // Static equipment is baked into ship-local material batches. Its named
    // anchor remains, while the rendered vertices live on the cutter itself.
    for (const o of g.models.ship.children) if (o.isMesh) {
      const p = o.geometry.attributes.position; finite &&= [...p.array].every(Number.isFinite);
      for (let i = 0; i < p.count; i++) if (p.getX(i) > 1.25 && p.getX(i) < 2.05 && p.getY(i) > 2.6 && p.getY(i) < 3.4 && p.getZ(i) < -.25 && p.getZ(i) > -.4) vertices++;
    }
    return { vertices, finite, anchor: !!book, waterCopy: !!copy };
  });
  assert.ok(geometry.vertices > 100 && geometry.finite && geometry.anchor && geometry.waterCopy, JSON.stringify(geometry));
  await page.evaluate(() => {
    const a = window.__app, g = a.game; a.running = false; a.beforeUpdate = a.afterUpdate = null; g.net.close(); g.root.hidden = true;
    window.logbookView = storm => {
      a.weather.set({ sunElevation: storm ? .25 : .55, cloudCoverage: storm ? .98 : .35, storm: storm ? .9 : 0 }, true); a.weather.update(0);
      const ship = g.models.ship, v = (x, y, z) => ship.localToWorld(a.camera.position.clone().set(x, y, z));
      a.camera.position.copy(v(1.65, 3.3, -1.6)); a.camera.lookAt(v(1.65, 3, -.18)); a.camera.fov = 55; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld();
      a.post.reset = a.clouds.reset = true; for (let i = 0; i < 12; i++) a.render(0);
      return a.renderer.getContext().getError();
    };
  });
  for (const storm of [false, true]) { assert.equal(await page.evaluate(s => window.logbookView(s), storm), 0); await page.screenshot({ path: `${out}/${storm ? 'storm' : 'day'}.png` }); }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ nativeWalking: true, keyboardAndPointer: true, modalIsolation: true, focusReturn: true, sharedHistory: true, geometry, errors }));
} finally { await browser.close(); await app.stop(); }
