import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';
const app=createGameServer({...simulation,addPlayer(w,id,name){const p=simulation.addPlayer(w,id,name);Object.assign(p,{mode:'diver',x:-140,z:140,y:oceanFloor(-140,140,simulation.RECIPE)+6});return p;}});
app.server.listen(0,'127.0.0.1');await new Promise(r=>app.server.once('listening',r));
const base=`http://127.0.0.1:${app.server.address().port}`,out='tools/shots/journal-photos';await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1440,height:900}});
const p=await browser.newPage(),errors=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const boot=()=>p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
try{
 const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.resolve(out)});
 await p.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);await boot();await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.started&&window.__app.game.net.ready&&window.__app.game.lastMode==='diver'&&!document.querySelector('.launch-screen'));
 await p.click('#crew-activities');await p.waitForSelector('#activity-dive:enabled');await p.click('#activity-dive');await p.waitForSelector('#crew-naturalist:not([hidden])');
 for(let n=0;n<12&&await p.$eval('#photograph-wildlife',e=>e.disabled);n++){
   await p.evaluate(n=>{const g=window.__app.game;g.yaw=n*Math.PI/6;g.pitch=-.25;},n);await sleep(2200);
 }
 await p.waitForSelector('#photograph-wildlife:enabled');
 const studyLayouts=[];
 const studyRect=()=>p.$eval('#crew-naturalist',e=>{const r=e.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,bottom:r.bottom,height:r.height};});
 assert.equal(await p.$eval('#study-notes',e=>e.hidden),true);
 const collapsed=await studyRect();assert.ok(collapsed.height<260,`The default card stays compact (${collapsed.height}px)`);studyLayouts.push(collapsed);
 await p.screenshot({path:`${out}/06-quiet-study.png`});
 const notesPose=await p.evaluate(()=>{const g=window.__app.game,s=g.state.players[g.net.id];return [s.x,s.y,s.z];});
 await p.focus('#toggle-study-notes');await p.keyboard.press('Space');
 assert.equal(await p.$eval('#toggle-study-notes',e=>e.getAttribute('aria-expanded')),'true');
 assert.ok(await p.$eval('#study-note',e=>e.checkVisibility()&&e.textContent.length>20));
 assert.deepEqual(await p.evaluate(()=>{const g=window.__app.game,s=g.state.players[g.net.id];return [s.x,s.y,s.z];}),notesPose,'Reading notes with Space does not ascend');
 await p.screenshot({path:`${out}/07-field-notes.png`});await p.keyboard.press('Enter');
 assert.equal(await p.$eval('#study-notes',e=>e.hidden),true);
 const subject=await p.evaluate(()=>{const c=window.__app.game.naturalist.candidate;return {type:c.sample.type,id:c.sample.id,apparent:c.apparent};});
 const opticsPose=await p.evaluate(()=>{const g=window.__app.game,s=g.state.players[g.net.id];return [s.x,s.y,s.z,g.yaw,g.pitch];});
 await p.mouse.move(1050,550);await p.mouse.wheel({deltaY:-2000});
 await p.waitForFunction(()=>window.__app.game.naturalist.lens.value===3);
 assert.ok(await p.evaluate(()=>window.__app.camera.fov<26));
 assert.deepEqual(await p.evaluate(()=>{const g=window.__app.game,s=g.state.players[g.net.id];return [s.x,s.y,s.z,g.yaw,g.pitch];}),opticsPose,'Optical zoom never moves or turns the diver');
 await p.waitForFunction(id=>window.__app.game.naturalist.candidate?.sample.id===id,{},subject.id);
 assert.ok(await p.evaluate(()=>window.__app.game.naturalist.candidate.apparent)>subject.apparent*2.5,'The actual observed animal occupies more pixels');
 const yaw=await p.evaluate(()=>window.__app.game.yaw);await p.mouse.down();await p.mouse.move(1080,550,{steps:3});await p.mouse.up();
 assert.ok(Math.abs(await p.evaluate(()=>window.__app.game.yaw)-yaw+.04)<.005,'Magnified aiming has proportionally finer sensitivity');
 await p.mouse.down();await p.mouse.move(1050,550,{steps:3});await p.mouse.up();
 await p.click('#study-zoom-out');await p.waitForFunction(()=>window.__app.game.naturalist.lens.value===2.5);
 await p.click('#study-zoom-reset');await p.waitForFunction(()=>window.__app.camera.fov===68);
 await p.click('#study-zoom-in');await p.waitForFunction(()=>window.__app.game.naturalist.lens.value===1.5);
 await p.keyboard.press('o');await p.waitForFunction(()=>window.__app.camera.fov===68&&!window.__app.game.naturalist.open);
 await p.keyboard.press('o');await p.mouse.move(1050,550);await p.mouse.wheel({deltaY:-2000});await p.waitForFunction(()=>window.__app.game.naturalist.lens.value===3);
 await p.waitForSelector('#photograph-wildlife:enabled');
 await p.keyboard.press('p');await p.waitForFunction(()=>document.getElementById('photo-status').textContent.includes('Photo saved'));
 const first=await p.evaluate(type=>{const n=window.__app.game.naturalist;return {at:n.photoAt,photo:n.photos.get(type)};},subject.type);
 await p.waitForSelector('#photograph-wildlife:enabled');assert.equal(await p.$eval('#photograph-wildlife',e=>e.textContent),'Retake photo');
 const pose=await p.evaluate(()=>{const g=window.__app.game,s=g.state.players[g.net.id];return [s.x,s.y,s.z,g.yaw,g.pitch];});
 await p.click('#photograph-wildlife');await p.waitForFunction(at=>window.__app.game.naturalist.photoAt>at,{},first.at);
 assert.notEqual(await p.evaluate(type=>window.__app.game.naturalist.photos.get(type),subject.type),first.photo,'Retaking replaces the previous photograph');
 assert.deepEqual(await p.evaluate(()=>{const g=window.__app.game,s=g.state.players[g.net.id];return [s.x,s.y,s.z,g.yaw,g.pitch];}),pose,'Photography never moves the diver or camera');
 await p.screenshot({path:`${out}/01-photographed.png`});
 await p.keyboard.press('j');await p.waitForSelector('#crew-journal[open] .journal-photo img');
 assert.equal(await p.$eval('#crew-naturalist',e=>getComputedStyle(e).visibility),'hidden','Observation annotations yield to an open notebook');
 const modalPhotoAt=await p.evaluate(()=>window.__app.game.naturalist.photoAt);
 await p.keyboard.press('p');
 assert.equal(await p.evaluate(()=>window.__app.game.naturalist.photoAt),modalPhotoAt,'The photo shortcut is isolated by the journal');
 await p.mouse.move(1300,600);await p.mouse.wheel({deltaY:1000});assert.equal(await p.evaluate(()=>window.__app.game.naturalist.lens.target),3,'Journal scrolling cannot change the lens behind it');
 const photograph=await p.$eval('#crew-journal .journal-photo img',async img=>{
   await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
   const data=ctx.getImageData(0,0,c.width,c.height).data;let sum=0,square=0;for(let i=0;i<data.length;i+=4){const v=(data[i]+data[i+1]+data[i+2])/3;sum+=v;square+=v*v;}
   const n=data.length/4;return {width:img.naturalWidth,height:img.naturalHeight,length:img.src.length,variance:square/n-(sum/n)**2,alt:img.alt};
 });
 assert.equal(photograph.width,480);assert.equal(photograph.height,360);assert.ok(photograph.length<=48000&&photograph.variance>20,'A real nonblank world photograph is saved');
 await p.screenshot({path:`${out}/02-journal.png`});
 const file=path.join(out,`kestrel-${subject.type}.jpg`);await fs.rm(file,{force:true});
 await p.click('#crew-journal .journal-photo a');
 for(let i=0;i<30;i++){try{await fs.stat(file);break;}catch{await sleep(100);}}
 const bytes=await fs.readFile(file);assert.equal(bytes[0],255);assert.equal(bytes[1],216);
 assert.equal(bytes.toString('base64'),await p.$eval('#crew-journal .journal-photo img',e=>e.src.split(',')[1]));
 const layouts=[];for(const width of [600,390]){
   await p.setViewport({width,height:800});await sleep(200);
   const r=await p.$eval('#crew-journal .journal-photo',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
   assert.ok(r.left>=0&&r.right<=width);layouts.push({viewportWidth:width,...r});await p.screenshot({path:`${out}/03-journal-${width}.png`});
 }
 await p.keyboard.press('Escape');await p.reload();await boot();await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.net.ready);await p.keyboard.press('j');
 await p.waitForSelector('#crew-journal[open] .journal-photo img');assert.equal(await p.$eval('#crew-journal .journal-photo img',e=>e.src.length),photograph.length);
 await p.setViewport({width:390,height:800,hasTouch:true});await boot();await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.lastMode==='diver');
 await p.keyboard.press('o');await p.tap('#study-zoom-in');await p.waitForFunction(()=>window.__app.game.naturalist.lens.value===1.5);
 const touchTargets=await p.$$eval('#crew-naturalist button',buttons=>buttons.filter(e=>e.checkVisibility()).map(e=>({id:e.id,height:e.getBoundingClientRect().height})));
 assert.ok(touchTargets.every(e=>e.height>=44),'Every visible observation button has a 44 px touch height');
 const touchStudy=await studyRect();studyLayouts.push(touchStudy);assert.ok(touchStudy.left>=0&&touchStudy.right<=390&&touchStudy.bottom<360,'The touch study card leaves the central view clear');
 await p.tap('#toggle-study-notes');assert.equal(await p.$eval('#study-notes',e=>e.hidden),false);
 const expandedTouch=await studyRect();assert.ok(expandedTouch.bottom<await p.$eval('.ship-console',e=>e.getBoundingClientRect().top)-50,'Expanded notes leave swimming controls clear');
 await p.screenshot({path:`${out}/08-touch-notes.png`});await p.tap('#toggle-study-notes');
 await p.screenshot({path:`${out}/05-touch-optics.png`});await p.tap('#study-zoom-reset');await p.waitForFunction(()=>window.__app.camera.fov===68);
 await p.tap('#study-zoom-in');await p.waitForFunction(()=>window.__app.game.naturalist.lens.value===1.5);await p.keyboard.press('Home');await p.waitForFunction(()=>window.__app.camera.fov===68);
 // Use native secondary touch for the shutter while a swimming thumb is held.
 // Home changes the camera before the throttled wildlife scan refreshes its button.
 await sleep(350);
 for(let n=0;n<12&&await p.$eval('#photograph-wildlife',e=>e.disabled);n++){
   await p.evaluate(n=>{const g=window.__app.game;g.yaw=n*Math.PI/6;g.pitch=-.25;},n);await sleep(2200);
 }
 await p.waitForSelector('#photograph-wildlife:enabled');
 const touchSession=await p.createCDPSession();
 const center=selector=>p.$eval(selector,e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
 const stick=await center('#touch-stick'),thumb={id:1,x:stick.x,y:stick.y-12};
 const swimmerIdentity=await p.evaluate(()=>{const g=window.__app.game;return {room:g.net.room,id:g.net.id};});
 const swimmer=app.rooms.get(swimmerIdentity.room).world.players[swimmerIdentity.id];
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...thumb,y:stick.y}]});
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[thumb]});
 for(let n=0;n<40&&!(swimmer.input.forward>.1);n++) await sleep(50);
 assert.ok(swimmer.input.forward>.1,'The server receives swimming before the second finger touches the shutter');
 await p.waitForSelector('#photograph-wildlife:enabled',{timeout:3000});
 const heldPhotoAt=await p.evaluate(()=>window.__app.game.naturalist.photoAt),shutter={id:2,...await center('#photograph-wildlife')};
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[shutter]});
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[shutter]});
 await p.waitForFunction(at=>window.__app.game.naturalist.photoAt>at,{},heldPhotoAt);
 assert.ok(swimmer.input.forward>.1&&await p.evaluate(()=>window.__app.game.touch.pointer!==null),'A second-finger photograph leaves the swimming thumb active');
 assert.match(await p.$eval('#photo-status',e=>e.textContent),/Photo saved/);
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[thumb]});
 await p.waitForFunction(()=>window.__app.game.touch.pointer===null);
 const finalPhoto=await p.evaluate(type=>window.__app.game.naturalist.photoFor(type),subject.type);
 await p.goto(`${base}/?mode=explore&site=reef&preset=low&adaptive=0`);await boot();await p.click('#dive-observe');await p.click('#watch-journal');
 await p.waitForSelector('.field-journal[open] .journal-photo img');assert.equal(await p.$eval('.field-journal .journal-photo img',e=>e.src),finalPhoto);
 await p.screenshot({path:`${out}/04-explorer-journal.png`});assert.deepEqual(errors,[]);
 const result={recordedAt:new Date().toISOString(),secondaryTouchPhoto:true,subject,photograph,downloadBytes:bytes.length,layouts,studyLayouts,touchTargets,checks:['compact study and optional notes','keyboard notes do not swim','touch notes leave controls clear','actual rendered animal','smooth optical magnification','scaled drag sensitivity','wheel and touch zoom controls','close and Home restore normal view','dialog scroll and photo shortcut isolation','keyboard photo capture after render','annotations yield to journal','retake without camera or diver movement','downloaded JPEG matches journal','reload persistence','shared exploration journal'],errors};
 await fs.writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
 console.error('Photo-flow failure',JSON.stringify({errors,state:await p.evaluate(()=>{const g=window.__app?.game;return {mode:g?.lastMode,study:g?.naturalist.open,dialog:g?.dialogOpen(),activity:g?.activities.dialog.open,notes:document.getElementById('study-notes')?.hidden};}).catch(()=>null)}));
 await p.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error;
}finally{await browser.close();await app.stop();}
