import { voyageSites } from '../src/game/VoyageSites.js';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/helm-sounder'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck' && window.__app.game.net.ready);
  await p.keyboard.press('h'); await p.waitForFunction(() => window.__app.game.lastMode === 'helm'); await p.keyboard.press('c'); await p.keyboard.press('Home');
  const room = await p.evaluate(() => window.__app.game.net.room), world = app.rooms.get(room).world;
  const readings = [];
  for (const name of ['reef', 'deep']) {
    const site = voyageSites().find(s => s.id === name); Object.assign(world.ship, { x: site.x, z: site.z });
    await p.waitForFunction((x, z) => { const s = window.__app.game.frameWorld.ship; return Math.abs(s.x-x) < .01 && Math.abs(s.z-z) < .01; }, {}, site.x, site.z);
    await p.evaluate(async () => { for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame); });
    const result = await p.evaluate(() => {
      const a = window.__app, s = a.game.models.sounder;
      const matches = s.digits.every((d, i) => d.geometry === s.waterDigits[i].geometry && d.visible === s.waterDigits[i].visible);
      const corners = [[-.175,-.0575,0],[.175,.0575,0]].map(v => s.root.localToWorld(a.camera.position.clone().set(...v)).project(a.camera));
      return { text:s.text, matches, visible:s.digits.filter(d=>d.visible).length, onScreen:corners.every(v => Math.abs(v.x)<1 && Math.abs(v.y)<1 && v.z>-1 && v.z<1), errors:a.renderer.getContext().getError() };
    });
    assert.ok(result.matches && result.onScreen && result.errors === 0); readings.push(result);
    await p.screenshot({ path: `${out}/${name}-helm.png` });
  }
  assert.ok(Number(readings[1].text) > Number(readings[0].text) + 500);
  await p.setViewport({ width:390, height:800 }); await p.evaluate(async () => { for (let i=0;i<20;i++) await new Promise(requestAnimationFrame); });
  await p.screenshot({ path: `${out}/deep-phone.png` });
  const fit = await p.evaluate(() => { const a=window.__app, r=a.game.models.sounder.root; return [-.175,.175].map(x=>r.localToWorld(a.camera.position.clone().set(x,0,0)).project(a.camera)).every(v=>Math.abs(v.x)<.95 && Math.abs(v.y)<.95); });
  assert.ok(fit); assert.deepEqual(errors, []); console.log(JSON.stringify({readings,phoneFits:fit,errors}));
} finally { await browser.close(); await app.stop(); }
