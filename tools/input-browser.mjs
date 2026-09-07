import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/input'; await fs.mkdir(out, { recursive: true });
try {
  const p = await browser.newPage(), errors = [], checks = {};
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await useExpandedTools(p); await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  const identity = await p.evaluate(() => { const n = window.__app.game.net; return { room: n.room, id: n.id }; });
  const world = app.rooms.get(identity.room).world;
  // Start on the clear foredeck to isolate key mapping from cabin collision.
  Object.assign(world.players[identity.id], { deckX: 0, deckZ: 5.5 });
  await p.waitForFunction(() => { const g = window.__app.game; return g.frameWorld.players[g.net.id].deckZ === 5.5; });
  const wait = async (predicate, arg) => { try { await p.waitForFunction(predicate, { timeout: 4000 }, arg); return true; } catch (e) { if (e.name === 'TimeoutError') return false; throw e; } };
  await p.keyboard.down('ArrowRight');
  checks.arrowRightWalks = await wait(() => { const g = window.__app.game; return g.state.players[g.net.id].deckX < -.5; }); await p.keyboard.up('ArrowRight');
  const rightX = await p.evaluate(() => { const g = window.__app.game; return g.state.players[g.net.id].deckX; });
  await p.keyboard.down('ArrowLeft');
  checks.arrowLeftWalks = await wait(x => { const g = window.__app.game; return g.state.players[g.net.id].deckX > x + .5; }, rightX); await p.keyboard.up('ArrowLeft');
  await p.focus('#camera-view'); await p.keyboard.press('Tab'); await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'camera-view');
  const view = await p.evaluate(() => window.__app.game.view); await p.keyboard.press('Space');
  checks.spaceActivatesButton = await wait(view => window.__app.game.view !== view, view);
  checks.spaceNotHeld = await p.evaluate(() => !window.__app.game.keys.has('Space'));
  const next = await p.evaluate(() => window.__app.game.view); await p.keyboard.press('Enter');
  checks.enterActivatesButton = await wait(view => window.__app.game.view !== view, next);
  await p.screenshot({ path: `${out}/01-keyboard-view.png` });
  await p.focus('[data-action="helm"]'); await p.keyboard.press('Space');
  checks.keyboardHelm = await wait(() => window.__app.game.lastMode === 'helm');
  await p.click('[data-action="leaveHelm"]'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  checks.pointerReturnsToGame = await p.evaluate(() => !document.activeElement.matches('button'));
  await p.keyboard.down('Space'); checks.spaceAfterPointer = await p.evaluate(() => window.__app.game.keys.has('Space')); await p.keyboard.up('Space');
  checks.noRepeatedStationAction = await p.evaluate(() => window.__app.game.state.ship.pilot === null);
  await p.click('[data-action="dive"]'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await p.keyboard.down('ControlLeft'); await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].y < -5; }); await p.keyboard.up('ControlLeft');
  await p.waitForFunction(() => { const g = window.__app.game; return !g.keys.has('ControlLeft'); });
  // Wait for the released movement to reach the authoritative server.
  const releaseDeadline = Date.now() + 4000;
  while (world.players[identity.id].input.vertical && Date.now() < releaseDeadline) await new Promise(r => setTimeout(r, 20));
  assert.equal(world.players[identity.id].input.vertical, 0, 'Release stops descending on the server');
  const depth = world.players[identity.id].y;
  await p.focus('#dive-light'); await p.keyboard.down('Space');
  await p.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame); });
  checks.focusedSpaceDoesNotAscend = world.players[identity.id].y === depth;
  checks.focusedSpaceNotMovement = await p.evaluate(() => !window.__app.game.keys.has('Space'));
  await p.keyboard.up('Space'); checks.keyboardDiveLight = await wait(() => window.__app.game.diveLight.mode === 'on');
  checks.keyboardRetainsFocus = await p.evaluate(() => document.activeElement.id === 'dive-light');
  await p.screenshot({ path: `${out}/02-keyboard-dive.png` });
  await p.click('#dive-light'); await p.keyboard.down('Space');
  checks.pointerThenAscend = await wait(depth => { const g = window.__app.game; return g.state.players[g.net.id].y > depth + .8; }, depth); await p.keyboard.up('Space');
  const swimming = { ...world.players[identity.id] }; await p.keyboard.down('ArrowRight');
  checks.diveArrowsTurn = await wait(yaw => window.__app.game.yaw < yaw - .3, swimming.yaw); await p.keyboard.up('ArrowRight');
  checks.diveArrowsDoNotStrafe = world.players[identity.id].x === swimming.x && world.players[identity.id].z === swimming.z;
  await p.click('#game-settings'); await p.waitForFunction(() => window.__app.game.settings.dialog.open);
  await p.keyboard.down('w'); checks.settingsIsolatesMovement = await p.evaluate(() => !window.__app.game.keys.has('KeyW')); await p.keyboard.up('w');
  for (const width of [1280, 600, 390]) {
    await p.setViewport({ width, height: 800 });
    await p.$eval('.control-guide', el => el.scrollIntoView({ block: 'start' }));
    await p.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame); });
    checks[`guideFits${width}`] = await p.$eval('#settings-dialog', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1; });
    await p.screenshot({ path: `${out}/03-guide-${width}.png` });
  }
  await p.click('#close-settings'); await p.waitForFunction(() => !window.__app.game.settings.dialog.open);
  await p.keyboard.down('Space'); checks.pointerCloseReturnsMovement = await p.evaluate(() => window.__app.game.keys.has('Space')); await p.keyboard.up('Space');
  const result = { checks, errors }; console.log(JSON.stringify(result)); await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []); assert.ok(Object.values(checks).every(Boolean), 'All keyboard controls match their advertised behavior');
} finally { await browser.close(); await app.stop(); }
