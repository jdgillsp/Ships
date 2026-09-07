import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createGameServer} from '../server/index.mjs';
const {server}=createGameServer();server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/`,out='tools/shots/deck';await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=d3d11','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],defaultViewport:{width:1280,height:800}});
const errors=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function open(url){const c=await browser.createBrowserContext(),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await useExpandedTools(p); await p.goto(url);await p.waitForFunction(()=>window.__app?.running&&!document.getElementById('boot'),{timeout:120000});await p.click('#start-expedition');await p.waitForFunction(()=>window.__app.game.net.ready);return p;}
async function action(p,name){await p.click(`[data-action="${name}"]:not(:disabled):not([hidden])`);await sleep(350);}
try{
 const a=await open(base+'?mode=expedition&preset=low&adaptive=0');const room=await a.evaluate(()=>window.__app.game.net.room);
 const b=await open(base+`?mode=expedition&room=${room}&preset=low&adaptive=0`);const id=await b.evaluate(()=>window.__app.game.net.id);
 console.log('Two crew connected');
 const start=await b.evaluate(()=>{const g=window.__app.game;return g.state.players[g.net.id].deckZ;});
 await b.keyboard.down('w');await sleep(700);await b.keyboard.up('w');
 await b.waitForFunction(z=>{const g=window.__app.game;return g.state.players[g.net.id].deckZ>z+1;},{timeout:10000},start);
 await a.waitForFunction(({id,start})=>window.__app.game.state.players[id].deckZ>start+1,{timeout:10000},{id,start});
 assert.equal(await b.evaluate(()=>window.__app.game.view),'deck');
 assert.ok(await b.$eval('#controls',el=>el.textContent.includes('walk')));
 await b.screenshot({path:out+'/01-walking.png'});await b.keyboard.press('c');await sleep(500);await b.screenshot({path:out+'/02-crew-on-deck.png'});
 console.log('Walking is synchronized');
 await action(a,'helm');await action(a,'anchor');
 const local=await b.evaluate(()=>{const g=window.__app.game,p=g.state.players[g.net.id];return {x:p.deckX,z:p.deckZ,worldX:p.x,worldZ:p.z};});
 await a.keyboard.down('w');await a.keyboard.down('d');await sleep(2500);await a.keyboard.up('w');await a.keyboard.up('d');
 const riding=await b.evaluate(()=>{const g=window.__app.game,p=g.state.players[g.net.id];return {x:p.deckX,z:p.deckZ,worldX:p.x,worldZ:p.z};});
 assert.ok(Math.hypot(riding.worldX-local.worldX,riding.worldZ-local.worldZ)>2);assert.equal(riding.x,local.x);assert.equal(riding.z,local.z);
 assert.equal(await b.$eval('[data-action="helm"]',el=>el.disabled),true);
 assert.equal(await b.$eval('[data-action="dive"]',el=>el.disabled),true);
 assert.ok(await b.$eval('[data-action="dive"]',el=>el.textContent.includes('slow down')));
 await action(b,'anchor');await b.waitForFunction(()=>Math.abs(window.__app.game.state.ship.speed)<1);
 await action(b,'dive');await b.waitForFunction(()=>{const g=window.__app.game;return g.state.players[g.net.id].mode==='diver';});
 await action(b,'board');await b.waitForFunction(()=>{const g=window.__app.game;return g.state.players[g.net.id].mode==='deck';});
 await b.keyboard.down('w');await sleep(600);await b.keyboard.up('w');
 assert.ok(await b.evaluate(()=>{const g=window.__app.game;return g.state.players[g.net.id].deckZ>-5; }));
 await action(a,'leaveHelm');await action(b,'helm');
 await a.waitForFunction(id=>window.__app.game.state.ship.pilot===id,{},id);
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/result.json',JSON.stringify({passed:true,checks:['walking synchronized','rides moving hull','occupied helm explained','dive speed explained','deck anchor','dive and board','walk after boarding','helm handoff'],errors},null,2));console.log('PASS: deck walking, crew actions and helm handoff');
}finally{await browser.close();server.closeAllConnections();server.close();}
