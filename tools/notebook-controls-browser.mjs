import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/notebook-controls'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errors = [], checks = [];
try {
  for (const touch of [false, true]) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const width = touch ? 390 : 1280; await page.setViewport({ width, height: 800, hasTouch: touch, isMobile: touch });
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
    await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
    await page.click('#start-expedition');
    await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
    const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
    const read = async (role, title) => {
      await page.click('#crew-activities'); await page.waitForSelector('#crew-activities-dialog[open]');
      assert.match(await page.$eval('#activity-controls summary', e => e.textContent), new RegExp(title));
      if (!(await page.$eval('#activity-controls', e => e.open))) {
        if (touch) await page.tap('#activity-controls summary');
        else { await page.focus('#activity-controls summary'); await page.keyboard.press('Space'); }
      }
      await page.waitForSelector('#activity-controls[open]');
      const before = await page.evaluate(() => { const g = window.__app.game; return { mode: g.lastMode, view: g.view }; });
      await page.keyboard.press('h'); await page.keyboard.press('v'); await page.keyboard.press('c');
      assert.deepEqual(await page.evaluate(() => { const g = window.__app.game; return { mode: g.lastMode, view: g.view }; }), before);
      assert.equal(await page.evaluate(() => window.__app.game.keys.size), 0);
      const content = await page.$eval('#activity-controls', e => e.textContent);
      if (touch) { assert.match(content, /Activities \/ Tools/); assert.doesNotMatch(content, /WASD|Space \/ Ctrl|C \/ Home/); }
      else if (role === 'helm') { assert.match(content, /Release to coast/); assert.match(content, /looking around does not steer/); }
      else if (role === 'diver') assert.match(content, /Space \/ Ctrl/);
      await page.$eval('#crew-activities-dialog', e => { e.scrollTop = 0; });
      const layout = await page.$eval('#activity-controls', e => { const r = e.getBoundingClientRect(), d = e.closest('dialog'); return { left: r.left, right: r.right, overflow: d.scrollWidth > d.clientWidth }; });
      assert.ok(layout.left >= 0 && layout.right <= width && !layout.overflow, JSON.stringify(layout));
      await page.screenshot({ path: `${out}/${touch ? 'touch' : 'keyboard'}-${role}.png` });
      if (touch) await page.tap('#close-activities'); else await page.keyboard.press('Escape');
      await page.waitForSelector('#crew-activities-dialog:not([open])');
      checks.push({ touch, role, ...layout });
    };
    const mode = value => page.waitForFunction(value => window.__app.game.lastMode === value, {}, value);
    await read('deck', 'Moving around the deck');
    await page.keyboard.press('h'); await mode('helm'); await read('helm', 'Steering Kestrel');
    await page.keyboard.press('h'); await mode('deck');
    Object.assign(world.cargo, { attached: true, x: world.ship.x, z: world.ship.z, y: -100 }); world.mission = 'recovery';
    await page.waitForFunction(() => window.__app.game.state.cargo.attached); await page.keyboard.press('r'); await mode('winch'); await read('winch', 'Working the winch');
    await page.keyboard.press('r'); await mode('deck'); await page.keyboard.press('v'); await mode('diver'); await read('diver', 'Swimming');
    await context.close();
  }
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), checks, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
