import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/touch-stick'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 390, height: 800, hasTouch: true } });
const page = await browser.newPage(), errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.tap('#start-expedition');
  await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  await page.waitForSelector('.touch-controls:not([hidden])');
  const { room, id } = await page.evaluate(() => window.__app.game.net), world = app.rooms.get(room).world, player = world.players[id];
  const cdp = await page.createCDPSession(), fingers = new Map();
  const send = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const down = async (id, x, y) => { fingers.set(id, { id, x, y, radiusX: 6, radiusY: 6 }); await send('touchStart', [fingers.get(id)]); };
  const move = async (id, x, y) => { Object.assign(fingers.get(id), { x, y }); await send('touchMove', [fingers.get(id)]); };
  const up = async id => { await send('touchEnd', [fingers.get(id)]); fingers.delete(id); };
  const center = selector => page.$eval(selector, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const until = async predicate => { for (let i = 0; i < 60; i++) { if (predicate()) return; await sleep(50); } assert.ok(predicate(), 'Authoritative input/state did not arrive'); };
  let stick = await center('#touch-stick');
  const startZ = player.deckZ;
  await down(1, stick.x, stick.y); await move(1, stick.x, stick.y + 17);
  await until(() => player.input.forward < -.2 && player.input.forward > -.8);
  const partial = player.input.forward; await sleep(400);
  assert.ok(player.deckZ < startZ - .2, 'Partial thumb displacement walks on the server');
  const heldCenter = await center('#touch-stick');
  await page.$eval('.ship-console', e => { e.style.paddingTop = '35px'; }); await sleep(200);
  assert.deepEqual(await center('#touch-stick'), heldCenter, 'Changing status layout cannot move a held control');
  await move(1, stick.x, stick.y + 17); await sleep(150);
  assert.ok(Math.abs(player.input.forward - partial) < .001, 'A held gesture retains its original movement after layout changes');
  await move(1, stick.x, stick.y + 80); await until(() => player.input.forward === -1);
  await up(1); await until(() => player.input.forward === 0);
  assert.ok((await center('#touch-stick')).y < heldCenter.y, 'Released controls settle above the resized footer');
  await page.$eval('.ship-console', e => { e.style.paddingTop = ''; }); await sleep(200);
  assert.equal(await page.evaluate(() => window.__app.game.touch.pointer), null);
  await page.screenshot({ path: `${out}/01-deck.png` });

  // A movement thumb and camera finger must retain independent ownership.
  stick = await center('#touch-stick'); await down(1, stick.x, stick.y); await move(1, stick.x, stick.y - 20);
  const orbit = await page.evaluate(() => window.__app.game.orbit);
  await down(2, 290, 390); await move(2, 320, 390);
  await page.waitForFunction(orbit => window.__app.game.orbit !== orbit, {}, orbit);
  assert.ok(Math.abs(await page.evaluate(() => window.__app.game.orbit) - orbit + .12) < .005);
  await down(3, 230, 410); await up(3); await move(2, 340, 400);
  await page.waitForFunction(orbit => Math.abs(window.__app.game.orbit - orbit) > .15, {}, orbit);
  assert.ok(Math.abs(await page.evaluate(() => window.__app.game.orbit) - orbit + .2) < .005, 'An unrelated finger cannot stop or take over camera movement');
  await until(() => player.input.forward > .3);
  const modalOrbit = await page.evaluate(() => window.__app.game.orbit);
  await page.keyboard.press('j'); await page.waitForSelector('#crew-journal[open]');
  await until(() => player.input.forward === 0);
  await move(1, stick.x, stick.y - 40); await up(1); await page.keyboard.press('Escape');
  await page.waitForSelector('.touch-controls:not([hidden])'); await sleep(200);
  assert.equal(player.input.forward, 0, 'Closing a notebook does not resume an old drag');
  await move(2, 350, 410); await up(2); await sleep(150);
  assert.equal(await page.evaluate(() => window.__app.game.orbit), modalOrbit, 'Closing a notebook does not resume the old camera finger');

  // Scouting has the same walking freedom as keyboard play.
  await page.keyboard.press('Home');
  stick = await center('#touch-stick'); await down(1, stick.x, stick.y); await move(1, stick.x, stick.y - 20);
  await until(() => player.input.forward > .3);
  await page.keyboard.press('l'); await page.waitForSelector('#game.lookout-active');
  assert.ok(await page.$eval('#touch-stick', e => e.checkVisibility()), 'A touch lookout can still walk the deck');
  await until(() => player.input.forward === 0); await up(1);
  stick = await center('#touch-stick'); const lookoutStart = { x: player.deckX, z: player.deckZ };
  await down(1, stick.x, stick.y); await move(1, stick.x, stick.y - 20);
  await until(() => Math.hypot(player.deckX - lookoutStart.x, player.deckZ - lookoutStart.z) > .15);
  const lookoutYaw = await page.evaluate(() => window.__app.game.orbit);
  await down(2, 290, 390); await move(2, 320, 390);
  await page.waitForFunction(yaw => Math.abs(window.__app.game.orbit - yaw + .04) < .005, {}, lookoutYaw);
  const zoom = await center('#lookout-zoom-in'); await down(3, zoom.x, zoom.y); await up(3);
  await page.waitForFunction(() => window.__app.game.magnification === 3.5);
  assert.ok(player.input.forward > .3, 'Adjusting binocular zoom does not take the movement thumb');
  await down(3, zoom.x, zoom.y); await move(3, zoom.x - 80, zoom.y + 80); await up(3); await sleep(150);
  assert.equal(await page.evaluate(() => window.__app.game.magnification), 3.5, 'Dragging away cancels a secondary-finger button activation');
  await move(2, 150, 450);
  const mark = await center('#mark-location'); await down(3, mark.x, mark.y); await up(3);
  await until(() => !!world.signals[id]); assert.ok(player.input.forward > .3, 'A lookout can mark a view without releasing the movement thumb');
  await up(2);
  const lower = await center('#binoculars'); await down(3, lower.x, lower.y); await up(3);
  await page.waitForSelector('#game:not(.lookout-active)'); await until(() => player.input.forward === 0);
  await move(1, stick.x, stick.y - 30); await up(1); await sleep(150);
  assert.equal(player.input.forward, 0, 'Lowering binoculars releases the old walking gesture');
  await page.keyboard.press('l');
  const lookoutLayouts = [];
  for (const [width, height] of [[390, 800], [600, 800], [720, 390]]) {
    await page.setViewport({ width, height, hasTouch: true }); await sleep(250);
    const layout = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return { stick: rect('#touch-stick'), reticle: rect('.lookout-reticle'), footer: rect('.ship-console'), visible: document.querySelector('#touch-stick').checkVisibility() };
    });
    const { stick: s, reticle: r, footer: f } = layout;
    assert.ok(layout.visible && s.left >= 0 && s.right <= width && s.top >= 0 && s.bottom < f.top && (s.right < r.left || s.left > r.right || s.top > r.bottom || s.bottom < r.top), 'Scouting stick fits clear of the reticle and footer');
    lookoutLayouts.push({ width, height, ...layout }); await page.screenshot({ path: `${out}/lookout-${width}.png` });
  }
  await page.keyboard.press('l'); await page.setViewport({ width: 390, height: 800, hasTouch: true }); await sleep(250);

  // Native station changes use the same stick for proportional throttle/rudder.
  await page.keyboard.press('Home'); await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm');
  assert.equal(await page.$eval('#touch-stick-label', e => e.textContent), 'Throttle · steer');
  await page.keyboard.press('b'); await until(() => !world.ship.anchor);
  await page.waitForFunction(() => { const text = document.getElementById('play-readout').textContent; return text.includes('kn') && !text.includes('Anchor set'); });
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  stick = await center('#touch-stick'); const heading = world.ship.heading;
  await down(1, stick.x, stick.y); await move(1, stick.x + 24, stick.y - 24);
  await until(() => player.input.forward > .5 && player.input.turn > .5);
  await sleep(700); assert.ok(world.ship.speed > .3 && world.ship.heading < heading, 'The stick drives and steers the actual ship');
  await page.screenshot({ path: `${out}/02-helm.png` }); await up(1); await until(() => player.input.forward === 0 && player.input.turn === 0);
  await page.keyboard.press('b'); await until(() => Math.abs(world.ship.speed) < 2);
  stick = await center('#touch-stick'); await down(1, stick.x, stick.y); await move(1, stick.x, stick.y - 25);
  await page.keyboard.press('v'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await up(1); await until(() => player.input.forward === 0);
  assert.equal(await page.$eval('#touch-stick-label', e => e.textContent), 'Swim');
  const depth = await center('[data-depth="-1"]'); stick = await center('#touch-stick');
  await down(1, stick.x, stick.y); await move(1, stick.x, stick.y - 25); await down(2, depth.x, depth.y);
  const y = player.y; await until(() => player.input.forward > .5 && player.input.vertical === -1); await sleep(450);
  assert.ok(player.y < y - 1, 'A second thumb can descend while swimming');
  await up(2); await until(() => player.input.vertical === 0 && player.input.forward > .5);
  await send('touchCancel'); fingers.clear(); await until(() => player.input.forward === 0 && player.input.vertical === 0);
  await page.screenshot({ path: `${out}/03-diver.png` });
  // Equipment remains usable by a second finger while the diver swims.
  await page.keyboard.press('o'); await page.waitForSelector('#crew-naturalist:not([hidden])');
  stick = await center('#touch-stick'); await down(1, stick.x, stick.y); await move(1, stick.x, stick.y - 20);
  await until(() => player.input.forward > .3);
  const secondaryTap = async selector => { const point = await center(selector); await down(2, point.x, point.y); await up(2); };
  await secondaryTap('#study-zoom-in');
  await page.waitForFunction(() => window.__app.game.naturalist.lens.value === 1.5, { timeout: 3000 });
  assert.ok(player.input.forward > .3, 'Adjusting the study lens preserves swimming');
  await secondaryTap('#study-zoom-reset');
  await page.waitForFunction(() => window.__app.game.naturalist.lens.value === 1, { timeout: 3000 });
  await secondaryTap('#toggle-study-notes');
  assert.equal(await page.$eval('#study-notes', e => e.hidden), false);
  await secondaryTap('#toggle-study-notes');
  await secondaryTap('#open-crew-journal'); await page.waitForSelector('#crew-journal[open]', { timeout: 3000 });
  await until(() => player.input.forward === 0);
  assert.equal(await page.evaluate(() => window.__app.game.touch.pointer), null, 'Opening the journal releases the swimming thumb');
  await up(1); await page.tap('#close-crew-journal');
  await page.tap('#close-naturalist');
  const layouts = [];
  for (const width of [390, 600]) {
    await page.setViewport({ width, height: 800, hasTouch: true }); await sleep(250);
    const layout = await page.evaluate(() => {
      const controls = document.querySelector('.touch-controls').getBoundingClientRect(), footer = document.querySelector('.ship-console').getBoundingClientRect();
      return { left: controls.left, right: controls.right, top: controls.top, bottom: controls.bottom, footerTop: footer.top };
    });
    assert.ok(layout.left >= 0 && layout.right <= width && layout.top > 400 && layout.bottom < layout.footerTop, 'Thumb controls fit below the central view and above the footer');
    layouts.push({ width, ...layout });
  }
  await page.keyboard.press('i'); await sleep(250);
  assert.ok(await page.$eval('#touch-stick', e => e.checkVisibility()), 'Expanded tools retain movement');
  await page.screenshot({ path: `${out}/04-expanded.png` });
  assert.deepEqual(errors, []);
  const result = { recordedAt: new Date().toISOString(), partial, nativeWalking: true, independentCameraFinger: true, modalReset: true, lookoutWalking: true, lookoutZoomWhileWalking: true, secondaryDragCancellation: true, markWhileWalking: true, opticsTransitionReset: true, lookoutLayouts, helmControl: true, stationReset: true, simultaneousDepth: true, studyWhileSwimming: true, studyJournalReleasesThumb: true, cancellation: true, layouts, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  console.error('Touch flow failure', JSON.stringify(await page.evaluate(() => { const g = window.__app?.game; return { mode: g?.lastMode, dialog: g?.dialogOpen(), touch: g?.touch && { x: g.touch.x, forward: g.touch.forward, vertical: g.touch.vertical, pointer: g.touch.pointer } }; }).catch(() => null)));
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {}); throw error;
} finally { await browser.close(); await app.stop(); }
