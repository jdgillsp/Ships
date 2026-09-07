import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { createGameServer } from '../server/index.mjs';
const reference=process.argv[process.argv.indexOf('--reference')+1];
if(!process.argv.includes('--reference')||!reference)throw new Error('Pass --reference with a saved pre-change Clouds.js for the A/B comparison.');
const oldSource=await fs.readFile(reference,'utf8');
const oldShader=oldSource.split('const CLOUD_UPSAMPLE_FRAG = /* glsl */ `')[1].split('`;')[0];
const app=createGameServer();app.server.listen(0,'127.0.0.1');await new Promise(r=>app.server.once('listening',r));
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0,proxy:{'/api':`http://127.0.0.1:${app.server.address().port}`}}});await vite.listen();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:800}});
const p=await browser.newPage(),errors=[],out='tools/shots/cloud-motion-filter-review';await fs.mkdir(out,{recursive:true});
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await p.goto(vite.resolvedUrls.local[0]+'?mode=expedition&preset=low&adaptive=0');await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
 await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.lastMode==='deck');
 const frame=await p.evaluate(()=>window.__app.frame);await p.waitForFunction(f=>window.__app.frame>f+64,{},frame);
 await p.mouse.move(400,350);await p.mouse.down();await p.mouse.move(220,200,{steps:20});await p.mouse.up();
 await p.screenshot({path:`${out}/01-live.png`});
 const state=await p.evaluate(async old=>{
   const a=window.__app;a.running=false;a.game.net.close();document.getElementById('game').style.display='none';
   const {FullScreenPass}=await import('/src/gfx/FullScreenPass.js');const c=a.clouds,pass=c.upsamplePass;
   const {DataUtils}=await import('/node_modules/three/build/three.module.js');
   const previous=new FullScreenPass(old,pass.uniforms);
   const show=new FullScreenPass('uniform sampler2D src;in vec2 vUv;out vec4 color;void main(){vec4 c=texture(src,vUv);color=vec4(pow(max(vec3(0),c.rgb+vec3(.08,.2,.35)*c.a),vec3(1./2.2)),1.);}',{src:{value:c.screenTexture}});
   window.cloudReview={a,c,pass,previous,show};
   window.showCloud=name=>{(name==='before'?previous:pass).render(a.renderer,c.fullRT);show.render(a.renderer);};
   const raw=new Uint16Array(c.lowW*c.lowH*4);a.renderer.readRenderTargetPixels(c.history.read,0,0,c.lowW,c.lowH,raw);let cloudy=0;for(let i=3;i<raw.length;i+=4)if(DataUtils.fromHalfFloat(raw[i])<.98)cloudy++;
   return {cloudFraction:cloudy/(c.lowW*c.lowH),strength:pass.uniforms.uSharpen.value,interleave:c.interleave,resolution:[c.fullW,c.fullH],source:[c.lowW,c.lowH]};
 },oldShader);
 for(const name of ['before','after']){await p.evaluate(n=>window.showCloud(n),name);await p.screenshot({path:`${out}/${name}.png`});}
 const timing=await p.evaluate(async()=>{
   const {a,c,pass,previous}=window.cloudReview,gl=a.renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return {available:false};
   for(let i=0;i<8;i++){previous.render(a.renderer,c.fullRT);pass.render(a.renderer,c.fullRT);}gl.finish();
   const samples={before:[],after:[]};
   for(let i=0;i<24;i++)for(const name of i%2?['after','before']:['before','after']){
     const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);(name==='before'?previous:pass).render(a.renderer,c.fullRT);gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush();
     while(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))await new Promise(r=>setTimeout(r,10));
     if(!gl.getParameter(ext.GPU_DISJOINT_EXT))samples[name].push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);
   }
   return Object.fromEntries(Object.entries(samples).map(([name,v])=>{v.sort((a,b)=>a-b);return [name,{median:v[Math.floor(v.length/2)],p95:v[Math.floor(v.length*.95)],samples:v.length}];}));
 });
 assert.ok(state.cloudFraction>.05,'The camera must face visible clouds');assert.ok(state.strength>.05,'The actual moving camera must activate motion filtering');assert.deepEqual(errors,[]);
 const result={state,timing,errors};await fs.writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await vite.close();await app.stop();}
