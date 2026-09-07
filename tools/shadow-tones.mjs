import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0}});await vite.listen();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist']});
try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto(vite.resolvedUrls.local[0]+'tools/fixtures/shadow-tones.html');await p.waitForFunction(()=>window.ready);
 const result=await p.evaluate(()=>window.probe());console.log(JSON.stringify({result,errors}));assert.deepEqual(errors,[]);assert.equal(result.error,0);
 for(const row of result.results){assert.ok(row.means[0].output<.005,'True black stays black');for(let i=row.tone===0?2:3;i<row.means.length;i++)assert.ok(row.means[i].output-row.means[i-1].output>.003,`Contrast ${row.contrast}, tone ${row.tone} loses shadow steps: ${JSON.stringify(row.means)}`);}
 for(const tone of [0,1]){const rows=result.results.filter(r=>r.tone===tone);assert.ok(Math.abs(rows[0].means[6].output-rows[1].means[6].output)<.001,'Contrast preserves middle-gray exposure');}
}finally{await browser.close();await vite.close();}
