import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0}});await vite.listen();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist']});
try {const p=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'||(m.type()==='warn'&&/Shader|Program Info Log/.test(m.text())))errors.push(m.text());});
await p.goto(vite.resolvedUrls.local[0]+'tools/fixtures/vessel-stability.html');await p.waitForFunction(()=>window.ready,{timeout:30000});
const crew=await p.evaluate(()=>window.runCrewOcclusion());console.log('Crew visibility',JSON.stringify(crew));
assert.ok(!(crew.overlap.visible&&crew.overlap.inside),'Helm handoff places a visible crewmate helmet inside the deck camera');
assert.equal(crew.nearby,true,'A nearby crewmate remains visible outside the camera');
assert.deepEqual(crew.chase,[true,true,false,false],'Chase view still shows both crew members');
assert.deepEqual(crew.submerged,{visible:false,waterVisible:false},'Overlapping divers cannot obscure either side of the waterline');
const result=await p.evaluate(()=>window.runFrames(false));console.log(JSON.stringify({result,errors}));

assert.deepEqual(errors,[]);assert.ok(result.maxChanged<160,`Rigid ship/camera translation flickers: ${result.maxChanged} pixels changed brightness by >20/255 (limit 160)`);
assert.ok(result.maxMotion<.05,`A ship stationary on screen reports ${result.maxMotion.toFixed(2)} pixels of motion, causing incorrect temporal reprojection`);
const moving=await p.evaluate(()=>window.runFrames(false,false));assert.ok(moving.maxMotion>1,'Motion vectors must retain actual ship movement');console.log('PASS: stable shadows and correct moving-object reprojection');
const lit=await p.evaluate(()=>window.runFrames(false,true,true));assert.ok(lit.lightLevel>=.85);assert.ok(lit.maxChanged<160&&lit.maxMotion<.05,'Active work lights remain fixed to the moving ship');console.log('Work-light stability',JSON.stringify(lit));
}finally{await browser.close();await vite.close();}
