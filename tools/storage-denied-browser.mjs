import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kestrel-storage-'));
const app = createGameServer(undefined, { dataDir: directory }); await app.ready;
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/storage-denied'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const results = [];
  for (const mode of ['session-write', 'unavailable']) {
    const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluateOnNewDocument(mode => {
      if (mode === 'unavailable') for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException('Storage is unavailable', 'SecurityError'); } });
      else { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, ...args) { if (key.startsWith('kestrel:')) throw new DOMException('Storage quota is unavailable', 'QuotaExceededError'); return original.call(this, key, ...args); }; }
    }, mode);
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
    await page.waitForFunction(() => window.__app?.running || document.getElementById('booterr')?.textContent, { timeout: 120000 });
    assert.equal(await page.evaluate(() => !!window.__app?.running), true, 'Denied storage must not break boot');
    await page.waitForSelector('#boot', { hidden: true }); await page.click('#start-expedition');
    await page.waitForFunction(() => window.__app.game.started || !document.getElementById('start-expedition').disabled);
    const joined = await page.evaluate(() => ({ started: window.__app.game.started, status: document.getElementById('launch-status')?.textContent }));
    console.log(JSON.stringify({ mode, joined, admittedPlayers: [...app.rooms.values()].reduce((sum, r) => sum + Object.keys(r.world.players).length, 0) }));
    assert.equal(joined.started, true, 'A storage failure after admission must not strand a crew slot');
    await page.waitForFunction(() => window.__app.game.net.ready);
    const identity = await page.evaluate(() => { const g = window.__app.game; return { room: g.net.room, id: g.net.id }; }), world = app.rooms.get(identity.room).world;
    await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm');
    await page.evaluate(() => window.__app.game.net.close());
    await page.waitForSelector('#connection-recovery:not([hidden])'); await page.click('#retry-connection');
    await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck');
    assert.equal(await page.evaluate(() => window.__app.game.net.id), identity.id);
    assert.equal(Object.keys(world.players).length, 1, 'Retry reuses in-memory credentials instead of creating another crewmate');
    await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm');
    await page.keyboard.press('i'); await page.click('#game-settings'); await page.waitForSelector('#settings-dialog[open]');
    assert.equal(await page.evaluate(() => window.__app.game.state.persistence.enabled), true);
    if (mode === 'unavailable') {
      await page.waitForFunction(() => document.getElementById('expedition-save-status').textContent.includes('cannot remember a voyage shortcut'));
      await page.click('#save-expedition');
      assert.match(await page.$eval('#expedition-save-status', e => e.textContent), /could not store your resume entry/);
      assert.equal(world.ship.pilot, identity.id, 'A failed save-and-leave retains the active crew');
    }
    await page.screenshot({ path: `${out}/${mode}.png` });
    await page.keyboard.press('Escape');
    let forwardedOldToken;
    page.on('request', request => { if (request.url().endsWith('/join')) forwardedOldToken = !!JSON.parse(request.postData()).token; });
    await page.evaluate(() => window.__app.game.net.join(null, 'New voyage'));
    await page.waitForFunction(() => window.__app.game.net.ready);
    assert.equal(forwardedOldToken, false, 'Changing rooms must not forward the old room credential');
    assert.notEqual(await page.evaluate(() => window.__app.game.net.id), identity.id);
    assert.deepEqual(errors, []); results.push({ mode, joined: true, retryKeepsIdentity: true, crewSlots: Object.keys(world.players).length, freshRoomIdentity: true, errors });
    await context.close();
  }
  const result = { recordedAt: new Date().toISOString(), results };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  await browser.close(); await app.stop();
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'kestrel-storage-'));
  await fs.rm(directory, { recursive: true, force: true });
}
