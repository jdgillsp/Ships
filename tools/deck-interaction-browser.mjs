import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/deck-interaction'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], checks = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const primary = () => p.evaluate(() => window.__app.game.contextAction());
try {
  await p.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck' && window.__app.game.net.ready);
  const identity = await p.evaluate(() => { const n = window.__app.game.net; return { room: n.room, id: n.id }; });
  const world = app.rooms.get(identity.room).world;
  assert.equal(await primary(), 'helm');
  await p.keyboard.down('s'); await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].deckZ < -3.1; }); await p.keyboard.up('s');
  await p.waitForFunction(() => document.getElementById('play-readout').textContent.includes('lifting cable'));
  assert.equal(await primary(), null); await p.keyboard.press('f'); assert.equal(await p.evaluate(() => window.__app.game.lastMode), 'deck');
  await p.mouse.move(800, 350); await p.mouse.down(); await p.mouse.move(1350, 450, { steps: 12 }); await p.mouse.up();
  await p.screenshot({ path: `${out}/01-winch-waiting.png` }); checks.push('Walking to the idle winch explains the cable requirement');
  Object.assign(world.ship, { x: world.cargo.x, z: world.cargo.z }); world.cargo.attached = true;
  await p.waitForSelector('[data-action=winch].suggested:enabled'); await p.keyboard.press('f'); await p.waitForFunction(() => window.__app.game.lastMode === 'winch');
  await p.screenshot({ path: `${out}/02-operating-winch.png` }); await p.keyboard.press('r'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  checks.push('F operates the nearby ready winch');
  Object.assign(world.players[identity.id], { deckX: 2.5, deckZ: -1.7 }); await p.keyboard.press('Home');
  // Reach the clear foredeck before turning inward; the bow narrows ahead.
  await p.keyboard.down('w'); await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].deckZ > 4.98; }); await p.keyboard.up('w');
  await p.keyboard.down('d'); await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].deckX < .4; }); await p.keyboard.up('d');
  await p.waitForSelector('[data-action=helm].suggested:enabled'); assert.equal(await primary(), 'helm');
  await p.keyboard.press('f'); await p.waitForFunction(() => window.__app.game.lastMode === 'helm'); await p.keyboard.press('h'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck');
  checks.push('Walking to the helm overrides the remote recovery recommendation');
  const join = await fetch(`${base}/api/rooms/${identity.room}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rowan' }) }); assert.ok(join.ok); const peer = await join.json();
  const claim = await fetch(`${base}/api/rooms/${identity.room}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${peer.token}` }, body: JSON.stringify({ action: 'helm' }) }); assert.ok(claim.ok);
  await p.waitForFunction(() => document.getElementById('play-readout').textContent.includes('Rowan'));
  assert.equal(await primary(), null); await p.keyboard.press('f'); assert.equal(await p.evaluate(() => window.__app.game.lastMode), 'deck');
  await p.screenshot({ path: `${out}/03-occupied-helm.png` }); checks.push('Occupied equipment does not redirect F to a distant station');
  const layouts = []; for (const width of [600, 390]) {
    await p.setViewport({ width, height: 800 });
    const r = await p.$eval('.ship-console', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; });
    assert.ok(r.left >= 0 && r.right <= width && r.height < 110); layouts.push({ width, ...r }); await p.screenshot({ path: `${out}/04-status-${width}.png` });
  }
  await p.keyboard.press('r'); await p.waitForFunction(() => window.__app.game.lastMode === 'winch');
  checks.push('Explicit station shortcuts remain available');
  assert.deepEqual(errors, []); const result = { checks, layouts, errors }; await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  console.error('Deck interaction failure', await p.evaluate(() => { const g = window.__app?.game; return { mode: g?.lastMode, player: g?.state?.players[g.net.id], orbit: g?.orbit, errors: document.getElementById('game-message')?.textContent }; }));
  await p.screenshot({ path: `${out}/failure.png` }); throw error;
} finally { await browser.close(); await app.stop(); }
