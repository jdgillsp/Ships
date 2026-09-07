import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/compact-interface'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const measure = () => p.evaluate(() => {
  const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const mission = rect('.mission-panel'), nav = rect('.nav-panel'), console = rect('.ship-console');
  return { mission, nav, console, area: [mission, nav, console].reduce((n, r) => n + r.width * r.height, 0) };
});
try {
  await p.evaluateOnNewDocument(() => { if (!localStorage.getItem('abyssal:expedition-settings')) localStorage.setItem('abyssal:expedition-settings', JSON.stringify({ immersive: false })); });
  await p.goto(`${base}/?mode=expedition&preset=low&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  const full = await measure(); await p.screenshot({ path: `${out}/01-full.png` });
  await p.keyboard.press('i'); await p.waitForSelector('#game.compact-interface'); await sleep(200);
  const compact = await measure(); assert.ok(compact.area < full.area * .8, 'Compact mode substantially reduces panel coverage');
  assert.ok(compact.console.height < full.console.height - 15);
  assert.equal(await p.$eval('#sea-chart', e => getComputedStyle(e).display), 'none');
  await p.keyboard.press('h'); await p.waitForFunction(() => window.__app.game.lastMode === 'helm');
  await p.screenshot({ path: `${out}/02-compact-helm.png` });
  await p.keyboard.press('i'); await p.waitForSelector('#game:not(.compact-interface)');
  assert.equal(await p.evaluate(() => window.__app.game.lastMode), 'helm', 'Interface changes preserve the occupied station');
  await p.click('#game-settings'); await p.waitForSelector('#settings-dialog[open]');
  await p.keyboard.press('i'); assert.equal(await p.evaluate(() => window.__app.game.settings.values.interface), 'full', 'I cannot change presentation behind a dialog');
  await p.select('#interface-density', 'compact'); await p.click('#close-settings');
  await p.keyboard.press('n'); await p.waitForSelector('#voyage-chart[open]');
  assert.ok(await p.$eval('#voyage-map', e => e.getBoundingClientRect().width > 200), 'Full navigation remains available');
  await p.select('#voyage-destination', 'reef'); await p.click('#plot-course'); await p.waitForSelector('#voyage-chart:not([open])');
  await p.keyboard.press('h'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await p.keyboard.press('v'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver');
  const room = await p.evaluate(() => window.__app.game.net.room);
  const post = async (path, body, token) => { const response = await fetch(`${base}/api/rooms/${room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); assert.equal(response.status, 200); return response.json(); };
  const peer = await post('join', { name: 'Rowan' });
  await post('action', { action: 'crewCall', kind: 'ready' }, peer.token);
  await p.waitForSelector('#crew-call-banner:not([hidden])');
  const layouts = [];
  for (const width of [1440, 600, 390]) {
    await p.setViewport({ width, height: width === 1440 ? 900 : 800, hasTouch: width === 390 }); await sleep(250);
    if (width === 390) {
      // Chromium reloads when touch emulation changes. Resume the same diver
      // before checking the layout with actual coarse-pointer controls.
      await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
      await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'diver');
      await post('join', { token: peer.token }); await post('action', { action: 'crewCall', kind: 'ready' }, peer.token);
      await p.waitForSelector('#crew-call-banner:not([hidden])');
    }
    const layout = await measure(); layouts.push({ width, ...layout });
    assert.ok(layout.mission.bottom < layout.console.top && layout.nav.bottom < layout.console.top, 'Progress and navigation leave a clear swimming view');
    assert.ok(layout.console.left >= 0 && layout.console.right <= width && layout.console.bottom <= (width === 1440 ? 900 : 800));
    assert.ok(await p.$eval('#game-message', e => !e.textContent || e.getBoundingClientRect().bottom <= document.querySelector('.mission-panel').getBoundingClientRect().top), 'Temporary messages leave the mission heading readable');
    for (const selector of ['#crew-activities', '#ack-crew-call', '#survey-site', '#game-settings']) assert.ok(await p.$eval(selector, e => e.getBoundingClientRect().width > 0), `${selector} stays accessible`);
    await p.screenshot({ path: `${out}/03-survey-call-${width}.png` });
    if (width === 390) assert.ok(await p.$eval('.touch-controls', e => e.getBoundingClientRect().height > 0), 'Compact mode retains touch movement controls');
  }
  await p.click('#ack-crew-call'); await p.waitForFunction(() => document.getElementById('crew-call-banner').textContent.includes('On it'));
  await p.click('#crew-activities'); await p.waitForSelector('#crew-activities-dialog[open]'); await p.keyboard.press('Escape');
  await p.reload(); await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  assert.equal(await p.evaluate(() => window.__app.game.settings.values.interface), 'compact');
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready);
  await p.keyboard.press('i'); await p.waitForSelector('#game:not(.compact-interface)');
  assert.notEqual(await p.$eval('#sea-chart', e => getComputedStyle(e).display), 'none');
  assert.deepEqual(errors, []);
  const result = { full, compact, layouts, checks: ['station preserved', 'settings and keyboard toggle', 'dialog isolation', 'full chart available', 'survey and crew calls accessible', 'preferences restored'], errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
