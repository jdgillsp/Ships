import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app=createGameServer();app.server.listen(0,'127.0.0.1');await new Promise(r=>app.server.once('listening',r));
const base=`http://127.0.0.1:${app.server.address().port}`,out='tools/shots/footsteps';await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist'],defaultViewport:{width:1280,height:800}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await useExpandedTools(p); await p.goto(`${base}/?mode=expedition&preset=low&adaptive=0`);await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});
 assert.equal(await p.evaluate(()=>!!window.__app.game.sound.context),false);
 await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.lastMode==='deck');
 await p.keyboard.press('h');await p.waitForFunction(()=>window.__app.game.lastMode==='helm');await p.keyboard.press('c');
 await p.click('#sound');await p.waitForFunction(()=>window.__app.game.sound.context?.state==='running');
 const room=await p.evaluate(()=>window.__app.game.net.room);
 const post=async(path,body,token)=>{const r=await fetch(`${base}/api/rooms/${room}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});assert.ok(r.ok);return r.json();};
 const peer=await post('join',{name:'Rowan'});await p.waitForFunction(id=>window.__app.game.state.players[id]?.connected,{},peer.id);
 await p.evaluate(()=>{const s=window.__app.game.sound,original=s.noiseCue;window.footfalls=[];s.noiseCue=function(duration,strength,cutoff,pan){if(cutoff===240&&pan!=null)window.footfalls.push({pan,strength});return original.call(this,duration,strength,cutoff,pan);};});
 const walk=async(forward,duration=1200)=>{const end=Date.now()+duration;while(Date.now()<end){await post('input',{forward,walkYaw:0},peer.token);await sleep(80);}await post('input',{},peer.token);await sleep(250);};
 await walk(1);const right=await p.evaluate(()=>window.footfalls.splice(0));assert.ok(right.length>=2&&right.every(c=>c.pan>0&&c.strength<.07),'A crewmate walking to the right produces quiet right-hand footsteps');
 await p.mouse.move(100,400);await p.mouse.down();await p.mouse.move(885,400,{steps:8});await p.mouse.up();
 await p.waitForFunction(()=>Math.abs(window.__app.game.orbit)>2.7);
 await walk(1,700);const left=await p.evaluate(()=>window.footfalls.splice(0));assert.ok(left.length>=1&&left.every(c=>c.pan<0),'Turning the view reverses the perceived direction');
 await p.click('#sound');await walk(-1);assert.equal(await p.evaluate(()=>window.footfalls.length),0,'Muted walking cannot queue sounds');
 await p.click('#sound');await sleep(400);assert.equal(await p.evaluate(()=>window.footfalls.length),0,'Unmuting at rest cannot replay walking');
 await p.keyboard.press('v');await p.waitForFunction(()=>window.__app.game.lastMode==='diver');await walk(-1);assert.equal(await p.evaluate(()=>window.footfalls.length),0,'Deck footsteps do not enter the diver soundscape');
 const audio=await p.evaluate(async()=>{
  const s=window.__app.game.sound;
  const render=async(pan,volume,strength=.07)=>{
   const context=new OfflineAudioContext(2,4800,48000),master=context.createGain();master.gain.value=volume;master.connect(context.destination);
   Object.getPrototypeOf(s).noiseCue.call({context,ambient:{master,noise:s.ambient.noise}},.075,strength,240,pan);
   const buffer=await context.startRendering();return [0,1].map(channel=>{const values=buffer.getChannelData(channel);return Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);});
  };
  return {left:await render(-.85,1),right:await render(.85,1),center:await render(0,1),half:await render(0,.5),quiet:await render(0,1,.0175),muted:await render(.85,0)};
 });
 assert.ok(audio.left[0]>audio.left[1]*4&&audio.right[1]>audio.right[0]*4,'Rendered footsteps pan into the expected speaker');
 assert.ok(audio.center[0]>.0001&&Math.abs(audio.center[0]-audio.center[1])<1e-8);
 assert.ok(Math.abs(audio.half[0]/audio.center[0]-.5)<1e-5&&Math.abs(audio.quiet[0]/audio.center[0]-.25)<1e-5,'Volume and distance gains scale the real waveform');
 assert.deepEqual(audio.muted,[0,0]);assert.deepEqual(errors,[]);
 const result={right,left,audio,noReplay:true,noDiveSteps:true,errors};await fs.writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await app.stop();}
