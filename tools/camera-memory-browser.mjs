import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/camera-memory'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0`);
  const begin = async () => {
    await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
    await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck'; });
  };
  const wait = (mode, view) => page.waitForFunction(({ mode, view }) => { const g = window.__app.game; return g.lastMode === mode && g.view === view; }, { timeout: 5000 }, { mode, view });
  const press = async (key, mode, view) => {
    const before = await page.evaluate(() => { const g = window.__app.game; return { mode: g.lastMode, view: g.view, disabled: g.$('camera-view').disabled, focus: document.activeElement.id }; });
    await page.keyboard.press(key);
    try { await wait(mode, view); } catch (error) { throw new Error(`${key} -> ${mode}/${view}; before=${JSON.stringify(before)}`, { cause: error }); }
  };
  await begin(); await wait('deck', 'deck');
  await press('c', 'deck', 'chase'); await press('h', 'helm', 'chase'); await press('c', 'helm', 'deck');
  await page.screenshot({ path: `${out}/01-chosen-helm.png` });
  await press('h', 'deck', 'chase'); await press('h', 'helm', 'deck');
  assert.equal(await page.evaluate(() => window.__app.game.deckPitch), -.3, 'Restoring the helm view also restores its instrument-facing pitch');
  await press('Home', 'helm', 'deck'); await press('c', 'helm', 'chase');
  await press('h', 'deck', 'chase'); await press('h', 'helm', 'chase'); await press('c', 'helm', 'deck'); await press('h', 'deck', 'chase');
  const room = await page.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  Object.assign(world.cargo, { attached: true, recovered: false, x: world.ship.x, z: world.ship.z, y: -30 }); world.mission = 'recovery';
  await page.waitForFunction(() => window.__app.game.state.cargo.attached);
  await press('r', 'winch', 'deck'); await press('c', 'winch', 'chase'); await press('r', 'deck', 'chase'); await press('r', 'winch', 'chase');
  assert.equal(await page.evaluate(() => window.__app.game.orbit), 0, 'The restored chase camera does not inherit the winch close-view yaw');
  await page.screenshot({ path: `${out}/02-restored-winch.png` }); await press('r', 'deck', 'chase');
  await press('c', 'deck', 'deck'); await page.keyboard.press('v'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  const beforeDiveToggle = await page.evaluate(() => window.__app.game.settings.values.views);
  await page.keyboard.press('c'); assert.deepEqual(await page.evaluate(() => window.__app.game.settings.values.views), beforeDiveToggle);
  await page.waitForFunction(() => window.__app.game.contextAction() === 'board'); await press('f', 'deck', 'deck');
  await press('c', 'deck', 'chase');
  const chosen = { deck: 'chase', helm: 'deck', winch: 'chase' };
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('abyssal:expedition-settings')).views), chosen);
  await page.reload(); await begin(); await wait('deck', 'chase');
  assert.deepEqual(await page.evaluate(() => window.__app.game.settings.values.views), chosen);
  await press('h', 'helm', 'deck');
  const layouts = [];
  for (const width of [600, 390]) {
    await page.setViewport({ width, height: 800 }); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const pose = await page.evaluate(() => { const g = window.__app.game; return { eye: g.models.ship.worldToLocal(g.app.camera.position.clone()).toArray(), pitch: g.deckPitch, fov: g.app.camera.fov }; });
    await page.screenshot({ path: `${out}/03-restored-helm-${width}.png` });
    // The camera eases behind the ship's wave motion by a few centimetres.
    assert.ok(Math.hypot(pose.eye[0], pose.eye[1] - 3.6, pose.eye[2] - 5.1) < .12, JSON.stringify({ width, ...pose })); assert.equal(pose.pitch, -.3);
    layouts.push({ width, ...pose });
  }
  await page.keyboard.press('j'); await page.waitForSelector('#crew-journal[open]'); await page.keyboard.press('c');
  assert.deepEqual(await page.evaluate(() => window.__app.game.settings.values.views), chosen); await page.keyboard.press('Escape');
  await press('h', 'deck', 'chase'); await press('r', 'winch', 'chase');
  await page.evaluate(() => { window.originalSettingsWrite = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('Storage unavailable', 'QuotaExceededError'); }; });
  await press('c', 'winch', 'deck'); await press('r', 'deck', 'chase'); await press('r', 'winch', 'deck');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSettingsWrite; });
  assert.deepEqual(errors, []);
  const result = { recordedAt: new Date().toISOString(), independentRoles: true, bothHelmChoices: true, winchChoice: true, diveBoarding: true, reload: true, homePreservesChoice: true, modalIsolation: true, storageFailureRetainsSessionChoice: true, layouts, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
