import { useExpandedTools } from './browser-tools-view.mjs';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
const { server } = createGameServer(); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const out = 'tools/shots/experience'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], defaultViewport: { width: 1440, height: 900 } });
const p = await browser.newPage(), errors = [], sleep = ms => new Promise(r => setTimeout(r, ms));
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await useExpandedTools(p); await p.goto(`http://127.0.0.1:${server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await p.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  assert.equal(await p.evaluate(() => !!window.__app.game.sound.context), false, 'no audio is created before user activation');
  await p.click('#start-expedition'); await p.waitForFunction(() => window.__app.game.net.ready);
  await sleep(500); await p.screenshot({ path: `${out}/01-deck.png` });
  await p.click('#sound'); await p.waitForFunction(() => window.__app.game.sound.context?.state === 'running');
  await p.evaluate(() => {
    const s = window.__app.game.sound; window.audioContextBefore = s.context;
    window.audioAnalyser = s.context.createAnalyser(); window.audioAnalyser.fftSize = 2048; s.ambient.master.connect(window.audioAnalyser);
  });
  const measureAudio = () => p.evaluate(async () => {
    let peak = 0, sum = 0, samples = 0; const buffer = new Float32Array(window.audioAnalyser.fftSize);
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame); window.audioAnalyser.getFloatTimeDomainData(buffer);
      for (const value of buffer) { peak = Math.max(peak, Math.abs(value)); sum += value * value; samples++; }
    }
    return { peak, rms: Math.sqrt(sum / samples) };
  });
  await sleep(900); const audible = await measureAudio(); assert.ok(audible.rms > .001 && audible.peak < .4, 'actual mixed audio is audible without clipping');
  await p.click('#sound'); await sleep(1000); const muted = await measureAudio(); assert.ok(muted.rms < audible.rms * .01, 'mute gates every audio layer');
  await p.click('#sound'); assert.equal(await p.evaluate(() => window.audioContextBefore === window.__app.game.sound.context), true, 'toggle reuses one audio context');
  console.log('Audio activation, real signal levels and mute passed');
  await p.keyboard.down('w'); await sleep(3200); await p.keyboard.up('w');
  await p.keyboard.down('d'); await sleep(650); await p.keyboard.up('d');
  await p.keyboard.down('w'); await sleep(500); await p.keyboard.up('w');
  assert.ok(await p.evaluate(() => { const g = window.__app.game; return g.state.players[g.net.id].deckZ > 5.5; }), 'lookout can walk to the bow for a clear sightline');
  await p.keyboard.press('l'); await p.waitForFunction(() => window.__app.game.lookout && window.__app.camera.fov < 25);
  assert.equal(await p.$eval('.mission-panel', e => getComputedStyle(e).visibility), 'hidden');
  const fov = await p.evaluate(() => window.__app.camera.fov);
  await p.mouse.move(800, 450); await p.mouse.wheel({ deltaY: -500 }); await sleep(400);
  assert.ok(await p.evaluate(fov => window.__app.camera.fov < fov - 5, fov));
  await p.mouse.down(); await p.mouse.move(860, 470, { steps: 5 }); await p.mouse.up();
  assert.ok(await p.evaluate(() => window.__app.game.orbit < 0 && window.__app.game.deckPitch < 0), 'magnified aiming remains consistent');
  await p.evaluate(() => {
    const a = window.__app, g = a.game, b = g.models.buoy.position;
    g.orbit = Math.atan2(b.x - a.camera.position.x, b.z - a.camera.position.z) - g.state.ship.heading; g.deckPitch = 0;
  });
  await sleep(700); await p.screenshot({ path: `${out}/02-lookout.png` });
  await p.keyboard.press('Escape'); await p.waitForFunction(() => !window.__app.game.lookout && window.__app.camera.fov === 55);
  assert.equal(await p.evaluate(() => window.__app.game.view), 'deck');
  await p.click('[data-action="helm"]'); await sleep(350); await p.keyboard.press('l');
  assert.equal(await p.evaluate(() => window.__app.game.lookout), false, 'station operators leave their station before using optics');
  await p.click('[data-action="leaveHelm"]'); await sleep(350);
  await p.keyboard.press('c'); await p.keyboard.press('l'); await sleep(300); await p.keyboard.press('Home');
  assert.equal(await p.evaluate(() => window.__app.game.view), 'chase');
  assert.equal(await p.evaluate(() => window.__app.game.lookout), false);
  await p.keyboard.press('l'); await p.click('#invite'); await sleep(200);
  assert.equal(await p.evaluate(() => window.__app.game.lookout), false, 'opening a dialog lowers optics');
  await p.click('#close-invite'); await p.keyboard.press('l'); await p.keyboard.press('v');
  await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].mode === 'diver' && !g.lookout; });
  await p.keyboard.down('ControlLeft'); await sleep(1700); await p.keyboard.up('ControlLeft');
  await p.waitForFunction(() => window.__app.game.sound.mix?.breath > 0);
  assert.equal(await p.$eval('#binoculars', e => e.disabled), true);
  const diveMix = await p.evaluate(() => window.__app.game.sound.mix); assert.ok(diveMix.cutoff < 200 && diveMix.engine < .035);
  await p.screenshot({ path: `${out}/03-diver.png` });
  const diveAudio = await measureAudio(); assert.ok(diveAudio.rms > 0 && diveAudio.peak < .4);
  await p.click('#sound'); await sleep(1000); const diveMuted = await measureAudio(); assert.ok(diveMuted.rms < .00001, 'breathing and underwater layers also mute');
  await p.setViewport({ width: 600, height: 800 });
  await p.click('[data-action="rescue"]'); await p.waitForFunction(() => { const g = window.__app.game; return g.state.players[g.net.id].mode === 'deck'; });
  await p.click('#binoculars'); await sleep(400); await p.screenshot({ path: `${out}/04-narrow-lookout.png` });
  const button = await p.$eval('#binoculars', e => { const r = e.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom }; });
  assert.ok(button.x >= 0 && button.right <= 600 && button.bottom <= 800);
  assert.deepEqual(errors, []); await fs.writeFile(`${out}/result.json`, JSON.stringify({ passed: true, audible, muted, diveAudio, diveMuted, diveMix, button, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, audible, muted, diveAudio, diveMuted, errors }));
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
