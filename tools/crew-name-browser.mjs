import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`, out = 'tools/shots/crew-name'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const errors = [], checks = [];
  const open = async (page, url = base) => { await page.bringToFront(); await page.goto(url); await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 }); };
  const newPage = async () => { const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); return page; };
  const join = async page => { await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && !document.querySelector('.launch-screen'); }); };
  const host = await newPage(); await open(host);
  const proposed = await host.$eval('#crew-name', e => e.value);
  assert.notEqual(proposed, 'Captain', 'A proposed identity must not claim the captain role');
  assert.match(proposed, /^(Tern|Petrel|Gannet|Heron|Puffin|Fulmar|Osprey|Gull) \d{4}$/);
  await host.click('#crew-name'); await host.keyboard.down('Control'); await host.keyboard.press('a'); await host.keyboard.up('Control'); await host.type('#crew-name', 'Mira'); await host.keyboard.press('Enter');
  await host.waitForFunction(() => window.__app.game.started && window.__app.game.net.ready);
  const identity = await host.evaluate(() => { const g = window.__app.game; return { room: g.net.room, id: g.net.id }; });
  const world = app.rooms.get(identity.room).world; await host.keyboard.press('h'); await host.waitForFunction(() => window.__app.game.lastMode === 'helm');
  const peer = await newPage(); await open(peer, `${base}&room=${identity.room}`);
  assert.match(await peer.$eval('#start-expedition', e => e.textContent), /Join the crew/);
  const callsign = await peer.$eval('#crew-name', e => e.value); assert.notEqual(callsign, 'Captain');
  await join(peer); const peerId = await peer.evaluate(() => window.__app.game.net.id);
  assert.equal(world.players[peerId].name, callsign);
  await peer.waitForFunction(() => window.__app.game.contextAction() === 'lookout');
  await peer.keyboard.press('f'); await peer.waitForSelector('#game.lookout-active');
  assert.equal(world.ship.pilot, identity.id); checks.push('Fresh invitees keep a neutral identity and can scout while Mira pilots');
  await peer.keyboard.press('Escape'); await peer.click('#crew-activities'); await peer.waitForSelector('#crew-activities-dialog[open]');
  assert.match(await peer.$eval('#activities-intro', e => e.textContent), /Mira has the helm/);
  await peer.$eval('#activities-crew', e => e.scrollIntoView()); await peer.screenshot({ path: `${out}/01-crew-manifest.png` });
  await open(host); assert.equal(await host.$eval('#crew-name', e => e.value), 'Mira');
  await host.setViewport({ width: 390, height: 800 }); await host.screenshot({ path: `${out}/02-remembered-phone.png` });
  const layout = await host.$eval('#crew-name', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  assert.ok(layout.left >= 0 && layout.right <= 390);
  await open(host, `${base}&room=${identity.room}`);
  await host.click('#crew-name'); await host.keyboard.down('Control'); await host.keyboard.press('a'); await host.keyboard.up('Control'); await host.type('#crew-name', 'New name'); await join(host);
  assert.equal(await host.evaluate(() => window.__app.game.net.id), identity.id);
  assert.equal(world.players[identity.id].name, 'Mira', 'Rejoining preserves the authoritative existing identity');
  await open(host); assert.equal(await host.$eval('#crew-name', e => e.value), 'Mira'); checks.push('Successful names are remembered; rejoining does not rename existing crew');
  const blocked = await newPage();
  await blocked.evaluateOnNewDocument(() => {
    for (const method of ['getItem', 'setItem']) { const original = Storage.prototype[method]; Storage.prototype[method] = function(key, ...args) { if (key === 'abyssal:crew-name') throw new DOMException('Blocked', 'SecurityError'); return original.call(this, key, ...args); }; }
  });
  await open(blocked); await join(blocked); checks.push('Unavailable name-preference storage does not block boarding');
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), proposed, callsign, checks, layout, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
