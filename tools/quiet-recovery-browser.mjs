import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/quiet-recovery'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition');
  await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  Object.assign(world.cargo, { attached: true, recovered: false, x: world.ship.x, z: world.ship.z, y: -100 }); world.mission = 'recovery';
  const hidden = () => page.waitForFunction(() => document.getElementById('objective-marker').hidden && window.__app.game.objectiveMarker.bounds === null);
  const shown = () => page.waitForFunction(() => !document.getElementById('objective-marker').hidden);
  const readout = text => page.waitForFunction(text => document.getElementById('play-readout').textContent.includes(text), {}, text);
  const mode = value => page.waitForFunction(value => window.__app.game.lastMode === value, {}, value);
  await readout('operate the winch'); await hidden(); checks.push('Deck recovery stays actionable without a floating zero-metre pin');
  await page.keyboard.press('h'); await mode('helm'); await readout('operate the winch'); await hidden();
  await page.keyboard.press('c'); await page.screenshot({ path: `${out}/01-helm.png` });
  await page.keyboard.press('i'); await shown(); assert.match(await page.$eval('#objective-marker', e => e.textContent), /ARCHIVE RECOVERY/);
  await page.keyboard.press('Escape'); await hidden(); checks.push('Tools restores full recovery guidance');
  await page.keyboard.press('b'); await shown(); await readout('kn');
  await page.keyboard.press('b'); await hidden();
  const cableX = world.cargo.x; world.cargo.x = world.ship.x + 40;
  await shown(); await readout('Anchor set'); world.cargo.x = cableX; await hidden();
  checks.push('Raising the anchor or moving outside cable range restores navigation');
  await page.keyboard.press('h'); await mode('deck'); await readout('Helm');
  checks.push('Nearby equipment keeps its walking prompt');
  await page.keyboard.press('r'); await mode('winch'); await readout('Lifting archive'); await hidden();
  const layouts = [];
  for (const width of [1280, 600, 390]) {
    await page.setViewport({ width, height: 800 }); await hidden();
    await page.screenshot({ path: `${out}/02-winch-${width}.png` });
    const layout = await page.$eval('.ship-console', e => { const r = e.getBoundingClientRect(); const text = document.getElementById('play-readout').getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, readoutLeft: text.left, readoutRight: text.right, overflow: e.scrollWidth > e.clientWidth }; });
    assert.ok(layout.left >= 0 && layout.right <= width && layout.readoutLeft >= 0 && layout.readoutRight <= width && !layout.overflow, JSON.stringify(layout)); layouts.push({ width, ...layout });
  }
  await page.keyboard.press('r'); await mode('deck'); await page.keyboard.press('v'); await mode('diver'); await shown();
  assert.match(await page.$eval('#objective-marker', e => e.textContent), /KESTREL/); checks.push('Divers retain their boarding marker');
  await page.waitForFunction(() => window.__app.game.contextAction() === 'board'); await page.keyboard.press('f'); await mode('deck'); await hidden();
  world.cargo.recovered = true; world.mission = 'return'; await shown();
  assert.match(await page.$eval('#objective-marker', e => e.textContent), /PELICAN/); checks.push('Securing the archive restores the homeward destination');
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), checks, layouts, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
