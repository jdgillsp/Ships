import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import { FIELD_NOTES } from '../src/underwater/FieldNotes.js';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(resolve => app.server.once('listening', resolve));
const out = 'tools/shots/journal-notebook'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.started && window.__app.game.lastMode === 'deck');
  const types = Object.keys(FIELD_NOTES);
  await page.evaluate(types => { window.__app.game.naturalist.entries = types.map((type, i) => ({ type, depth: 20 + i * 5 })); }, types);
  await page.keyboard.press('j'); await page.waitForSelector('#crew-journal[open]');
  await page.$eval('#crew-journal', e => { e.scrollTop = e.scrollHeight; });
  const close = await page.$eval('#close-crew-journal', e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  console.log(JSON.stringify({ closeAfterScrolling: close }));
  assert.ok(close.top >= 0 && close.bottom <= 800, 'Close remains reachable at the end of a long field journal');
  const pose = await page.evaluate(() => { const g = window.__app.game, p = g.state.players[g.net.id]; return [p.deckX, p.deckZ, p.mode]; });
  const layouts = [];
  for (const width of [1280, 600, 390]) {
    await page.setViewport({ width, height: 800 });
    await page.select('#journal-sighting', types[Math.floor(types.length / 2)]);
    const layout = await page.evaluate(() => {
      const journal = document.getElementById('crew-journal'), header = journal.querySelector('.journal-heading').getBoundingClientRect();
      const article = document.activeElement.getBoundingClientRect(), select = document.getElementById('journal-sighting').getBoundingClientRect(), rect = journal.getBoundingClientRect();
      return { focused: document.activeElement.id, articleTop: article.top, headerBottom: header.bottom, left: rect.left, right: rect.right, selectLeft: select.left, selectRight: select.right, overflow: journal.scrollWidth > journal.clientWidth };
    });
    assert.equal(layout.focused, `journal-entry-${types[Math.floor(types.length / 2)]}`);
    assert.ok(layout.articleTop >= layout.headerBottom && layout.left >= 0 && layout.right <= width && layout.selectLeft >= 0 && layout.selectRight <= width && !layout.overflow, 'Chosen notes sit below the sticky header without horizontal overflow');
    await page.screenshot({ path: `${out}/01-notes-${width}.png` }); layouts.push({ width, ...layout });
  }
  await page.focus('#journal-sighting'); await page.keyboard.press('ArrowDown');
  assert.ok(await page.evaluate(() => document.activeElement.id.startsWith('journal-entry-')), 'Keyboard selection moves focus to the chosen notes');
  await page.keyboard.press('w');
  assert.deepEqual(await page.evaluate(() => { const g = window.__app.game, p = g.state.players[g.net.id]; return [p.deckX, p.deckZ, p.mode]; }), pose);
  await page.click('#close-crew-journal'); await page.waitForSelector('#crew-journal:not([open])');
  await page.keyboard.press('j'); await page.waitForSelector('#crew-journal[open]');
  assert.equal(await page.$eval('#crew-journal', e => e.scrollTop), 0, 'Reopening starts at the journal cover');
  assert.equal(await page.$eval('#journal-sighting', e => e.value), '');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__app.game.naturalist.entries = []; });
  await page.keyboard.press('j'); await page.waitForSelector('#crew-journal[open]');
  assert.ok(await page.$eval('.journal-jump', e => e.hidden), 'An empty notebook does not offer an empty index');
  assert.ok(await page.$eval('#crew-journal-intro', e => e.textContent.includes('Enter the water')));
  await page.screenshot({ path: `${out}/02-empty.png` });
  console.log(JSON.stringify({ layouts, keyboardJump: true, noWalking: true, resetOnOpen: true, emptyState: true, errors }));
  assert.deepEqual(errors, []);
} finally { await browser.close(); await app.stop(); }
