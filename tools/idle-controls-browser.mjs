import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/idle-controls';
await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], checks = [];
p.on('pageerror', e => errors.push(e.message));
const boot = async () => {
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition');
  await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  if (await p.$('#first-use-help:not([hidden])')) await p.click('#first-use-help button');
  await p.mouse.click(700, 400);
};
const idle = async () => {
  try { await p.waitForFunction(() => getComputedStyle(document.querySelector('.context-row')).opacity === '0', { timeout: 12000 }); }
  catch (error) {
    console.log(await p.evaluate(() => { const g = window.__app.game; return { focus: document.activeElement?.id, hover: g.hud.hovered, keys: [...g.keys], dialog: g.dialogOpen(), elapsed: performance.now() - g.hud.lastActivity, context: g.hud.context, ready: g.net.ready }; }));
    throw error;
  }
};
const shown = () => p.$eval('.context-row', e => getComputedStyle(e).opacity === '1');
const wait = ms => new Promise(r => setTimeout(r, ms));
// The first fade uses real elapsed time. Policy branches age only the idle clock.
const age = () => p.evaluate(() => { const g = window.__app.game; g.hud.lastActivity = performance.now() - 7000; g.hud.updateIdle(g.state); });
try {
  await p.goto(`${base}/?mode=expedition&preset=low&adaptive=0`); await boot();
  assert.ok(await shown());
  const bounds = await p.$eval('#game-actions', e => JSON.stringify(e.getBoundingClientRect()));
  const start = Date.now(); await idle(); assert.ok(Date.now() - start >= 5000);
  assert.equal(await p.$eval('#game-actions', e => JSON.stringify(e.getBoundingClientRect())), bounds);
  assert.ok(await p.$eval('#game-actions .suggested', e => e.checkVisibility({ checkOpacity: true, visibilityProperty: true })));
  assert.equal(await p.$eval('#play-tools', e => getComputedStyle(e).pointerEvents), 'none');
  await p.screenshot({ path: `${out}/01-quiet.png` });
  checks.push('real six-second fade preserves primary action and layout');
  await p.mouse.move(710, 400); assert.ok(await shown());
  await p.click('#crew-activities'); await p.waitForSelector('#crew-activities-dialog[open]');
  await age(); assert.ok(await shown()); await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('crew-activities-dialog').open && document.activeElement.id === 'crew-activities');
  await p.mouse.click(700, 400); await age(); await idle();
  await p.keyboard.press('n'); await p.waitForSelector('#voyage-chart[open]'); assert.ok(await shown());
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('voyage-chart').open && document.activeElement.id === 'play-chart');
  await p.mouse.click(700, 400); await age(); await idle();
  await p.keyboard.press('Tab'); assert.ok(await shown());
  await p.focus('#play-tools'); await age(); assert.ok(await shown());
  await p.keyboard.press('Space'); await p.waitForSelector('#game:not(.quiet-play)');
  await age(); assert.ok(await shown()); await p.keyboard.press('Escape');
  await p.mouse.click(700, 400); await p.hover('#play-chart'); await age(); assert.ok(await shown());
  await p.mouse.move(700, 400); await p.keyboard.down('q'); await age(); assert.ok(await shown()); await p.keyboard.up('q');
  checks.push('mouse, Tab, focused buttons, hover, held turning, shortcuts and dialogs reveal or retain controls');
  await p.screenshot({ path: `${out}/02-revealed.png` });

  await p.keyboard.press('i'); await p.click('#game-settings'); await p.click('#always-show-controls');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('abyssal:expedition-settings')).alwaysShowControls), true);
  await p.reload(); await boot(); await age(); assert.ok(await shown());
  await wait(6500); assert.ok(await shown());
  await p.keyboard.press('i'); await p.click('#game-settings');
  assert.ok(await p.$eval('#always-show-controls', e => e.checked));
  await p.screenshot({ path: `${out}/03-settings.png` });
  await p.click('#always-show-controls'); await p.click('#close-settings'); await p.keyboard.press('Escape');
  await p.mouse.click(700, 400); await age(); await idle();
  checks.push('Always show controls persists across reload; disabling restores fade');

  const identity = await p.evaluate(() => { const n = window.__app.game.net; return { id: n.id, room: n.room }; });
  const post = async (path, body, token) => {
    const r = await fetch(`${base}/api/rooms/${identity.room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.equal(r.status, 200); return r.json();
  };
  const peer = await post('join', { name: 'Rowan' }); await post('action', { action: 'crewCall', kind: 'ready' }, peer.token);
  await p.waitForSelector('#crew-call-banner:not([hidden])');
  assert.ok(await p.$eval('#ack-crew-call', e => e.checkVisibility({ checkOpacity: true, visibilityProperty: true })));
  await p.click('#ack-crew-call');
  await p.evaluate(() => window.__app.game.net.close());
  await p.waitForSelector('#connection-recovery:not([hidden])', { timeout: 12000 });
  await age(); assert.ok(await shown());
  assert.ok(await p.$eval('#connection-recovery', e => e.checkVisibility({ checkOpacity: true, visibilityProperty: true })));
  checks.push('crew acknowledgement and disconnected recovery remain accessible');

  await p.reload(); await boot();
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await age(); await idle();
  assert.equal(await p.$eval('.context-row', e => getComputedStyle(e).transitionDuration), '0s');
  checks.push('reduced motion disables fade animation');
  await p.setViewport({ width: 390, height: 800, hasTouch: true }); await boot();
  assert.ok(await p.evaluate(() => matchMedia('(any-pointer: coarse)').matches));
  await age(); await wait(6500); assert.ok(await shown());
  assert.ok(await p.$eval('.touch-controls', e => e.checkVisibility({ checkOpacity: true, visibilityProperty: true })));
  await p.screenshot({ path: `${out}/04-touch.png` });
  checks.push('touch toolbar and movement controls stay visible after inactivity');
  assert.deepEqual(errors, []);
  const result = { date: new Date().toISOString(), checks, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
