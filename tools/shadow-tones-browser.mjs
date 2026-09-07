import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/shadow-tones'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=high&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.lastMode === 'deck' && window.__app.game.net.ready);
  await p.keyboard.press('h'); await p.waitForFunction(() => window.__app.game.lastMode === 'helm'); await p.keyboard.press('c'); await p.keyboard.press('Home');
  await p.evaluate(async () => { for (let i = 0; i < 16; i++) await new Promise(requestAnimationFrame); });
  await p.screenshot({ path: `${out}/01-live-helm.png` });
  await p.evaluate(() => {
    const a = window.__app, g = a.game; a.running = false; a.paused = true; a.beforeUpdate = null; a.afterUpdate = null; g.net.close(); g.root.hidden = true;
    window.skyWorld = structuredClone(g.frameWorld);
    window.showSky = (bearing = 0, knots = 10, condition = 'day', height = null) => {
      const w = structuredClone(window.skyWorld), s = w.ship;
      s.heading = -bearing * Math.PI / 180; s.speed = knots / 1.944; s.pitch = s.roll = s.yawRate = 0;
      const weather = { day: { sunElevation: .55, cloudCoverage: .35, storm: 0 }, golden: { sunElevation: .07, cloudCoverage: .35, storm: 0 }, storm: { sunElevation: .25, cloudCoverage: .98, storm: .9 }, night: { sunElevation: -.25, cloudCoverage: .2, storm: 0 }, dusk: { sunElevation: .01, cloudCoverage: .35, storm: 0 }, twilight: { sunElevation: -.04, cloudCoverage: .35, storm: 0 }, automatic: { sunElevation: -.25, cloudCoverage: .2, storm: 0 } }[condition];
      a.weather.set(weather, true); a.weather.update(0); g.models.update(w, g.net.id, 'deck');
      Object.assign(a.post.settings, condition === 'night' ? { fixedExposure: 2.6, fixedExposureMix: 1 } : g.diveLight.surfaceExposure);
      const ship = g.models.ship, v = (x, y, z) => a.camera.position.clone().set(x, y, z);
      a.camera.position.copy(ship.localToWorld(v(0, height ?? 3.6, height ? 5.1 - height * .2 : 5.1)));
      a.camera.lookAt(ship.localToWorld(v(0, height ? 2 : 3.6 + Math.tan(-.3) * 30, height ? 0 : 35.1)));
      a.camera.fov = 65; a.camera.aspect = innerWidth / innerHeight; a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld();
      a.post.reset = a.clouds.reset = true; a.frame = 32; for (let i = 0; i < 16; i++) a.render(0);
      const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 90; const c = canvas.getContext('2d'); c.drawImage(a.renderer.domElement, 0, 0, 144, 90); const pixels = c.getImageData(0, 0, 144, 90).data;
      let light = 0; for (let i = 0; i < pixels.length; i += 4) light += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / (3 * 255);
      const point=ship.localToWorld(v(.16,3.34,6.02+.6)).project(a.camera);
      const px=Math.round((point.x*.5+.5)*144),py=Math.round((.5-point.y*.5)*90);let panel=0,n=0;
      for(let y=py-1;y<=py+1;y++)for(let x=px-1;x<=px+1;x++){const k=(y*144+x)*4;panel+=(pixels[k]+pixels[k+1]+pixels[k+2])/(3*255);n++;}
      return {light:light/(144*90),panel:panel/n,error:a.renderer.getContext().getError()};

    };
  });
  await p.evaluate(() => {
    const m=window.__app.post.passes.composite.material;window.gradeOriginal=m.fragmentShader;
    window.gradeReference=reference=>{
      m.fragmentShader=reference?window.gradeOriginal.replace(/col = max\(col, vec3\(0.0\)\);\n  float gradeLum[\s\S]*?col \+= uLift;/,'col = (col - 0.5) * uContrast + 0.5 + uLift;'):window.gradeOriginal;
      m.needsUpdate=true;
    };
  });
  const samples=[];
  for(const condition of ['day','golden','storm','night'])for(const reference of [true,false]){
    const r=await p.evaluate(({condition,reference})=>{window.gradeReference(reference);return window.showSky(0,5,condition);},{condition,reference});assert.equal(r.error,0);samples.push({condition,reference,...r});
    await p.screenshot({path:`${out}/${condition}-${reference?'before':'after'}.png`});
  }
  await p.evaluate(()=>window.gradeReference(false));
  for(const height of [200,1000]){await p.evaluate(height=>window.showSky(0,5,'day',height),height);await p.screenshot({path:`${out}/day-${height}.png`});}
  const timing=await p.evaluate(async()=>{
    const a=window.__app,r=a.renderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return null;
    const samples=[[],[]];
    for(const reference of [true,false]){
      window.gradeReference(reference);window.showSky(0,5,'day');const draw=()=>a.post.passes.composite.render(r,a.post.ldrRT);
      for(let i=0;i<8;i++)draw();gl.finish();
      for(let i=0;i<20;i++){const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);draw();gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush();
        while(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))await new Promise(r=>setTimeout(r,10));
        if(!gl.getParameter(ext.GPU_DISJOINT_EXT))samples[reference?0:1].push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);
      }
    }
    return samples.map(v=>{v.sort((a,b)=>a-b);return {median:v[Math.floor(v.length/2)],p95:v[Math.floor(v.length*.95)],samples:v.length};});
  });
  const before=samples.find(s=>s.condition==='golden'&&s.reference),after=samples.find(s=>s.condition==='golden'&&!s.reference);
  console.log(JSON.stringify({samples,timing,errors}));await fs.writeFile(`${out}/result.json`,JSON.stringify({samples,timing,errors},null,2));
  assert.ok(after.panel>before.panel+.025,'Shaded helm panel retains visible detail');assert.deepEqual(errors,[]);
}finally{await browser.close();await app.stop();}
