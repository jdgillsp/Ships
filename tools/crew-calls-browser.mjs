import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/crew-calls'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(name, room) {
  const context = await browser.createBrowserContext(), p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await useExpandedTools(p); await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.$eval('#crew-name', (e, name) => { e.value = name; }, name); await p.click('#start-expedition');
  await p.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck'); return p;
}
const radio = async p => { await p.bringToFront(); await p.keyboard.press('z'); await p.waitForSelector('#crew-radio-dialog[open]'); };
try {
  const a = await open('Mira'); assert.equal(await a.$eval('#crew-radio', e => e.hidden), true, 'Solo crew do not see an empty radio');
  await a.keyboard.press('h'); const room = await a.evaluate(() => window.__app.game.net.room), b = await open('Rowan', room);
  await a.waitForSelector('#crew-radio:not([hidden])'); await a.bringToFront(); await a.click('#sound');
  await a.waitForFunction(() => window.__app.game.sound.enabled && window.__app.game.sound.context);
  await a.evaluate(() => { const sound = window.__app.game.sound, tone = sound.tone; window.callTones = []; sound.tone = function(notes, ...args) { window.callTones.push(notes); return tone.call(this, notes, ...args); }; });
  await b.bringToFront(); await b.keyboard.down('w'); await b.keyboard.press('z'); await b.keyboard.up('w'); await b.waitForSelector('#crew-radio-dialog[open]');
  await b.keyboard.press('v'); assert.equal(await b.evaluate(() => window.__app.game.lastMode), 'deck');
  assert.equal(await b.evaluate(() => window.__app.game.keys.size), 0);
  await b.screenshot({ path: `${out}/01-call-menu.png` }); await b.click('#call-ready');
  await a.waitForFunction(() => document.getElementById('crew-call-banner').textContent.includes('Rowan: Ready to dive'));
  await a.bringToFront(); await a.click('#ack-crew-call');
  await b.waitForFunction(() => document.getElementById('crew-call-banner').textContent.includes('Mira: On it'));
  await a.waitForFunction(() => window.callTones.some(notes => notes[0] === 640 && notes[1] === 800));
  assert.equal(await a.evaluate(() => window.callTones.filter(notes => notes[0] === 480 && notes[1] === 640).length), 1);
  await b.bringToFront(); await b.keyboard.press('v'); await b.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await radio(b); await b.waitForSelector('#call-pickup:not([disabled]):not([hidden])'); await b.click('#call-pickup');
  await a.waitForFunction(() => document.getElementById('crew-call-banner').textContent.includes('Need pickup'));
  await a.bringToFront(); await a.click('#ack-crew-call');
  const diver = await b.evaluate(() => window.__app.game.net.id);
  await a.waitForFunction(id => window.__app.game.crewTracking.id === id, {}, diver);
  assert.equal(await a.evaluate(() => window.__app.game.lastMode), 'helm', 'Acknowledging pickup does not leave the helm or steer automatically');
  await a.screenshot({ path: `${out}/02-pickup-acknowledged.png` });
  for (const width of [600, 390]) {
    await a.setViewport({ width, height: 800 }); await sleep(250);
    const r = await a.evaluate(() => { const c = document.querySelector('.ship-console').getBoundingClientRect(), m = document.querySelector('.mission-panel').getBoundingClientRect(), b = document.getElementById('crew-call-banner').getBoundingClientRect(); return { consoleTop: c.top, missionBottom: m.bottom, left: b.left, right: b.right, bottom: c.bottom }; });
    assert.ok(r.left >= 0 && r.right <= width && r.bottom <= 800 && r.consoleTop > r.missionBottom, 'Phone call banner stays clear of the mission');
    await a.screenshot({ path: `${out}/03-banner-${width}.png` }); await radio(a);
    const box = await a.$eval('#crew-radio-dialog', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, scroll: e.scrollWidth, client: e.clientWidth }; });
    assert.ok(box.left >= 0 && box.right <= width && box.bottom <= 800 && box.scroll <= box.client);
    await a.screenshot({ path: `${out}/04-menu-${width}.png` }); await a.keyboard.press('Escape');
  }
  for (const call of Object.values(app.rooms.get(room).world.calls)) call.expires = app.rooms.get(room).world.time + .2;
  await a.waitForSelector('#crew-call-banner[hidden]'); await b.waitForSelector('#crew-call-banner[hidden]');
  await b.bringToFront(); await radio(b); await b.waitForSelector('#call-pickup:not([disabled]):not([hidden])'); await b.click('#call-pickup');
  await a.waitForSelector('#crew-call-banner:not([hidden])'); await b.close();
  await a.waitForSelector('#crew-call-banner[hidden]'); await a.waitForSelector('#crew-radio[hidden]');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ calls: true, acknowledgements: true, pickupTracking: true, expiry: true, disconnect: true, sound: true, phoneWidths: [600, 390], errors }));
} finally { await browser.close(); await app.stop(); }
