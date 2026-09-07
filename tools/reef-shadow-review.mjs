import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';
const oldSource=await fs.readFile('.qa/reef-shadow-before.js','utf8');
const oldShader=oldSource.slice(oldSource.indexOf('float reefShadow('),oldSource.indexOf('float hash31('));
const app=createGameServer({...simulation,addPlayer(w,id,name){const p=simulation.addPlayer(w,id,name);Object.assign(p,{mode:'diver',x:-140,z:140,y:oceanFloor(-140,140,simulation.RECIPE)+6});return p;}});
app.server.listen(0,'127.0.0.1');await new Promise(r=>app.server.once('listening',r));
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0,proxy:{'/api':`http://127.0.0.1:${app.server.address().port}`}}});await vite.listen();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:800}});
const p=await browser.newPage(),errors=[],out='tools/shots/reef-shadow-review';await fs.mkdir(out,{recursive:true});
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await p.goto(vite.resolvedUrls.local[0]+'?mode=expedition&preset=high&adaptive=0');await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
 await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.lastMode==='diver'&&window.__app.game.net.ready);
 await p.evaluate(()=>{const g=window.__app.game;g.yaw=0;g.pitch=-.25;});
 const frame=await p.evaluate(()=>window.__app.frame);await p.waitForFunction(f=>window.__app.frame>f+20,{},frame);
 const state=await p.evaluate(async old=>{
  const a=window.__app,{U}=await import('/src/core/SharedUniforms.js');a.running=false;a.paused=true;a.game.net.close();a.beforeUpdate=null;a.afterUpdate=null;document.getElementById('game').style.display='none';
  const records=[],variants=new Map();a.underwater.scene.traverse(o=>{const m=o.material;if(!m?.fragmentShader?.includes('float reefShadow('))return;
   if(!variants.has(m)){const start=m.fragmentShader.indexOf('float reefShadow('),end=m.fragmentShader.indexOf('float hash31(');const before=m.clone(),none=m.clone();before.uniforms=none.uniforms=m.uniforms;
    before.fragmentShader=m.fragmentShader.slice(0,start)+old+m.fragmentShader.slice(end);none.fragmentShader=m.fragmentShader.slice(0,start)+'float reefShadow(vec3 w,vec3 n){return 1.;}\n'+m.fragmentShader.slice(end);variants.set(m,{before,after:m,none});}
   records.push([o,variants.get(m)]);
  });
  window.reefReview={a,U,records};window.reefVariant=name=>{for(const [o,m]of records)o.material=m[name];};
  window.reefShow=(name,condition)=>{
   const weather={day:{sunElevation:.55,cloudCoverage:.35,storm:0},golden:{sunElevation:.07,cloudCoverage:.35,storm:0},storm:{sunElevation:.25,cloudCoverage:.98,storm:1},night:{sunElevation:-.25,cloudCoverage:.2,storm:0}}[condition];
   a.weather.set(weather,true);a.weather.update(0);a.game.diveLight.mode=condition==='night'?'on':'off';a.game.diveLight.level=condition==='night'?1:0;
   a.afterUpdate=()=>{a.game.diveLight.update(0);a.post.settings.fixedExposureMix=1;a.post.settings.fixedExposure=2.6;};
   window.reefVariant(name);a.frame=32;a.post.reset=true;a.clouds.reset=true;a.underwater.shadowDirty=true;for(let i=0;i<12;i++)a.render(0);
   return{mode:U.uUnderwaterShadowMode.value,shadowSize:a.underwater.shadowTarget.width,resolution:[a.renderWidth,a.renderHeight]};
  };
  return{materials:variants.size,objects:records.length,position:a.camera.position.toArray()};
 },oldShader);
 const scalesOnly=process.argv.includes('--scales');
 const conditions=[];for(const condition of (scalesOnly?[]:['day','golden','storm','night']))for(const variant of ['before','after',...(condition==='day'?['none']:[])]){
  const result=await p.evaluate(({variant,condition})=>window.reefShow(variant,condition),{variant,condition});conditions.push({condition,variant,...result});await p.screenshot({path:`${out}/${condition}-${variant}.png`});
 }
 await p.evaluate(()=>window.reefShow('after','day'));
 const timing=scalesOnly?null:await p.evaluate(async()=>{
  const {a}=window.reefReview,r=a.renderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return{available:false};
  const draw=()=>{r.setRenderTarget(a.waterRT);r.clear();r.render(a.underwater.scene,a.camera);};
  for(let i=0;i<8;i++)for(const name of ['before','after']){window.reefVariant(name);draw();}gl.finish();const samples={before:[],after:[]};
  for(let i=0;i<16;i++)for(const name of i%2?['after','before']:['before','after']){window.reefVariant(name);const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);draw();gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush();
   while(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))await new Promise(r=>setTimeout(r,10));
   if(!gl.getParameter(ext.GPU_DISJOINT_EXT))samples[name].push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);
  }
  return Object.fromEntries(Object.entries(samples).map(([name,v])=>{v.sort((a,b)=>a-b);return[name,{median:v[Math.floor(v.length/2)],p95:v[Math.floor(v.length*.95)],samples:v.length}];}));
 });
 const scales=[];if(scalesOnly)for(const height of [2,200,1000]){
  const result=await p.evaluate(height=>{const {a}=window.reefReview;a.afterUpdate=null;Object.assign(a.post.settings,a.game.diveLight.surfaceExposure);a.camera.position.set(-140,height,140-height*.2);a.camera.lookAt(-140,-25,180);a.camera.updateMatrixWorld();a.post.reset=a.clouds.reset=true;for(let i=0;i<16;i++)a.render(0);return{height,position:a.camera.position.toArray(),error:a.renderer.getContext().getError()};},height);
  scales.push(result);assert.equal(result.error,0);await p.screenshot({path:`${out}/scale-${height}.png`});
 }
 assert.ok(state.materials>0);assert.deepEqual(errors,[]);const result={state,conditions,scales,timing,errors};await fs.writeFile(`${out}/${scalesOnly?'scales':'result'}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await vite.close();await app.stop();}
