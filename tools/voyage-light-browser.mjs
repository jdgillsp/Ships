import * as simulation from '../src/game/Simulation.js';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer({...simulation,tick(){}}); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/voyage-light'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
  await p.click('#start-expedition'); await p.waitForFunction(()=>window.__app.game.net.ready&&window.__app.game.lastMode==='deck');
  const room=await p.evaluate(()=>window.__app.game.net.room),w=app.rooms.get(room).world;
  async function clock(time){w.time=time;for(const player of Object.values(w.players))player.lastInput=time;await p.waitForFunction(t=>window.__app.game.state.time===t,{},time);await p.evaluate(async()=>{for(let i=0;i<40;i++)await new Promise(requestAnimationFrame);});}
  await p.keyboard.press('h');await p.waitForFunction(()=>window.__app.game.lastMode==='helm');
  await p.evaluate(()=>{window.__app.game.orbit=.7;window.__app.game.orbitPitch=.05;});
  const views=[];
  for(const [label,time] of [['day',0],['dusk',1328],['night',2100],['dawn',3128]]){
    await clock(time);views.push({label,elevation:await p.evaluate(()=>window.__app.weather.state.sunElevation)});
    await p.screenshot({path:`${out}/${label}.png`});
  }
  assert.ok(views[0].elevation>.5&&Math.abs(views[1].elevation)<.02&&views[2].elevation<-.5&&Math.abs(views[3].elevation)<.02);
  await clock(1200);await p.keyboard.press('n');await p.waitForSelector('#voyage-chart[open]');await p.select('#voyage-destination','deep');await p.select('#planned-stay','180');
  assert.match(await p.$eval('#planned-light',e=>e.textContent),/night on surfacing/);
  await p.setViewport({width:390,height:800});await p.$eval('#planned-light',e=>e.scrollIntoView({block:'center'}));await p.screenshot({path:`${out}/plan-phone.png`});
  await p.keyboard.press('Escape');await clock(2100);await p.keyboard.press('v');await p.waitForFunction(()=>window.__app.game.lastMode==='diver');
  await p.waitForFunction(()=>window.__app.game.diveLight.level>.5);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({views,nightDiveLamp:true,phoneForecast:true,errors}));
}finally{await browser.close();await app.stop();}
