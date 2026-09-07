import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.GAME_URL || 'http://127.0.0.1:8787/';
const out = 'tools/shots/exploration-regression'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });
try {
  await page.goto(`${base}?mode=explore&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  assert.equal(await page.evaluate(() => !!window.__app.expedition?.active && !window.__app.game), true);
  await page.screenshot({ path: `${out}/01-surface.png` });
  await page.click('#begin-dive');
  await page.waitForFunction(() => !window.__app.expedition.travel && window.__app.camera.position.y < -10, { timeout: 60000 });
  await page.click('#dive-swim'); const before = await page.evaluate(() => window.__app.camera.position.toArray());
  await page.keyboard.down('w'); await new Promise(r => setTimeout(r, 1500)); await page.keyboard.up('w');
  const after = await page.evaluate(() => window.__app.camera.position.toArray()); assert.ok(Math.hypot(...after.map((v, i) => v - before[i])) > 1, 'free swimming works');
  await page.screenshot({ path: `${out}/02-reef.png` });
  await page.keyboard.press('2');
  await page.waitForFunction(() => !window.__app.expedition.travel && window.__app.underwater.habitat.id === 'kelp', { timeout: 90000 });
  await page.screenshot({ path: `${out}/03-kelp.png` });
  await page.click('#dive-lab-toggle'); await page.waitForSelector('#dive-lab:not([hidden])');
  await page.click('[data-lab-tab="weather"]'); await page.waitForSelector('#lab-panel-weather:not([hidden])');
  await page.click('#close-world-lab');
  await page.keyboard.press('4');
  await page.waitForFunction(() => !window.__app.expedition.travel && window.__app.camera.position.y < -1300, { timeout: 180000 });
  await page.screenshot({ path: `${out}/04-deep.png` });
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: ['surface', 'reef dive', 'free swimming', 'kelp journey', 'world lab', 'deep journey'], errors }, null, 2));
  console.log('PASS: original surface, reef, kelp, deep, free swimming and world lab.');
} finally { await browser.close(); }
