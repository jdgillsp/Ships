import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const out = 'tools/shots/pickup-course'; await fs.mkdir(out, { recursive: true });
const errors = [];
async function open(room = '') {
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room ? `&room=${room}` : ''}`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => window.__app.game.net.ready && window.__app.game.lastMode === 'deck'); return page;
}
try {
  const a=await open(),room=await a.evaluate(()=>window.__app.game.net.room),b=await open(room),w=app.rooms.get(room).world;
  await a.bringToFront(); await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]'); await a.select('#voyage-destination','kelp'); await a.click('#plot-course');
  await b.bringToFront(); await b.keyboard.press('v'); await b.waitForFunction(()=>window.__app.game.lastMode==='diver');
  const diver=await b.evaluate(()=>window.__app.game.net.id); Object.assign(w.players[diver],{x:w.ship.x+90,y:-.5,z:w.ship.z+30});
  await b.keyboard.press('z'); await b.waitForSelector('#crew-radio-dialog[open]'); await b.click('#call-pickup');
  await a.bringToFront(); await a.waitForSelector('#set-pickup-course:not([hidden]):enabled'); await a.click('#set-pickup-course');
  await a.waitForFunction(()=>!!window.__app.game.state.pickup);
  assert.equal(w.course.id,'kelp'); assert.equal(w.pickup.diver,diver);
  await a.click('#crew-activities'); await a.waitForSelector('[data-activity=mission].recommended');
  assert.equal(await a.$eval('#activity-mission',e=>e.textContent),'Raise anchor');
  assert.match(await a.$eval('#activities-intro',e=>e.textContent),/Pickup in progress/);
  await a.keyboard.press('Escape');
  await a.waitForFunction(()=>window.__app.game.models.coursePointer.state?.label.includes('live pickup'));
  await a.keyboard.press('n'); await a.waitForSelector('#voyage-chart[open]');
  assert.match(await a.$eval('#voyage-status',e=>e.textContent),/Live pickup.*previous plotted course is kept/);
  await a.setViewport({width:390,height:800}); await a.$eval('#voyage-status',e=>e.scrollIntoView({block:'center'}));
  await a.screenshot({path:`${out}/pickup-chart-phone.png`});
  await a.click('#clear-course'); await a.waitForFunction(()=>window.__app.game.state.pickup===null); assert.equal(w.course.id,'kelp');
  await a.setViewport({width:1280,height:800});
  // The original call may have expired during inspection. Request another pickup.
  await b.bringToFront(); await b.keyboard.press('z'); await b.waitForSelector('#crew-radio-dialog[open]'); await b.waitForSelector('#call-pickup:enabled'); await b.click('#call-pickup');
  await a.bringToFront(); await a.waitForSelector('#set-pickup-course:not([hidden]):enabled'); await a.click('#set-pickup-course');
  await a.waitForFunction(()=>!!window.__app.game.state.pickup);
  const before=w.players[diver].x; await b.bringToFront();
  await b.evaluate(()=>{window.__app.game.yaw=Math.PI/2;window.__app.game.pitch=0;}); await b.keyboard.down('w');
  await b.waitForFunction(x=>window.__app.game.state.players[window.__app.game.net.id].x>x+4,{},before); await b.keyboard.up('w');
  await a.waitForFunction(x=>window.__app.game.state.players[window.__app.game.state.pickup.diver].x>x+4,{},before);
  Object.assign(w.players[diver],{x:w.ship.x+7,y:-.5,z:w.ship.z,input:{}});
  await b.waitForFunction(()=>window.__app.game.contextAction()==='board'); await b.keyboard.press('f'); await b.waitForFunction(()=>window.__app.game.lastMode==='deck');
  await a.bringToFront(); await a.waitForFunction(()=>window.__app.game.state.pickup===null && window.__app.game.models.coursePointer.state?.label==='The sunken forest');
  assert.equal(w.course.id,'kelp');
  await a.click('#crew-activities'); await a.$eval('#voyage-log',e=>{e.open=true;}); await a.type('#search-voyage-log','crew pickup');
  await a.waitForFunction(()=>document.querySelector('#voyage-log ol').textContent.includes('returned during a crew pickup'));
  assert.match(await a.$eval('#voyage-log ol',e=>e.textContent),/Climbed aboard.*Course set by/);
  await a.setViewport({width:390,height:800}); await a.$eval('#voyage-log',e=>e.scrollIntoView({block:'center'})); await a.screenshot({path:`${out}/history-phone.png`});
  assert.equal(w.pickupRecords.length,1); assert.deepEqual(errors,[]);
  console.log('Pickup: native diver radio request, shared moving course and helm pointer, preserved route, phone chart cancellation, live swimming and boarding restoration passed.');
} finally { await browser.close(); await app.stop(); }
