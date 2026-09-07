import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='tools/shots/refinement'; await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding'],defaultViewport:{width:1440,height:900}});
const p=await browser.newPage(), errors=[];
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
 await p.goto(`http://localhost:8787/?mode=expedition&preset=${process.env.REVIEW_PRESET || 'low'}&adaptive=0`);
 await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
 await p.click('#start-expedition'); await p.waitForFunction(()=>window.__app.game.net.ready,{timeout:30000});
 await sleep(1500); await p.screenshot({path:out+'/01-controls.png'});
 await p.keyboard.press('f'); await p.waitForFunction(()=>window.__app.game.state.players[window.__app.game.net.id].mode==='helm');
 await sleep(500);await p.keyboard.press('f');await p.waitForFunction(()=>!window.__app.game.state.ship.anchor);
 const heading=await p.evaluate(()=>window.__app.game.state.ship.heading);
 await p.keyboard.down('ArrowUp');await p.keyboard.down('ArrowRight');await sleep(1800);await p.keyboard.up('ArrowRight');await p.keyboard.up('ArrowUp');
 assert.ok(await p.evaluate(h=>window.__app.game.state.ship.heading<h,heading),'Right arrow turns right');
 assert.ok(await p.$eval('#bearing',el=>parseInt(el.textContent,10))>180,'Right turn also rotates the compass clockwise');
 await p.keyboard.down('s');await p.waitForFunction(()=>window.__app.game.state.ship.speed<-.3,{timeout:12000});await sleep(300);
 assert.ok(await p.$eval('#speed',el=>el.textContent.includes('−')),'Astern speed is signed');assert.ok(await p.$eval('#helm-feedback',el=>el.textContent.includes('Astern')),'Reverse travel is labeled');
 await p.keyboard.up('s');await p.keyboard.press('b');await sleep(1200);
 assert.equal(await p.$eval('#anchor-state',el=>el.textContent),'Holding');
 await p.mouse.move(760,450);await p.mouse.wheel({deltaY:-240});await sleep(300);
 assert.ok(await p.evaluate(()=>window.__app.game.zoom<27),'Scroll zooms');
 await p.keyboard.press('Home');assert.equal(await p.evaluate(()=>window.__app.game.zoom),27);
 await p.keyboard.press('c');await p.mouse.move(760,450);await p.mouse.down();await p.mouse.move(820,480,{steps:8});await p.mouse.up();
 assert.ok(await p.evaluate(()=>window.__app.game.orbit<0&&window.__app.game.deckPitch<0),'Deck mouse looks right and down');
 await p.keyboard.press('Home');await p.keyboard.press('v');await p.waitForFunction(()=>window.__app.game.state.players[window.__app.game.net.id].mode==='diver');await sleep(400);
 assert.equal(await p.$eval('#camera-view',el=>el.textContent),'View: diver');
 const yaw=await p.evaluate(()=>window.__app.game.yaw);
 await p.mouse.move(760,450);await p.mouse.down();await p.mouse.move(820,480,{steps:8});await p.mouse.up();
 assert.ok(await p.evaluate(y=>window.__app.game.yaw<y&&window.__app.game.pitch<0,yaw),'Dive mouse looks right and down');
 // Capture deterministic art review angles through the production renderer.
 await p.evaluate(()=>{const a=window.__app,g=a.game;g.keys.clear();g.net.input({});g.net.close();a.beforeUpdate=()=>{};a.afterUpdate=()=>{};document.getElementById('game').style.display='none';window.reviewWorld=structuredClone(g.state);window.reviewWorld.ship={...window.reviewWorld.ship,x:-140,z:440,heading:0,pitch:0,roll:0,y:0,speed:0};window.reviewWorld.cargo.recovered=true;Object.values(window.reviewWorld.players).forEach(p=>p.mode='deck');g.models.update(window.reviewWorld,g.net.id);});
 for(const [name,sun,storm,pos,target] of [
 ['02-cutter-day',.55,0,[-122,12,418],[-140,3,440]],
 ['03-bow-day',.55,0,[-126,8,461],[-140,3,440]],
 ['04-cutter-dusk',.09,0,[-122,12,418],[-140,3,440]],
 ['05-cutter-storm',.3,.85,[-122,12,418],[-140,3,440]],
 ['06-waterline',.55,0,[-128,1.4,431],[-140,2,440]],
 ['07-aerial',.55,0,[-140,250,440],[-140,0,430]],
 ['08-distant',.55,0,[-140,1000,440],[-140,0,430]],
 ['09-wreck',.55,0,[-131,-10,230],[-140,-15,245]],
 ]) {
 await p.evaluate(({sun,storm,pos,target})=>{const a=window.__app;if(pos[1]<0){const w=a.game.models.wreck.position;pos=[w.x+13,w.y+8,w.z-15];target=[w.x,w.y+1,w.z];}a.camera.position.set(...pos);a.camera.lookAt(...target);a.camera.updateMatrixWorld();a.weather.set({sunElevation:sun,sunAzimuth:2.1,storm,cloudCoverage:.35+storm*.65,rain:storm*.5,windSpeed:5+storm*18},true);a.weather.update(0);a.game.models.shadow.update(a.game.models.ship,true);}, {sun,storm,pos,target});
 await sleep(1800);await p.screenshot({path:`${out}/${name}.png`});
 }
 const timing=await p.evaluate(async()=>{const a=window.__app;const samples=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);samples.push(a.frameMs);}samples.sort((a,b)=>a-b);return {median:samples[45],p95:samples[85]};});
 const stats=await p.evaluate(()=>({render:window.__app.renderer.info.render,geometries:window.__app.renderer.info.memory.geometries,shipDraws:window.__app.game.models.ship.children.filter(o=>o.isMesh).length}));
 await fs.writeFile(out+'/result.json',JSON.stringify({errors,stats,timing,controls:'passed'},null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify({errors,stats,timing,controls:'passed'}));
} finally {await browser.close();}
