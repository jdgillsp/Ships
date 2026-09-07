import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { BASE, CRATE } from '../src/game/Simulation.js';

const base = process.env.GAME_URL || 'http://127.0.0.1:8787/';
const solo = process.env.GAME_SOLO === '1' || process.argv.includes('--solo');
const quiet = process.env.GAME_QUIET === '1' || process.argv.includes('--quiet');
const out = `tools/shots/game${solo ? '-solo' : ''}${quiet ? '-quiet' : ''}`; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], defaultViewport: { width: 1280, height: 800 } });
const errors = [], consoles = [], expectedNetworkErrors = []; let networkFault = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pages = [];
async function page(url) {
  const context = await browser.createBrowserContext(), p = await context.newPage(); pages.push(p);
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') {
    if (networkFault && /ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|EMPTY_RESPONSE|INCOMPLETE_CHUNKED_ENCODING)/.test(m.text())) expectedNetworkErrors.push(m.text());
    else consoles.push(m.text());
  } });
  if (!quiet) await useExpandedTools(p); await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 }); return p;
}
async function wait(p, fn, label, timeout = 90000) { await p.waitForFunction(fn, { timeout, polling: 200 }); console.log(label); }
async function clickAction(p, action) {
  if (quiet) {
    const keys = { helm: 'h', leaveHelm: 'h', anchor: 'b', dive: 'v', attach: 'f', winch: 'r', board: 'f', deliver: 'f' };
    assert.ok(keys[action], `Missing immersive shortcut for ${action}`);
    await p.waitForSelector(`[data-action="${action}"]:not(:disabled):not([hidden])`, { timeout: 30000 });
    assert.ok(await p.$eval('#game', e => e.classList.contains('quiet-play')), 'Voyage actions remain in the default immersive view');
    if (keys[action] === 'f') assert.equal(await p.evaluate(() => window.__app.game.contextAction()), action, 'The highlighted action matches the intended mission interaction');
    await p.keyboard.press(keys[action]);
  } else {
    await p.waitForSelector(`[data-action="${action}"]:not(:disabled):not([hidden])`, { timeout: 30000, visible: true }); await p.click(`[data-action="${action}"]`);
  }
  await sleep(400);
}
async function drive(p, destination) {
  await p.evaluate(destination => {
    const g = window.__app.game; clearInterval(window.testPilot);
    window.testPilot = setInterval(() => {
      const s = g.state.ship, dx = destination.x - s.x, dz = destination.z - s.z, dist = Math.hypot(dx, dz);
      const delta = Math.atan2(Math.sin(Math.atan2(dx, dz) - s.heading), Math.cos(Math.atan2(dx, dz) - s.heading));
      g.keys.clear(); if (dist < 10) { clearInterval(window.testPilot); return; }
      if (Math.abs(delta) < .6) g.keys.add('KeyW');
      if (delta > .04) g.keys.add('KeyA'); if (delta < -.04) g.keys.add('KeyD');
    }, 100);
  }, destination);
  await p.waitForFunction(() => Math.abs(window.__app.game.state.ship.speed) > 3, { timeout: 60000 });
  await p.screenshot({ path: `${out}/underway-${destination.z}.png` });
  await p.waitForFunction(destination => { const s = window.__app.game.state.ship; return Math.hypot(s.x - destination.x, s.z - destination.z) < 12; }, { timeout: 150000, polling: 200 }, destination);
  await clickAction(p, 'anchor'); await sleep(1500);
}
async function swim(p, destination) {
  await p.evaluate(destination => {
    const g = window.__app.game; clearInterval(window.testPilot);
    window.testPilot = setInterval(() => {
      const a = g.state.players[g.net.id], dx = destination.x - a.x, dy = destination.y - a.y, dz = destination.z - a.z;
      g.keys.clear(); if (Math.hypot(dx, dy, dz) < 2) { clearInterval(window.testPilot); return; }
      g.yaw = Math.atan2(dx, dz); g.pitch = Math.atan2(dy, Math.hypot(dx, dz)); g.keys.add('KeyW');
    }, 100);
  }, destination);
  await p.waitForFunction(destination => { const g = window.__app.game, a = g.state.players[g.net.id]; return Math.hypot(a.x - destination.x, a.y - destination.y, a.z - destination.z) < 3; }, { timeout: 90000, polling: 200 }, destination);
  await p.evaluate(() => { clearInterval(window.testPilot); window.__app.game.keys.clear(); });
}
try {
  const a = await page(`${base}?mode=expedition&preset=low&adaptive=0`);
  await a.screenshot({ path: `${out}/01-briefing.png` });
  await a.click('#start-expedition'); await wait(a, () => window.__app.game.net.ready, 'Captain connected');
  await a.screenshot({ path: `${out}/02-aboard.png` });
  if (quiet) await a.keyboard.press('i');
  await a.click('#invite'); await a.waitForSelector('#invite-dialog[open]');
  const invite = await a.$eval('#invite-link', el => el.value);
  assert.ok(new URL(invite).searchParams.has('room')); assert.ok(!new URL(invite).searchParams.has('token'));
  await a.click('#close-invite');
  if (quiet) await a.keyboard.press('i');
  const b = solo ? a : await page(`${invite}&preset=low&adaptive=0`);
  if (!solo) {
    await b.$eval('#crew-name', el => { el.value = 'Diver'; }); await b.click('#start-expedition');
    await wait(b, () => window.__app.game.net.ready, 'Diver connected');
    await wait(a, () => Object.values(window.__app.game.state.players).filter(p => p.connected).length === 2, 'Two independent browsers share the cutter');
    await clickAction(a, 'helm');
    networkFault = true;
    await a.setOfflineMode(true);
    await wait(b, () => !window.__app.game.state.ship.pilot, 'Disconnected captain releases helm');
    await clickAction(b, 'helm');
    await a.setOfflineMode(false);
    await wait(a, () => window.__app.game.net.ready && window.__app.game.state.players[window.__app.game.net.id].connected, 'Automatic reconnect succeeds');
    networkFault = false;
    assert.equal(await a.evaluate(() => window.__app.game.state.players[window.__app.game.net.id].mode), 'deck');
    await clickAction(b, 'leaveHelm');
  }
  await clickAction(a, 'helm'); await clickAction(a, 'anchor');
  await drive(a, { x: CRATE.x, z: CRATE.z + 8 });
  await wait(a, () => window.__app.game.state.mission === 'dive', 'Wreck reached');
  await a.screenshot({ path: `${out}/03-wreck-buoy.png` });
  await clickAction(b, 'dive');
  const crate = await b.evaluate(() => window.__app.game.state.cargo);
  await swim(b, { x: crate.x, y: crate.y + 1, z: crate.z + 2 });
  await b.screenshot({ path: `${out}/04-diving.png` });
  await clickAction(b, 'attach');
  await wait(a, () => window.__app.game.state.cargo.attached, 'Captain sees the attached cargo');
  if (!solo) await clickAction(a, 'winch');
  const ship = await b.evaluate(() => window.__app.game.state.ship);
  await swim(b, { x: ship.x + 7, y: -.6, z: ship.z }); await clickAction(b, 'board');
  if (solo) await clickAction(a, 'winch');
  await wait(a, () => window.__app.game.state.cargo.recovered, 'Archive recovered aboard');
  await a.screenshot({ path: `${out}/05-recovered.png` });
  const oldId = await b.evaluate(() => window.__app.game.net.id);
  await b.reload({ waitUntil: 'domcontentloaded' }); await wait(b, () => window.__app?.running && !document.getElementById('boot'), 'Ready to rejoin after reload', 120000); await b.click('#start-expedition');
  await wait(b, () => window.__app.game.net.ready, 'Crew reconnected'); assert.equal(await b.evaluate(() => window.__app.game.net.id), oldId);
  assert.equal(await b.evaluate(() => window.__app.game.state.cargo.recovered), true);
  await clickAction(a, 'helm'); await clickAction(a, 'anchor'); await drive(a, BASE); await clickAction(a, 'deliver');
  await wait(b, () => window.__app.game.state.mission === 'complete', solo ? 'Solo delivery confirmed' : 'Both clients confirm delivery');
  await a.screenshot({ path: `${out}/06-complete.png` });
  const state = await a.evaluate(() => ({ mission: window.__app.game.state.mission, crew: Object.values(window.__app.game.state.players).map(p => ({ name: p.name, mode: p.mode, connected: p.connected })), time: window.__app.game.state.time }));
  assert.deepEqual(errors, []); assert.deepEqual(consoles.filter(e => !e.includes('favicon')), []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, immersive: quiet, nativeActionShortcuts: quiet, completedAt: new Date().toISOString(), state, errors, consoles, expectedNetworkErrors }, null, 2));
  await fs.rm(`${out}/failure.json`, { force: true });
  console.log(JSON.stringify(state)); console.log(`PASS: ${solo ? 'solo' : 'multiplayer'} mission, rendered recovery, rejoin and completion.`);
} catch (error) { for (let i = 0; i < pages.length; i++) { await pages[i].screenshot({ path: `${out}/failure-${i}.png`, timeout: 30000 }).catch(() => {}); } await fs.writeFile(`${out}/failure.json`, JSON.stringify({ error: error.stack, errors, consoles }, null, 2)); throw error; }
finally { await browser.close(); }
