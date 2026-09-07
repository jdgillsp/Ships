import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/anchor-feedback'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [], checks = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.lastMode === 'deck' && !document.querySelector('.launch-screen'));
  const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm'); await page.keyboard.press('c');
  const read = () => page.evaluate(() => { const g = window.__app.game; return { state: g.$('anchor-state').textContent, helm: g.$('helm-feedback').textContent, quiet: g.$('play-readout').textContent, message: g.$('game-message').textContent, hint: g.$('pilot-hint').textContent, drop: g.state.ship.anchorDrop }; });
  const settled = async state => page.waitForFunction(state => { const g = window.__app.game; return g.state.ship.anchorDrop === (state === 'Holding' ? 1 : 0) && g.$('anchor-state').textContent === state; }, {}, state);
  await settled('Holding');
  await page.keyboard.press('b'); await page.waitForFunction(() => { const s = window.__app.game.state.ship; return !s.anchor && s.anchorDrop < .9 && s.anchorDrop > 0; });
  const raising = await read(); assert.equal(raising.state, 'Raising…'); assert.match(raising.helm, /^Raising anchor/); assert.match(raising.quiet, /Raising anchor/); assert.equal(raising.message, '', 'The quiet helm readout carries anchor motion without a duplicate toast');
  await page.keyboard.press('b'); await page.waitForFunction(() => { const g = window.__app.game; return g.state.ship.anchor && g.$('anchor-state').textContent === 'Lowering…'; });
  const lowering = await read(); assert.match(lowering.quiet, /Lowering anchor/); assert.equal(lowering.message, '');
  await page.evaluate(() => { const g = window.__app.game; g.message = 'Connection interrupted'; g.messageUntil = performance.now() + 1000; g.updateUI(g.state); });
  assert.equal((await read()).message, 'Connection interrupted', 'An action error is never hidden by status deduplication');
  await page.evaluate(() => { const g = window.__app.game; g.message = ''; });
  await settled('Holding'); assert.match((await read()).quiet, /Anchor set/); checks.push('Native raising, reversal, lowering and holding match the shared gear');
  world.ship.speed = 2;
  await page.waitForFunction(() => document.getElementById('anchor-state').textContent === 'Setting…');
  const settling = await read(); assert.match(settling.helm, /^Anchor setting/); assert.match(settling.quiet, /Anchor setting/); assert.match(settling.hint, /^Anchor setting/);
  await settled('Holding'); checks.push('A deployed anchor reports settling until the cutter slows');
  await page.keyboard.press('b'); await settled('Raised'); assert.doesNotMatch((await read()).quiet, /anchor/i); assert.equal((await read()).message, 'Anchor raised. The helm is ready.'); checks.push('Fully raised anchor leaves no persistent anchor readout in quiet play');
  await page.keyboard.press('i'); await page.keyboard.press('b'); await page.waitForFunction(() => document.getElementById('anchor-state').textContent === 'Lowering…');
  assert.match((await read()).helm, /^Lowering anchor/); assert.equal((await read()).message, 'Lowering anchor…'); await settled('Holding'); checks.push('Expanded instruments use the same state');
  const layouts = [];
  // Hold one intermediate authoritative pose only for layout inspection;
  // native input above covers the real four-second transition and reversal.
  const timer = setInterval(() => { world.ship.anchor = false; world.ship.anchorDrop = .5; world.log = 'Anchor raised. The helm is ready.'; }, 10);
  try {
    await page.keyboard.press('i');
    for (const width of [1280, 600, 390]) {
      await page.setViewport({ width, height: 800 }); await page.waitForFunction(() => document.getElementById('play-readout').textContent.includes('Raising anchor'));
      const layout = await page.evaluate(() => { const e = document.getElementById('play-readout'), r = e.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }; });
      assert.ok(layout.left >= 0 && layout.right <= width && !layout.overflow); layouts.push(layout); await page.screenshot({ path: `${out}/raising-${width}.png` });
    }
  } finally { clearInterval(timer); }
  await settled('Raised');
  await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await page.keyboard.press('b'); await page.waitForFunction(() => document.getElementById('game-message').textContent === 'Lowering anchor…');
  checks.push('Anchor notifications remain available away from the helm');
  await page.keyboard.press('v'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  // The full, always-present control reference must not retain the former aliases.
  const controls = await page.$eval('#controls', e => e.textContent); assert.match(controls, /Ctrl down \/ Space up/); assert.doesNotMatch(controls, /E ascend|Q descend/);
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), raising, lowering, settling, checks, layouts, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
