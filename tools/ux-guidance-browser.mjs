import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
const server=createGameServer();server.server.listen(0,'127.0.0.1');await new Promise(r=>server.server.once('listening',r));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:800}});
const p=await browser.newPage(),errors=[],checks=[],out='tools/shots/ux-guidance';await fs.mkdir(out,{recursive:true});p.on('pageerror',e=>errors.push(e.message));
const mode=m=>p.waitForFunction(m=>window.__app.game.lastMode===m,{},m);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
 await p.goto(`http://127.0.0.1:${server.server.address().port}/?mode=expedition&preset=low&adaptive=0`);await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});await p.click('#start-expedition');await mode('deck');
 await p.waitForSelector('#first-use-help:not([hidden])');assert.match(await p.$eval('#first-use-copy',e=>e.textContent),/WASD.*Q\/E.*C/);
 await wait(6500);assert.equal(await p.$eval('#game',e=>e.classList.contains('controls-idle')),false);await p.screenshot({path:`${out}/01-first-use.png`});
 await p.click('#first-use-help button');await p.keyboard.press('?');await p.waitForSelector('#first-use-help:not([hidden])');await p.click('#first-use-help button');checks.push('first-use hints keep controls discoverable and Help restores them');
 await p.click('#crew-activities');await p.waitForSelector('#crew-activities-dialog[open]');assert.match(await p.$eval('[data-activity=mission]',e=>e.textContent),/Get underway.*Raise anchor/s);assert.ok(await p.$eval('[data-activity=mission]',e=>e.classList.contains('recommended')));assert.match(await p.$eval('[data-activity=navigate]',e=>e.textContent),/optional/);await p.screenshot({path:`${out}/02-mission.png`});await p.click('#close-activities');
 await p.keyboard.press('h');await mode('helm');await p.waitForSelector('#first-use-help:not([hidden])');assert.match(await p.$eval('#first-use-copy',e=>e.textContent),/A\/D steer.*H leaves/);
 await p.keyboard.press('b');await p.waitForFunction(()=>!window.__app.game.state.ship.anchor);await p.keyboard.down('w');await wait(6500);await p.keyboard.up('w');await p.waitForSelector('#first-use-help[hidden]');checks.push('helm hint dismisses after successful movement');
 await p.keyboard.press('k');await p.waitForSelector('#navigation-glance-panel:not([hidden])');assert.match(await p.$eval('#navigation-glance-panel',e=>e.textContent),/SURVEY BUOY.*m.*°/);assert.equal(await p.evaluate(()=>window.__app.game.dialogOpen()),false);await p.screenshot({path:`${out}/03-glance.png`});await p.keyboard.press('k');
 await p.keyboard.press('b');await p.waitForFunction(()=>Math.abs(window.__app.game.state.ship.speed)<1.9);await p.keyboard.press('v');await mode('diver');await p.waitForSelector('#first-use-help:not([hidden])');assert.match(await p.$eval('#first-use-copy',e=>e.textContent),/Space rises.*Ctrl descends/);
 await p.keyboard.press('k');await p.waitForSelector('#navigation-glance-panel:not([hidden])');assert.match(await p.$eval('#navigation-glance-panel',e=>e.textContent),/KESTREL.*cable cannot reach/);await p.keyboard.press('k');await p.keyboard.press('f');await mode('deck');
 await p.keyboard.press('v');await wait(300);assert.equal(await p.evaluate(()=>window.__app.game.lastMode),'deck');await p.waitForFunction(()=>performance.now()>=window.__app.game.boardingUntil);await p.keyboard.press('v');await mode('diver');checks.push('premature dives explain cable range; boarding blocks rapid re-entry then permits deliberate diving');
 await p.keyboard.press('f');await mode('deck');
 await p.setViewport({width:390,height:800});await p.click('#play-help');await p.waitForSelector('#first-use-help:not([hidden])');
 const layout=await p.$eval('.ship-console',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});assert.ok(layout.left>=0&&layout.right<=390&&layout.bottom<=800);await p.screenshot({path:`${out}/04-phone-help.png`});
 await p.click('#first-use-help button');await p.keyboard.press('k');await p.waitForSelector('#navigation-glance-panel:not([hidden])');await p.screenshot({path:`${out}/05-phone-glance.png`});await p.waitForSelector('#navigation-glance-panel[hidden]',{timeout:10000});checks.push('phone layout fits and navigation glance expires without opening a modal');
 await p.reload();await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});await p.click('#start-expedition');await mode('deck');await p.waitForSelector('#first-use-help[hidden]');checks.push('learned controls persist after reloading the voyage');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,layout,errors}));await fs.writeFile(`${out}/result.json`,JSON.stringify({checks,layout,errors},null,2));
}finally{await browser.close();await server.stop();}
