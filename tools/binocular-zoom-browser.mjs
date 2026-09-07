import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/binocular-zoom'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  const errors = [], cases = [];
  for (const touch of [false, true]) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewport({ width: touch ? 390 : 1280, height: 800, hasTouch: touch });
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
    try { await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 }); }
    catch (error) { console.error(JSON.stringify({ touch, errors, boot: await page.evaluate(() => ({ title: document.title, message: document.getElementById('boot')?.textContent, app: !!window.__app })) })); throw error; }
    await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.lastMode === 'deck' && window.__app.game.net.ready && !document.querySelector('.launch-screen'));
    const activate = async selector => {
      const element = await page.waitForSelector(selector, { visible: true });
      // The notebook scrolls on phones; Puppeteer's tap needs the target in view.
      await element.scrollIntoView();
      return touch ? page.tap(selector) : page.click(selector);
    };
    // Open through the crew notebook, which is available on both input types.
    await activate('#crew-activities'); await activate('#activity-lookout'); await page.waitForSelector('#game.lookout-active');
    const sample = () => page.evaluate(() => { const g = window.__app.game, p = g.state.players[g.net.id]; return { zoom: g.magnification, fov: g.app.camera.fov, yaw: g.orbit, pitch: g.deckPitch, x: p.deckX, z: p.deckZ, mode: p.mode, label: g.$('lookout-zoom').value, outDisabled: g.$('lookout-zoom-out').disabled, inDisabled: g.$('lookout-zoom-in').disabled }; });
    const waitZoom = async zoom => page.waitForFunction(zoom => { const g = window.__app.game, fov = 2 * Math.atan(Math.tan(55 * Math.PI / 360) / zoom) * 180 / Math.PI; return Math.abs(g.magnification - zoom) < 1e-7 && Math.abs(g.app.camera.fov - fov) < .001; }, {}, zoom);
    await waitZoom(3); const before = await sample(); await activate('#lookout-zoom-in'); await waitZoom(3.5); const closer = await sample(); assert.ok(closer.fov < before.fov);
    if (!touch) { await page.focus('#lookout-zoom-in'); await page.keyboard.press('Enter'); } else await activate('#lookout-zoom-in');
    await waitZoom(4);
    for (let i = 0; i < 4; i++) await activate('#lookout-zoom-in'); await waitZoom(6); assert.equal((await sample()).inDisabled, true);
    await activate('#lookout-zoom-in'); assert.equal((await sample()).zoom, 6);
    for (let i = 0; i < 8; i++) await activate('#lookout-zoom-out'); await waitZoom(2); assert.equal((await sample()).outDisabled, true);
    await activate('#lookout-zoom-out'); assert.equal((await sample()).zoom, 2);
    const lower = await sample(); assert.equal(lower.yaw, before.yaw); assert.equal(lower.pitch, before.pitch); assert.equal(lower.x, before.x); assert.equal(lower.z, before.z); assert.equal(lower.mode, 'deck');
    if (!touch) {
      await page.mouse.move(100, 400); await page.mouse.wheel({ deltaY: -250 }); await waitZoom(3);
      for (const [deltaMode, deltaY, zoom] of [[1, -15.625, 4], [2, -.3125, 5]]) {
        await page.evaluate(({ deltaMode, deltaY }) => window.__app.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode, bubbles: true, cancelable: true })), { deltaMode, deltaY }); await waitZoom(zoom);
      }
      const button = await page.$('#lookout-zoom-in'), r = await button.boundingBox();
      await page.mouse.move(r.x + 22, r.y + 22); await page.mouse.down(); await page.mouse.move(100, 400, { steps: 5 }); await page.mouse.up();
      const dragged = await sample(); assert.equal(dragged.yaw, before.yaw); assert.equal(dragged.pitch, before.pitch, 'Dragging from a lens button cannot grab the scene camera');
    }
    const layouts = [];
    for (const width of touch ? [390, 600, 720] : [1280, 600, 390, 720]) {
      const height = width === 720 ? 390 : 800;
      await page.setViewport({ width, height, hasTouch: touch });
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, reticleTop: document.querySelector('.lookout-reticle').getBoundingClientRect().top, buttons: ['lookout-zoom-out', 'lookout-zoom-in'].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { id, visible: e.checkVisibility(), left: r.left, right: r.right, width: r.width, height: r.height, bottom: r.bottom }; }) }));
      assert.ok(!layout.overflow && layout.buttons.every(b => b.visible && b.left >= 0 && b.right <= width && b.width >= 44 && b.height >= 44 && b.bottom < layout.reticleTop)); layouts.push({ width, height, ...layout });
      await page.screenshot({ path: `${out}/${touch ? 'touch' : 'desktop'}-${width}.png` });
    }
    const remembered = (await sample()).zoom;
    await activate('#binoculars'); await page.waitForSelector('#game:not(.lookout-active)'); assert.equal(await page.$eval('#lookout-zoom-in', e => e.checkVisibility()), false);
    await page.evaluate(() => window.__app.game.zoomLookout(.5)); assert.equal((await sample()).zoom, remembered, 'Hidden optics ignore zoom requests');
    await activate('#crew-activities'); await activate('#activity-lookout'); await waitZoom(remembered);
    cases.push({ touch, before, closer, lower, bounds: [2, 6], remembered, layouts }); await context.close();
  }
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), cases, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
