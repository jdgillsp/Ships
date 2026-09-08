import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/hull-paint'; await fs.mkdir(out, { recursive: true });
const errors = [];
async function open(room = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck'); return page;
}
try {
  const a = await open(), room = await a.evaluate(() => window.__app.game.net.room), b = await open(room);
  const surroundings = await a.evaluate(() => window.__app.game.models.originals.filter(o => o.isMesh && o.material !== window.__app.game.models.hullPaint).map(o => o.material.uniforms?.color?.value.getHexString()));
  await a.bringToFront(); await a.click('#crew-activities');
  await a.select('#hull-paint-choice', 'red'); await a.click('#apply-hull-paint');
  for (const page of [a, b]) await page.waitForFunction(() => window.__app.game.models.hullPaint?.uniforms.color.value.getHexString() === '814b40');
  const materials = await a.evaluate(() => {
    const m = window.__app.game.models;
    return { hull: m.originals.filter(o => o.isMesh && o.material === m.hullPaint).length, water: m.copies.filter(o => o.isMesh && o.material === m.hullPaint).length,
      surrounding: m.originals.filter(o => o.isMesh && o.material !== m.hullPaint).map(o => o.material.uniforms?.color?.value.getHexString()) };
  });
  assert.ok(materials.hull > 0); assert.equal(materials.hull, materials.water); assert.deepEqual(materials.surrounding, surroundings);
  await a.setViewport({ width: 390, height: 800 }); await a.$eval('#hull-paint', e => e.scrollIntoView({ block: 'center' }));
  assert.ok(await a.$eval('#crew-activities-dialog', e => e.scrollWidth <= e.clientWidth));
  await a.screenshot({ path: `${out}/palette-phone.png` });
  await a.keyboard.press('Escape'); await a.setViewport({ width: 1280, height: 800 });
  await a.keyboard.press('f');
  await a.waitForFunction(() => window.__app.game.lastMode === 'helm');
  if (await a.evaluate(() => window.__app.game.view !== 'chase')) await a.keyboard.press('c');
  await a.evaluate(() => { window.__app.game.orbit = 1.1; window.__app.game.orbitPitch = .05; });
  await a.evaluate(async () => { for (let i = 0; i < 25; i++) await new Promise(requestAnimationFrame); });
  await a.screenshot({ path: `${out}/red-hull.png` });
  await a.reload(); await a.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await a.click('#start-expedition'); await a.waitForFunction(() => window.__app.game.models.hullPaint?.uniforms.color.value.getHexString() === '814b40');
  await b.bringToFront(); await b.click('#crew-activities'); await b.select('#hull-paint-choice', 'blue'); await b.click('#apply-hull-paint');
  await a.waitForFunction(() => window.__app.game.models.hullPaint?.uniforms.color.value.getHexString() === '304d78');
  assert.deepEqual(errors, []);
  console.log('Hull paint: native shared selection, material isolation, matching water copies, phone controls, rejoin and peer repaint passed.');
} finally { await browser.close(); await app.stop(); }
