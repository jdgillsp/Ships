import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/crew-return'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [], checks = [], layouts = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.net.ready && g.lastMode === 'deck'; });
  await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm');
  const identity = await page.evaluate(() => { const g = window.__app.game; return { room: g.net.room, id: g.net.id }; }), world = app.rooms.get(identity.room).world;
  const post = async (path, data, token) => {
    const r = await fetch(`${base}/api/rooms/${identity.room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
    assert.ok(r.ok); return r.json();
  };
  const peers = [];
  for (const name of ['Rowan', 'Mira', 'Ellis']) peers.push(await post('join', { name }));
  const keepAlive = setInterval(() => { for (const p of peers) void post('input', {}, p.token).catch(() => {}); }, 700);
  try {
    world.cargo.attached = world.cargo.recovered = true; world.mission = 'return';
    await post('action', { action: 'dive' }, peers[0].token);
    await page.waitForFunction(() => { const g = window.__app.game; return Object.values(g.state.players).filter(p => p.connected && p.mode === 'diver').length === 1; });
    await page.evaluate(async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); });
    const readout = () => page.$eval('#play-readout', e => e.textContent);
    assert.match(await readout(), /1 diver in water/, 'The quiet helm must keep the remaining dive team visible after recovery');
    checks.push('An authenticated crew dive appears in the quiet helm readout');
    await post('action', { action: 'dive' }, peers[1].token); await post('action', { action: 'dive' }, peers[2].token);
    await page.waitForFunction(() => document.getElementById('play-readout').textContent.includes('3 divers in water'));
    await page.keyboard.press('c');
    for (const width of [1280, 600, 390]) {
      await page.setViewport({ width, height: 800 });
      await page.screenshot({ path: `${out}/01-divers-${width}.png` });
      const layout = await page.$eval('#play-readout', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, overflow: e.scrollWidth > e.clientWidth }; });
      assert.ok(layout.left >= 0 && layout.right <= width && !layout.overflow); layouts.push({ width, ...layout });
    }
    Object.assign(world.cargo, { recovered: false, x: world.ship.x, z: world.ship.z, y: -50 }); world.mission = 'recovery';
    await page.waitForFunction(() => document.getElementById('play-readout').textContent.includes('operate the winch'));
    assert.match(await readout(), /3 divers in water/);
    await page.screenshot({ path: `${out}/02-recovery-phone.png` });
    const recoveryLayout = await page.$eval('.ship-console', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, overflow: e.scrollWidth > e.clientWidth }; });
    assert.ok(recoveryLayout.left >= 0 && recoveryLayout.right <= 390 && !recoveryLayout.overflow);
    world.cargo.recovered = true; world.mission = 'return';
    await page.waitForFunction(() => document.getElementById('play-readout').textContent.includes('kn'));
    checks.push('Recovery guidance and the dive count coexist before the homeward readout returns');
    await page.keyboard.press('b');
    await page.waitForFunction(() => document.getElementById('play-readout').textContent.includes('Raising anchor'));
    assert.match(await readout(), /3 divers in water/);
    assert.equal(await page.$eval('#game-message', e => e.textContent), '', 'Anchor feedback already in the readout is not duplicated');
    await page.keyboard.press('b'); checks.push('Anchor controls remain available and keep the dive count');
    await post('action', { action: 'board' }, peers[0].token);
    await page.waitForFunction(() => document.getElementById('play-readout').textContent.includes('2 divers in water'));
    await post('leave', {}, peers[1].token);
    await page.waitForFunction(() => document.getElementById('play-readout').textContent.includes('1 diver in water'));
    await post('action', { action: 'board' }, peers[2].token);
    await page.waitForFunction(() => !document.getElementById('play-readout').textContent.includes('diver'));
    assert.equal(world.ship.pilot, identity.id); checks.push('Boarding and disconnect update the count without changing the captain');
    assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), checks, layouts, errors };
    await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { clearInterval(keepAlive); }
} finally { await browser.close(); await app.stop(); }
