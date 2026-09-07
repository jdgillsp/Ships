import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';
const app=createGameServer({...simulation,addPlayer(w,id,name){const p=simulation.addPlayer(w,id,name);Object.assign(p,{mode:'diver',x:-140,z:140,y:oceanFloor(-140,140,simulation.RECIPE)+6});return p;}});
app.server.listen(0,'127.0.0.1');await new Promise(r=>app.server.once('listening',r));
const vite=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0,proxy:{'/api':`http://127.0.0.1:${app.server.address().port}`}}});await vite.listen();
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:800}});
const p=await browser.newPage(),errors=[],out='tools/shots/night-fauna';await fs.mkdir(out,{recursive:true});
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await p.goto(vite.resolvedUrls.local[0]+'?mode=expedition&preset=high&adaptive=0');await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
 await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.lastMode==='diver'&&window.__app.game.net.ready);
 await p.evaluate(()=>{const g=window.__app.game;g.yaw=0;g.pitch=-.25;});
 const frame=await p.evaluate(()=>window.__app.frame);await p.waitForFunction(f=>window.__app.frame>f+20,{},frame);
 const state=await p.evaluate(async()=>{
  const a=window.__app,{U}=await import('/src/core/SharedUniforms.js');a.running=false;a.paused=true;a.game.net.close();a.beforeUpdate=null;a.afterUpdate=null;document.getElementById('game').style.display='none';
  const records=[],variants=new Map();a.underwater.scene.traverse(o=>{const m=o.material;if(!m?.fragmentShader?.includes('float reefShadow('))return;
   if(!variants.has(m)){const before=m.clone();before.uniforms=m.uniforms;before.fragmentShader=before.fragmentShader.replace('4.0+dist*dist*.045','1.0+dist*dist*.045').replace('exp(-uExtinction*dist/max(uClarity,.3))','vec3(1.0)');variants.set(m,{before,after:m});}
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
 });
 const conditions=[];for(const condition of ['night'])for(const variant of ['after']){
  const result=await p.evaluate(({variant,condition})=>window.reefShow(variant,condition),{variant,condition});conditions.push({condition,variant,...result});await p.screenshot({path:`${out}/${condition}-${variant}.png`});
 }
 const fauna=await p.evaluate(async()=>{
  const {a,records}=window.reefReview,{DataUtils}=await import('/node_modules/three/build/three.module.js');window.reefShow('after','night');
  const capture=document.createElement('canvas');capture.width=a.canvas.width;capture.height=a.canvas.height;const ctx=capture.getContext('2d');ctx.drawImage(a.canvas,0,0);const colors=ctx.getImageData(0,0,capture.width,capture.height).data;
  const masks=new Map();for(const[o,variants]of records){const m=variants.after;if(!masks.has(m)){const mask=m.clone();mask.uniforms=m.uniforms;mask.fragmentShader=mask.fragmentShader.replace('outColor = vec4(max(col,vec3(0.0)),packedAlpha);',`outColor=vec4(vec3(${m.uniforms.uKind?.value===4?'1.':'0.'}),1.);`);masks.set(m,mask);}o.material=masks.get(m);}
  a.renderer.setRenderTarget(a.waterRT);a.renderer.clear();a.renderer.render(a.underwater.scene,a.camera);const pixels=new Uint16Array(capture.width*capture.height*4);a.renderer.readRenderTargetPixels(a.waterRT,0,0,capture.width,capture.height,pixels);
  let count=0,bright=0,total=0;for(let y=0;y<capture.height;y++)for(let x=0;x<capture.width;x++){const i=(y*capture.width+x)*4;if(DataUtils.fromHalfFloat(pixels[i])<.9)continue;const j=((capture.height-1-y)*capture.width+x)*4,r=colors[j],g=colors[j+1],b=colors[j+2],l=.2126*r+.7152*g+.0722*b;count++;total+=l;if(l>225&&Math.max(r,g,b)-Math.min(r,g,b)<60)bright++;}
  window.reefVariant('after');for(const mask of masks.values())mask.dispose();
  a.game.diveLight.mode='off';a.game.diveLight.level=0;a.frame=32;a.post.reset=true;for(let i=0;i<12;i++)a.render(0);
  ctx.drawImage(a.canvas,0,0);const off=ctx.getImageData(0,0,capture.width,capture.height).data;let offTotal=0;
  for(let y=0;y<capture.height;y++)for(let x=0;x<capture.width;x++){if(DataUtils.fromHalfFloat(pixels[(y*capture.width+x)*4])<.9)continue;const j=((capture.height-1-y)*capture.width+x)*4;offTotal+=.2126*off[j]+.7152*off[j+1]+.0722*off[j+2];}
  return{count,bright,brightFraction:bright/count,mean:total/count,offMean:offTotal/count,error:a.renderer.getContext().getError()};
 });
 await p.screenshot({path:`${out}/night-off.png`});
 const timing=process.argv.includes('--profile')?await p.evaluate(async()=>{
  window.reefShow('after','night');
  const {a}=window.reefReview,r=a.renderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return{available:false};
  const draw=()=>{r.setRenderTarget(a.waterRT);r.clear();r.render(a.underwater.scene,a.camera);};
  for(let i=0;i<8;i++)for(const name of ['before','after']){window.reefVariant(name);draw();}gl.finish();const samples={before:[],after:[]};
  for(let i=0;i<16;i++)for(const name of i%2?['after','before']:['before','after']){window.reefVariant(name);const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);draw();gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush();
   while(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))await new Promise(r=>setTimeout(r,10));
   if(!gl.getParameter(ext.GPU_DISJOINT_EXT))samples[name].push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);
  }
  return Object.fromEntries(Object.entries(samples).map(([name,v])=>{v.sort((a,b)=>a-b);return[name,{median:v[Math.floor(v.length/2)],p95:v[Math.floor(v.length*.95)],samples:v.length}];}));
 }):null;
 assert.ok(state.materials>0);assert.deepEqual(errors,[]);const result={state,conditions,fauna,timing,errors};await fs.writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));assert.ok(fauna.count>1000,'Actual fish occupy the test view');assert.ok(fauna.brightFraction<.1,'Most animal surfaces retain headlamp detail instead of becoming near-white');assert.equal(fauna.error,0);assert.ok(fauna.mean>70&&fauna.mean>fauna.offMean+30,'Animals remain clearly illuminated by the lamp');
}finally{await browser.close();await vite.close();await app.stop();}
