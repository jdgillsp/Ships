import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { createGameServer } from '../server/index.mjs';
const app=createGameServer();app.server.listen(0,'127.0.0.1');await new Promise(r=>app.server.once('listening',r));
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0,proxy:{'/api':`http://127.0.0.1:${app.server.address().port}`}}});await vite.listen();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:800}});
const p=await browser.newPage(),errors=[],out='tools/shots/quality-work';await fs.mkdir(out,{recursive:true});
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await p.goto(vite.resolvedUrls.local[0]+'?mode=expedition&preset=low&adaptive=0');await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
 await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.lastMode==='deck');await p.keyboard.press('h');
 assert.ok(await p.evaluate(()=>!!window.__app.frameTiming.ext),'The GPU comparison requires the actual timer extension');
 const results={};
 for(const mode of ['cadence','measured']){
   await p.evaluate(async mode=>{
     const a=window.__app;a.quality.adaptive=false;a.setQualityPreset('high');a.quality.resetTiming();
     window.originalWorkMs??=a.frameTiming.workMs.bind(a.frameTiming);
     a.frameTiming.workMs=mode==='cadence'?(ms=>ms):window.originalWorkMs;
     for(let i=0;i<16;i++)await new Promise(requestAnimationFrame);
     a.quality.adaptive=true;
   },mode);
   results[mode]=await p.evaluate(async()=>{
     const a=window.__app,rows=[];
     for(let i=0;i<100;i++){
       await new Promise(requestAnimationFrame);
       if(i>=20)rows.push({cadence:a.frameMs,cpu:a.frameTiming.cpuMs,gpu:a.frameTiming.latest?.gpuMs??null,work:a.frameTiming.workMs(a.frameMs)});
     }
     const med=key=>{const v=rows.map(r=>r[key]).filter(Number.isFinite).sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
     return {preset:a.quality.presetName,scale:a.quality.dynamicScale,effectiveScale:a.quality.effectiveScale,frameMs:med('cadence'),cpuMs:med('cpu'),gpuMs:med('gpu'),workMs:med('work'),samples:rows.length,pending:a.frameTiming.pending.length};
   });
   await p.screenshot({path:`${out}/${mode}.png`});
 }
 const compatibility=await p.evaluate(async()=>{
   const a=window.__app;a.profiler.enabled=true;
   for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);
   const profile={pending:a.frameTiming.pending.length,active:!!a.frameTiming.active,error:a.renderer.getContext().getError(),zones:a.profiler.report().zones.length};
   a.profiler.enabled=false;a.quality.adaptive=false;
   for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);
   return {profile,manual:{pending:a.frameTiming.pending.length,active:!!a.frameTiming.active}};
 });
 assert.ok(results.measured.gpuMs>=0&&results.measured.cpuMs>0);assert.ok(results.measured.pending<=6);
 if(results.measured.frameMs>results.measured.workMs*2)
   assert.ok(results.measured.effectiveScale>results.cadence.effectiveScale,'Browser scheduling must not destroy otherwise affordable image detail');
 assert.equal(compatibility.profile.error,0);assert.ok(compatibility.profile.zones>0);assert.equal(compatibility.profile.pending,0);assert.equal(compatibility.profile.active,false);
 assert.equal(compatibility.manual.pending,0);assert.equal(compatibility.manual.active,false);assert.deepEqual(errors,[]);
 const result={results,compatibility,errors};await fs.writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await vite.close();await app.stop();}
