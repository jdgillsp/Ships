import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
const app=createGameServer();app.server.listen(0,'127.0.0.1');await new Promise(r=>app.server.once('listening',r));
const base=`http://127.0.0.1:${app.server.address().port}`,out='tools/shots/deck-radio';await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1440,height:900}});
const p=await browser.newPage(),errors=[],checks=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await p.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
 await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.net.ready&&window.__app.game.lastMode==='deck');
 await p.keyboard.down('d');await p.waitForFunction(()=>{const g=window.__app.game;return g.state.players[g.net.id].deckX< -1.55;});await p.keyboard.up('d');
 await p.keyboard.down('w');await p.waitForSelector('#deck-radio:not([hidden]):enabled');await p.keyboard.up('w');
 await p.screenshot({path:`${out}/01-approach.png`});await p.keyboard.press('f');await p.waitForSelector('#crew-radio-dialog[open]');
 assert.match(await p.$eval('#radio-status',e=>e.textContent),/solo/);assert.equal(await p.$eval('#call-ready',e=>e.disabled),true);
 await p.keyboard.press('Escape');await p.waitForSelector('#crew-radio-dialog:not([open])');await p.waitForFunction(()=>document.activeElement.id==='deck-radio');checks.push('Walk up, open with F, solo explanation, visible focus return');
 const id=await p.evaluate(()=>{const n=window.__app.game.net;return{id:n.id,room:n.room};});const world=app.rooms.get(id.room).world;
 const post=async(path,body,token)=>{const r=await fetch(`${base}/api/rooms/${id.room}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});assert.ok(r.ok);return r.json();};
 const peer=await post('join',{name:'Rowan'});await post('action',{action:'helm'},peer.token);
 await p.waitForFunction(()=>document.getElementById('play-readout').textContent.includes('1 crewmate'));
 await p.focus('#deck-radio');await p.keyboard.press('Space');await p.waitForSelector('#crew-radio-dialog[open]');
 await p.keyboard.press('v');assert.equal(await p.evaluate(()=>window.__app.game.lastMode),'deck');
 await p.click('#call-ready');await p.waitForSelector('#crew-radio-dialog:not([open])');await p.waitForFunction(()=>window.__app.game.state.calls[window.__app.game.net.id]?.kind==='ready');
 assert.equal(world.ship.pilot,peer.id);const call=world.calls[id.id];await post('action',{action:'acknowledgeCall',owner:id.id,callId:call.id},peer.token);
 await p.waitForFunction(()=>document.getElementById('crew-call-banner').textContent.includes('Rowan: On it'));checks.push('Shared ready-to-dive call and acknowledgement preserve captain control');
 for(const width of [600,390]){await p.setViewport({width,height:800});await p.click('#deck-radio');await p.waitForSelector('#crew-radio-dialog[open]');
  const box=await p.$eval('#crew-radio-dialog',e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom};});assert.ok(box.left>=0&&box.right<=width&&box.bottom<=800);
  await p.screenshot({path:`${out}/02-radio-${width}.png`});await p.keyboard.press('Escape');await p.waitForSelector('#crew-radio-dialog:not([open])');}
 await p.keyboard.down('s');await p.waitForSelector('#deck-radio[hidden]');await p.keyboard.up('s');await p.keyboard.press('z');await p.waitForSelector('#crew-radio-dialog[open]');await p.keyboard.press('Escape');await p.waitForSelector('#crew-radio-dialog:not([open])');
 await p.waitForFunction(()=>document.activeElement.id==='play-tools');checks.push('Remote Z access and quiet-view focus remain usable');
 await p.setViewport({width:1440,height:900});await p.evaluate(async()=>{for(let i=0;i<16;i++)await new Promise(requestAnimationFrame);});
 await p.evaluate(()=>{
  const a=window.__app,g=a.game;a.running=false;a.paused=true;a.beforeUpdate=a.afterUpdate=null;g.net.close();g.root.hidden=true;
  window.radioScene=(condition='day',height=null)=>{
   const w={day:{sunElevation:.55,cloudCoverage:.35,storm:0},golden:{sunElevation:.07,cloudCoverage:.35,storm:0},storm:{sunElevation:.25,cloudCoverage:.98,storm:.9}}[condition];a.weather.set(w,true);a.weather.update(0);
   const ship=g.models.ship,v=(x,y,z)=>ship.localToWorld(a.camera.position.clone().set(x,y,z));
   a.camera.position.copy(v(-1.65,height??3.3,height?-height*.2:-1.5));a.camera.lookAt(v(-1.65,3,-.18));a.camera.fov=65;a.camera.updateProjectionMatrix();a.camera.updateMatrixWorld();a.post.reset=a.clouds.reset=true;for(let i=0;i<16;i++)a.render(0);
   return a.renderer.getContext().getError();
  };
 });
 for(const condition of ['day','golden','storm']){assert.equal(await p.evaluate(c=>window.radioScene(c),condition),0);await p.screenshot({path:`${out}/03-${condition}.png`});}
 for(const height of [200,1000]){assert.equal(await p.evaluate(h=>window.radioScene('day',h),height),0);await p.screenshot({path:`${out}/04-scale-${height}.png`});}
 const timing=await p.evaluate(async()=>{
  window.radioScene();const a=window.__app,r=a.renderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return null;
  const draw=()=>{r.setRenderTarget(a.hdrRT);r.clear();r.render(a.scene,a.camera);},values=[];for(let i=0;i<8;i++)draw();gl.finish();
  for(let i=0;i<16;i++){const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);draw();gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush();
   while(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))await new Promise(r=>setTimeout(r,10));
   if(!gl.getParameter(ext.GPU_DISJOINT_EXT))values.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);}
  values.sort((a,b)=>a-b);return{median:values[Math.floor(values.length/2)],p95:values[Math.floor(values.length*.95)],samples:values.length};
 });
 assert.deepEqual(errors,[]);const result={checks,timing,errors};await fs.writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await app.stop();}
