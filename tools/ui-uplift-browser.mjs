import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createGameServer} from '../server/index.mjs';
const server=createGameServer();server.server.listen(0,'127.0.0.1');await new Promise(r=>server.server.once('listening',r));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:800}});
const p=await browser.newPage(),errors=[],results=[];p.on('pageerror',e=>errors.push(e.message));await fs.mkdir('tools/shots/ui-uplift',{recursive:true});
try{
await p.goto(`http://127.0.0.1:${server.server.address().port}/?mode=expedition&preset=low&adaptive=0`);await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
await p.screenshot({path:'tools/shots/ui-uplift/launch.png'});await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.lastMode==='deck');
for(const width of [1280,390]){
await p.setViewport({width,height:800});
for(const scale of [1,2]){
await p.evaluate(scale=>{const s=window.__app.game.settings;s.values.textScale=scale;s.applyInterface();s.save();},scale);
for(const id of ['settings-dialog','crew-activities-dialog','voyage-chart','crew-journal','crew-radio-dialog','invite-dialog','mission-complete']){
await p.evaluate(id=>{const g=window.__app.game;if(id==='crew-activities-dialog')g.activities.show();if(id==='voyage-chart')g.voyage.show();if(id==='crew-journal')g.naturalist.showJournal();if(id==='crew-radio-dialog')g.radio.show({station:true});const d=document.getElementById(id);if(id==='mission-complete')d.hidden=false;if(!d.open)d.showModal();},id);
const metrics=await p.$eval('#'+id,e=>{const r=e.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,overflow:e.scrollWidth-e.clientWidth,label:e.getAttribute('aria-labelledby'),targets:[...e.querySelectorAll('button,select')].filter(x=>x.checkVisibility()).map(x=>({id:x.id,h:x.getBoundingClientRect().height,w:x.getBoundingClientRect().width}))};});
results.push({width,scale,id,...metrics});assert.ok(metrics.left>=0&&metrics.right<=width,JSON.stringify(results.at(-1)));assert.ok(metrics.label,id+' needs name');assert.ok(metrics.targets.every(t=>t.h>=44&&t.w>=44),JSON.stringify(results.at(-1)));
await p.screenshot({path:`tools/shots/ui-uplift/${width}-${scale}-${id}.png`});await p.keyboard.press('Escape');
}
await p.screenshot({path:`tools/shots/ui-uplift/${width}-${scale}-hud.png`});
}
}
await p.evaluate(()=>window.__app.game.hud.toggle());
const toolsLayout=await p.$eval('#game',e=>({overflow:e.scrollWidth-e.clientWidth,scrollable:e.scrollHeight>e.clientHeight}));assert.ok(toolsLayout.overflow<=2&&toolsLayout.scrollable,JSON.stringify(toolsLayout));await p.screenshot({path:'tools/shots/ui-uplift/large-tools-phone.png'});
await p.evaluate(()=>{window.__app.game.hud.toggle();document.getElementById('game').scrollTop=0;document.getElementById('game-settings').click();});
await p.focus('#ui-text-scale');await p.keyboard.press('Home');await p.keyboard.press('ArrowRight');
assert.equal(await p.evaluate(()=>window.__app.game.settings.values.textScale),1.1);
assert.equal(await p.$eval('#text-scale-value',e=>e.value),'110%');
await p.click('#readable-panels');assert.equal(await p.$eval('#game',e=>e.classList.contains('readable-panels')),true);
assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('abyssal:expedition-settings')).readablePanels),true);
for(let i=0;i<22;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.getElementById('settings-dialog').contains(document.activeElement)),true);}
await p.keyboard.press('Escape');
assert.deepEqual(results.filter(r=>r.overflow>2),[], 'Horizontal overflow');assert.deepEqual(errors,[]);await fs.writeFile('tools/shots/ui-uplift/results.json',JSON.stringify({results,errors},null,2));console.log('PASS: 28 dialog layouts, named dialogs, 44px controls, no horizontal overflow, no runtime errors');
}finally{await browser.close();await server.stop();}
