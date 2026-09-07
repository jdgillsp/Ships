import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
const app=createGameServer();app.server.listen(0,'127.0.0.1');await new Promise(r=>app.server.once('listening',r));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:800}});
const p=await browser.newPage(),errors=[],checks=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
 await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.net.ready&&window.__app.game.lastMode==='deck');
 for(const modal of ['activities','chart','journal','settings','invite']){
  if(modal==='activities')await p.click('#crew-activities');
  if(modal==='chart')await p.click('#play-chart');
  if(modal==='journal')await p.keyboard.press('j');
  if(modal==='settings'){await p.click('#play-tools');await p.click('#game-settings');}
  if(modal==='invite')await p.click('#invite');
  const r=await p.evaluate(async modal=>{
   const g=window.__app.game,d={activities:g.activities.dialog,chart:g.voyage.dialog,journal:g.naturalist.journal,settings:g.settings.dialog,invite:g.$('invite-dialog')}[modal];
   const key=type=>document.activeElement.dispatchEvent(new KeyboardEvent(type,{code:'KeyS',key:'s',bubbles:true}));
   key('keydown');const blocked=!g.keys.has('KeyS');key('keyup');
   // Native dialog close queues a separate event. Put the user's next key in
   // that gap deterministically, then let the real close handler run.
   d.close();key('keydown');const immediate=g.keys.has('KeyS');
   await new Promise(resolve=>d.addEventListener('close',resolve,{once:true}));
   const retained=g.keys.has('KeyS'),focus=document.activeElement.id,startZ=g.state.players[g.net.id].deckZ;
   return {modal,blocked,immediate,retained,focus,startZ};
  },modal);
  if(r.retained){await p.waitForFunction(z=>{const g=window.__app.game;return g.state.players[g.net.id].deckZ<z-.25;},{timeout:4000},r.startZ);r.walked=true;}
  await p.keyboard.up('s');checks.push(r);
 }
 await p.keyboard.press('n');await p.waitForSelector('#voyage-chart[open]');await p.keyboard.press('Escape');
 await p.waitForFunction(()=>document.activeElement.id==='open-voyage');
 await p.keyboard.press('Space');await p.waitForSelector('#voyage-chart[open]');await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement.id==='open-voyage');
 await p.click('#crew-activities');await p.click('#activity-navigate');await p.waitForSelector('#voyage-chart[open]');
 await p.evaluate(async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);});
 assert.equal(await p.evaluate(()=>document.getElementById('voyage-chart').contains(document.activeElement)),true,'Activities close must not steal focus from the newly opened chart');
 await p.click('#close-voyage');await p.waitForSelector('#voyage-chart:not([open])');
 await p.evaluate(async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);});
 await p.keyboard.down('Space');const pointerReturnsMovement=await p.evaluate(()=>window.__app.game.keys.has('Space'));await p.keyboard.up('Space');
 const room=await p.evaluate(()=>window.__app.game.net.room);
 const join=await fetch(`http://127.0.0.1:${app.server.address().port}/api/rooms/${room}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Rowan'})});assert.ok(join.ok);
 await p.waitForSelector('#crew-radio:not([hidden])');
 const pointerTargets=[];
 for(const modal of ['activities','radio']){
  if(modal==='activities')await p.click('#crew-activities');else await p.keyboard.press('z');
  const selector=modal==='activities'?'#crew-activities-dialog':'#crew-radio-dialog';await p.waitForSelector(`${selector}[open]`);
  await p.click(modal==='activities'?'#close-activities':'#close-radio');await p.waitForSelector(`${selector}:not([open])`);
  await p.evaluate(async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);});
  await p.keyboard.down('Space');assert.ok(await p.evaluate(()=>window.__app.game.keys.has('Space')),`${modal}: pointer close returns Space to gameplay`);await p.keyboard.up('Space');pointerTargets.push(modal);
 }
 console.log(JSON.stringify({checks,fullToolsFocus:true,chartTransition:true,pointerReturnsMovement,pointerTargets,errors}));
 assert.ok(pointerReturnsMovement,'Closing the chart with the pointer returns Space to gameplay');assert.deepEqual(errors,[]);
 for(const c of checks)assert.ok(c.blocked&&c.immediate&&c.retained&&c.walked,`Closing ${c.modal} must retain the new walking key: ${JSON.stringify(c)}`);
 assert.equal(checks.find(c=>c.modal==='chart').focus,'play-chart','Chart returns keyboard focus to the visible quiet-view button');
}finally{await browser.close();await app.stop();}
