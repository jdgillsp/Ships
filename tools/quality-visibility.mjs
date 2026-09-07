import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0}});
vite.middlewares.use('/__quality-visibility',(_req,res)=>res.end('<!doctype html><title>Quality visibility regression</title>'));
await vite.listen();const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.goto(vite.resolvedUrls.local[0]+'__quality-visibility');
 const result=await page.evaluate(async()=>{
   const {App}=await import('/src/core/App.js'),{Quality}=await import('/src/core/Quality.js');
   const nativeRAF=window.requestAnimationFrame;let callback,hidden=false;
   window.requestAnimationFrame=fn=>{callback=fn;return 1;};
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
   const app=new App(null);app.quality=new Quality('high');app.quality.onDowngrade=(name,scale)=>app.quality.setPreset(name,scale);
   let renders=0;const dt=[];app.render=delta=>{renders++;dt.push(delta);app.quality.tick(app.frameMs);};
   app.post={reset:false};app.clouds={reset:false};app.game={cameraSnap:false};app.start();let now=app._lastT;
   const frames=(n,ms)=>{for(let i=0;i<n;i++){now+=ms;callback(now);}};
   frames(180,1000/60);const before={preset:app.quality.presetName,scale:app.quality.dynamicScale,renders};
   hidden=true;document.dispatchEvent(new Event('visibilitychange'));frames(12,1000);
   const background={preset:app.quality.presetName,scale:app.quality.dynamicScale,renders};
   // Some browsers suspend RAF completely; the visible event must also cover
   // a long gap with no hidden callbacks at all.
   now+=120000;hidden=false;document.dispatchEvent(new Event('visibilitychange'));frames(1,1000/60);
   const resume={frameMs:app.frameMs,dt:dt.at(-1),post:app.post.reset,clouds:app.clouds.reset,camera:app.game.cameraSnap};
   frames(180,1000/60);const settled={preset:app.quality.presetName,scale:app.quality.dynamicScale};
   // Foreground overload must still trigger the existing rescue policy.
   frames(20,250);const overloaded={preset:app.quality.presetName,scale:app.quality.dynamicScale};
   app.running=false;window.requestAnimationFrame=nativeRAF;delete document.hidden;
   return {before,background,resume,settled,overloaded};
 });
 console.log(JSON.stringify(result));
 assert.equal(result.background.renders,result.before.renders,'A hidden tab must not render the ocean or train automatic quality');
 assert.deepEqual([result.settled.preset,result.settled.scale],['high',1],'Returning to the game must preserve healthy visual quality');
 assert.ok(result.resume.frameMs<20&&result.resume.dt<.02,'The return frame must exclude the hidden wall-clock gap');
 assert.ok(result.resume.post&&result.resume.clouds&&result.resume.camera,'Old temporal imagery must be discarded on return');
 assert.notEqual(result.overloaded.preset,'high','Real foreground overload still reduces quality');
}finally{await browser.close();await vite.close();}
