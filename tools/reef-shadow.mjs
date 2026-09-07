import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0}});await vite.listen();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:640,height:480}});
const reference=process.argv.includes('--reference');
const out=`tools/shots/reef-shadow/${reference?'before':'after'}`;await fs.mkdir(out,{recursive:true});const errors=[],probes=[];
try{
 const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 if(reference)await p.evaluateOnNewDocument(source=>window.referenceShader=source,await fs.readFile('.qa/reef-shadow-before.js','utf8'));
 await p.goto(vite.resolvedUrls.local[0]+'tools/fixtures/reef-shadow.html'+(reference?'?reference':''));await p.waitForFunction(()=>window.ready);
 for(const lamp of [false,true])for(const tilt of [0,.65,-.65])for(const occluder of [false,true]){
  const options={lamp,tilt,occluder,continuity:occluder&&tilt===0};const result=await p.evaluate(o=>window.probe(o),options);probes.push({...options,...result});
  if(tilt===0)await p.screenshot({path:`${out}/${lamp?'lamp':'sun'}-${occluder?'shadow':'clear'}.png`});
 }
 console.log(JSON.stringify({probes,errors}));await fs.writeFile(`${out}/result.json`,JSON.stringify({probes,errors},null,2));assert.deepEqual(errors,[]);
 for(const r of probes){assert.equal(r.error,0);if(!r.occluder)assert.ok(r.litFraction>.995,`Unobstructed receiver self-shadows: ${JSON.stringify(r)}`);else if(r.tilt===0){assert.ok(r.dark>100,'The block retains a real shadow');assert.ok(r.maxJump<.06,`Shadow changes in visible steps: ${r.maxJump}`);}}
}finally{await browser.close();await vite.close();}
