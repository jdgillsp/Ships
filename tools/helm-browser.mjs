import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import { helmRigState } from '../src/game/HelmRig.js';
const app = createGameServer(); app.server.listen(0,'127.0.0.1'); await new Promise(r=>app.server.once('listening',r));
const out='tools/shots/helm'; await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding'],defaultViewport:{width:1440,height:900}});
const errors=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function open(room){const context=await browser.createBrowserContext(),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0${room?`&room=${room}`:''}`);await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.lastMode==='deck');return p;}
const pose=p=>p.evaluate(()=>{const g=window.__app.game;return{world:g.frameWorld,rig:Object.fromEntries(Object.entries(g.models.helm).map(([key,o])=>[key,o.rotation.z]))};});
try{
 const a=await open(),room=await a.evaluate(()=>window.__app.game.net.room),b=await open(room);
 await a.bringToFront();await a.keyboard.press('h');await a.waitForFunction(()=>window.__app.game.lastMode==='helm');await a.keyboard.press('c');await sleep(350);
 await a.screenshot({path:`${out}/01-station.png`});
 await a.keyboard.press('Home');await a.keyboard.press('b');await a.keyboard.down('w');await a.keyboard.down('d');await sleep(1100);await a.keyboard.up('w');await a.keyboard.up('d');
 const right=await pose(a);assert.ok(right.rig.wheel>.2,'Right steering turns the wheel clockwise');
 for(const p of [a,b]){const sample=await pose(p),expected=helmRigState(sample.world);for(const key of ['wheel','compass','speed'])assert.ok(Math.abs(sample.rig[key]-expected[key])<1e-9,'Each client animates the instruments from shared ship state');}
 await sleep(1600);await a.keyboard.down('a');await sleep(1000);const left=await pose(a);await a.keyboard.up('a');assert.ok(left.rig.wheel<-.2);
 await a.keyboard.press('b');await a.waitForFunction(()=>Math.abs(window.__app.game.state.ship.speed)<.2);await sleep(1000);assert.ok(Math.abs((await pose(a)).rig.wheel)<.08);
 await a.keyboard.press('h');await a.waitForFunction(()=>window.__app.game.lastMode==='deck');
 await a.keyboard.down('w');await a.waitForFunction(()=>{const g=window.__app.game;return g.state.players[g.net.id].deckZ>=6.2;});await a.keyboard.up('w');
 assert.ok(await a.evaluate(()=>{const g=window.__app.game,p=g.state.players[g.net.id];return p.deckZ<6.31;}),'The helm console blocks walking through it');
 await b.bringToFront();await b.keyboard.press('h');await b.waitForFunction(()=>window.__app.game.lastMode==='helm');await b.keyboard.press('c');await b.keyboard.press('Home');
 await b.waitForFunction(()=>!window.__app.game.models.crew[0].visible);
 await a.bringToFront();await a.keyboard.down('d');await a.waitForFunction(()=>{const g=window.__app.game;return g.state.players[g.net.id].deckX<-1.7;});await a.keyboard.up('d');await b.bringToFront();
 await b.waitForFunction(()=>window.__app.game.models.crew[0].visible);
 for(const width of [600,390]){await b.setViewport({width,height:800});await sleep(300);await b.screenshot({path:`${out}/03-station-${width}.png`});}
 await b.setViewport({width:1440,height:900});
 await b.evaluate(()=>{const a=window.__app,before=a.beforeUpdate;window.helmSun=.55;a.game.root.style.visibility='hidden';a.beforeUpdate=(scaled,dt)=>{before(scaled,dt);a.weather.set({sunElevation:window.helmSun},true);a.weather.update(0);};});
 for(const [label,sun,storm] of [['day',.55,false],['dusk',.04,false],['storm',.3,true]]){
  const w=app.rooms.get(room).world;w.stormStart=storm?w.time-25-150*.9:null;
  await b.evaluate(sun=>{window.helmSun=sun;window.__app.game.cameraSnap=true;},sun);
  await b.evaluate(async()=>{for(let i=0;i<25;i++)await new Promise(requestAnimationFrame);});
  await b.screenshot({path:`${out}/04-${label}.png`});
 }
 assert.deepEqual(errors,[]);const result={right:right.rig,left:left.rig,sharedInstruments:true,consoleCollision:true,helmHandoff:true,errors};await fs.writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await app.stop();}
