import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/inscription'; await fs.mkdir(out, { recursive: true });
const errors = [];
async function open(room = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck'); return page;
}
try {
  const a = await open(), room = await a.evaluate(() => window.__app.game.net.room), b = await open(room);
  for (const page of [a, b]) { await page.bringToFront(); await page.click('#crew-activities'); }
  const type = async (page, value) => { await page.bringToFront(); await page.$eval('#crew-inscription', e => e.scrollIntoView({ block: 'center' })); await page.click('#inscription-text'); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.type('#inscription-text', value); };
  await type(b, 'A draft worth keeping');
  await type(a, 'Our ocean home'); await a.click('#save-inscription');
  for (const page of [a, b]) await page.waitForFunction(() => window.__app.game.models.inscription.text === 'Our ocean home');
  assert.equal(await b.$eval('#inscription-text', e => e.value), 'A draft worth keeping');
  assert.equal(await b.$eval('#save-inscription', e => e.disabled), true);
  assert.match(await b.$eval('#inscription-current', e => e.textContent), /Our ocean home/);
  await b.bringToFront(); await b.click('#reload-inscription');
  assert.equal(await b.$eval('#inscription-text', e => e.value), 'Our ocean home');
  await type(b, 'Always bring the crew home'); await b.click('#save-inscription');
  await a.waitForFunction(() => window.__app.game.models.inscription.text === 'Always bring the crew home');
  const geometry = await a.evaluate(() => {
    const m = window.__app.game.models, original = m.inscription.letters, copy = m.waterRoot.getObjectByName('Crew inscription lettering');
    original.geometry.computeBoundingBox();
    return { sameGeometry: original.geometry === copy.geometry, sameMaterial: original.material === copy.material,
      finite: [...original.geometry.attributes.position.array].every(Number.isFinite), width: original.geometry.boundingBox.max.x - original.geometry.boundingBox.min.x,
      vertices: original.geometry.attributes.position.count };
  });
  assert.ok(geometry.sameGeometry && geometry.sameMaterial && geometry.finite && geometry.width <= 2.821 && geometry.vertices > 50, JSON.stringify(geometry));
  await b.setViewport({ width: 390, height: 800 }); await b.$eval('#crew-inscription', e => e.scrollIntoView({ block: 'center' }));
  assert.ok(await b.$eval('#crew-activities-dialog', e => e.scrollWidth <= e.clientWidth));
  await b.screenshot({ path: `${out}/controls-phone.png` });
  await a.reload(); await a.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await a.click('#start-expedition'); await a.waitForFunction(() => window.__app.game.models.inscription.text === 'Always bring the crew home');
  await a.bringToFront();
  await a.evaluate(() => {
    const a = window.__app, g = a.game; a.running = false; a.beforeUpdate = a.afterUpdate = null; g.net.close(); g.root.hidden = true;
    window.plateView = storm => {
      a.weather.set({ sunElevation: storm ? .25 : .55, cloudCoverage: storm ? .98 : .35, storm: storm ? .9 : 0 }, true); a.weather.update(0);
      const ship = g.models.ship, v = (x, y, z) => ship.localToWorld(a.camera.position.clone().set(x, y, z));
      a.camera.position.copy(v(-.45, 3.85, -4.2)); a.camera.lookAt(v(0, 3.85, -.19)); a.camera.fov = 55; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld();
      a.post.reset = a.clouds.reset = true; for (let i = 0; i < 16; i++) a.render(0);
      return a.renderer.getContext().getError();
    };
  });
  for (const storm of [false, true]) { assert.equal(await a.evaluate(s => window.plateView(s), storm), 0); await a.screenshot({ path: `${out}/${storm ? 'storm' : 'day'}.png` }); }
  assert.deepEqual(errors, []);
  console.log('Crew inscription: shared editing, conflict preservation and reload, phone controls, rejoin, matching water geometry, daylight and storm renders passed.');
} finally { await browser.close(); await app.stop(); }
