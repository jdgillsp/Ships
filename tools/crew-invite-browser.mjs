import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '0.0.0.0'); await new Promise(r => app.server.once('listening', r));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/crew-invite'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const errors = [], pages = [];
const boot = async (page, url, name) => {
  pages.push(page); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#crew-name'); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.type('#crew-name', name); await page.click('#start-expedition');
  await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
};
const openInvite = async page => {
  if (!await page.$eval('#invite', e => e.checkVisibility({ visibilityProperty: true }))) await page.click('#play-tools');
  await page.click('#invite'); await page.waitForSelector('#invite-dialog[open]');
  await page.waitForSelector('#copy-invite:not([disabled])');
};
try {
  const page = await browser.newPage(); await boot(page, `${base}/?mode=expedition&preset=low&adaptive=0#old-view`, 'Mira');
  await openInvite(page);
  const invite = await page.$eval('#invite-link', e => e.value), url = new URL(invite);
  assert.notEqual(url.hostname, '127.0.0.1', 'The local preview produces a network invitation');
  assert.equal(url.hash, ''); assert.deepEqual([...url.searchParams.keys()].sort(), ['mode', 'room']);
  assert.ok(await page.$eval('#invite-network-note', e => e.textContent.includes('same Wi-Fi')));
  const id = await page.evaluate(() => window.__app.game.net.id), room = url.searchParams.get('room'), world = app.rooms.get(room).world;
  const pose = [world.players[id].deckX, world.players[id].deckZ];
  await page.keyboard.press('h'); await page.keyboard.press('b'); await page.keyboard.press('w');
  assert.equal(world.ship.pilot, null); assert.equal(world.ship.anchor, true); assert.deepEqual([world.players[id].deckX, world.players[id].deckZ], pose);
  const options = await page.$$eval('#invite-address option', elements => elements.map(e => e.value));
  if (options.length > 1) {
    await page.select('#invite-address', options[1]);
    assert.equal(new URL(await page.$eval('#invite-link', e => e.value)).origin, options[1]);
    await page.select('#invite-address', options[0]);
  }
  // Exercise the native copy button without replacing the user's OS clipboard.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedInvite = value; } } }));
  await page.click('#copy-invite'); await page.waitForFunction(() => document.getElementById('copy-status').textContent === 'Link copied.');
  assert.equal(await page.evaluate(() => window.copiedInvite), invite, 'Copy uses the selected shareable address');
  const layouts = [];
  for (const width of [1280, 600, 390]) {
    await page.setViewport({ width, height: 800 });
    const rect = await page.$eval('#invite-dialog', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: e.scrollWidth > e.clientWidth }; });
    assert.ok(rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= 800 && !rect.overflow);
    layouts.push({ width, ...rect }); await page.screenshot({ path: `${out}/01-invite-${width}.png` });
  }
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); }; });
  await page.click('#copy-invite'); await page.waitForFunction(() => document.getElementById('copy-status').textContent.includes('Select and copy'));
  assert.ok(await page.$eval('#invite-link', e => e.selectionStart === 0 && e.selectionEnd === e.value.length));
  await page.click('#close-invite');

  const friendContext = await browser.createBrowserContext(), friend = await friendContext.newPage();
  await boot(friend, `${invite}&preset=low&adaptive=0`, 'Rowan');
  assert.equal(await friend.evaluate(() => window.__app.game.net.room), room);
  assert.equal(Object.values(world.players).filter(p => p.connected).length, 2, 'The actual network address joins the same crew');
  assert.deepEqual(await (await fetch(`${url.origin}/api/invite-addresses`)).json(), { addresses: [] }, 'A network request does not receive host interface details');
  await openInvite(friend);
  const onward = new URL(await friend.$eval('#invite-link', e => e.value));
  assert.equal(onward.origin, url.origin); assert.equal(onward.searchParams.get('room'), room);
  await friend.click('#close-invite'); await friendContext.close();
  await page.bringToFront();

  // A unavailable address lookup must give an honest local-only fallback.
  await page.evaluate(() => { const fetch = window.fetch; window.fetch = (...args) => args[0] === '/api/invite-addresses' ? Promise.resolve({ ok: true, json: async () => ({ addresses: [] }) }) : fetch(...args); });
  await openInvite(page);
  assert.equal(new URL(await page.$eval('#invite-link', e => e.value)).origin, base);
  assert.ok(await page.$eval('#invite-network-note', e => e.textContent.includes('only opens on this computer')));
  assert.equal(await page.$eval('#copy-status', e => e.textContent), '', 'Reopening clears an old copy response');
  await page.screenshot({ path: `${out}/02-local-fallback.png` }); await page.click('#close-invite');

  // An obsolete lookup cannot replace a newly opened dialog's current result.
  await page.evaluate(() => { let count = 0; const fetch = window.fetch; window.fetch = (...args) => {
    if (args[0] !== '/api/invite-addresses') return fetch(...args);
    count++; if (count === 1) return new Promise(resolve => { window.finishOldInvite = () => resolve({ ok: true, json: async () => ({ addresses: [{ label: 'Old connection', origin: 'http://10.0.0.9:1234' }] }) }); });
    return Promise.resolve({ ok: true, json: async () => ({ addresses: [] }) });
  }; });
  await page.click('#invite'); await page.waitForFunction(() => !!window.finishOldInvite); await page.click('#close-invite');
  await openInvite(page); await page.evaluate(() => window.finishOldInvite());
  assert.equal(new URL(await page.$eval('#invite-link', e => e.value)).origin, base);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ networkJoin: true, selectedAddressCopied: true, onwardInvitePreserved: true, manualCopy: true, localFallback: true, obsoleteLookupIgnored: true, layouts, errors }));
} catch (error) { await pages[0]?.screenshot({ path: `${out}/failure.png` }).catch(() => {}); throw error; }
finally { await browser.close(); await app.stop(); }
