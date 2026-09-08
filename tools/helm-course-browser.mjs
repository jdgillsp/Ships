import { voyageSites } from '../src/game/VoyageSites.js';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/helm-course'; await fs.mkdir(out, { recursive: true });
const errors = [];
async function open(room = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck'); return page;
}
try {
  const a = await open(), room = await a.evaluate(() => window.__app.game.net.room), b = await open(room), world = app.rooms.get(room).world;
  await b.bringToFront(); await b.keyboard.press('n'); await b.waitForSelector('#voyage-chart[open]'); await b.select('#voyage-destination','reef'); await b.click('#plot-course');
  for (const p of [a,b]) await p.waitForFunction(() => window.__app.game.state.course?.id === 'reef');
  const site=voyageSites().find(s=>s.id==='reef'); Object.assign(world.ship,{x:site.x+100,z:site.z,heading:0,yawRate:0});
  await a.bringToFront(); await a.waitForFunction(() => Math.abs(window.__app.game.models.coursePointer.state?.angle-Math.PI/2)<.01);
  if (await a.evaluate(() => window.__app.game.lastMode !== 'helm')) await a.keyboard.press('h');
  await a.waitForFunction(() => window.__app.game.lastMode === 'helm');
  if (await a.evaluate(() => window.__app.game.view !== 'deck')) await a.keyboard.press('c');
  await a.keyboard.press('Home');
  await a.evaluate(async()=>{for(let i=0;i<20;i++)await new Promise(requestAnimationFrame);});
  const right=await a.evaluate(()=>{
    const app=window.__app,g=app.game,m=g.models,arrow=m.coursePointer.pointer,copy=m.waterRoot.getObjectByName('Helm course pointer');
    const point=arrow.localToWorld(app.camera.position.clone().set(0,.13,0)).project(app.camera),center=m.helm.compass.localToWorld(app.camera.position.clone().set(0,0,0)).project(app.camera);
    return {point:{x:point.x,y:point.y,z:point.z},center:{x:center.x,y:center.y,z:center.z},view:g.view,angle:m.coursePointer.state.angle,right:point.x>center.x+.03,matching:arrow.visible&&copy.visible&&Math.abs(copy.rotation.z-arrow.rotation.z)<1e-9};
  }); assert.ok(right.right&&right.matching,JSON.stringify(right));
  await a.screenshot({path:`${out}/course-right.png`});
  await a.keyboard.press('b'); await a.waitForFunction(()=>!window.__app.game.state.ship.anchor);
  await a.keyboard.down('d'); await a.waitForFunction(()=>window.__app.game.models.coursePointer.state.angle<1.2); await a.keyboard.up('d');
  await a.keyboard.press('b'); await a.waitForFunction(()=>window.__app.game.state.ship.anchor);
  await a.setViewport({width:390,height:800}); await a.evaluate(async()=>{for(let i=0;i<20;i++)await new Promise(requestAnimationFrame);});
  await a.screenshot({path:`${out}/steering-phone.png`});
  await b.bringToFront(); await b.keyboard.press('n'); await b.waitForSelector('#voyage-chart[open]'); await b.click('#clear-course');
  for(const p of [a,b]) await p.waitForFunction(()=>window.__app.game.state.course===null);
  await a.bringToFront(); await a.waitForFunction(()=>!window.__app.game.models.coursePointer.pointer.visible);
  await b.bringToFront(); await b.keyboard.press('n'); await b.waitForSelector('#voyage-chart[open]'); await b.click('#plan-home'); await b.click('#plot-course');
  await a.bringToFront(); await a.waitForFunction(()=>window.__app.game.models.coursePointer.state?.label==='Pelican Station');
  assert.deepEqual(errors,[]); console.log('Helm course: peer plotting, correct right-hand bearing, matching water pointer, native steering toward the course, phone rendering, clearing and homeward replanning passed.');
} finally { await browser.close(); await app.stop(); }
