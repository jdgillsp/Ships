import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0}});await vite.listen();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist']});
try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto(vite.resolvedUrls.local[0]+'tools/fixtures/night-skylight.html');await p.waitForFunction(()=>window.ready);
 const result=await p.evaluate(()=>window.probe());console.log(JSON.stringify({result,errors}));assert.deepEqual(errors,[]);assert.equal(result.error,0);
 for(const pass of ['background','environment']){
  const night=result.values.filter(v=>v.night).map(v=>v[pass].mean);
  assert.ok(night[0]>.001,`${pass}: the night sky remains visible`);
  assert.ok(Math.max(...night)/Math.min(...night)<1.01,`${pass}: night radiance changes with solar intensity although the solar LUT is black`);
  const day=result.values.filter(v=>!v.night);
  for(const v of day)assert.ok(Math.abs(v[pass].mean/day[0][pass].mean/v.intensity-1)<.002,`${pass}: solar light still scales with sun intensity`);
 }

}finally{await browser.close();await vite.close();}
