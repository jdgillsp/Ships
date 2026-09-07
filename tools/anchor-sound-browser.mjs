import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';
import { useExpandedTools } from './browser-tools-view.mjs';

let holdDrop = null, paused = false;
const app = createGameServer({ ...simulation, tick(w, dt) { if (!paused) simulation.tick(w, dt); if (holdDrop !== null) w.ship.anchorDrop = holdDrop; } });
app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/anchor-sound'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await useExpandedTools(page); await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  await page.click('#sound'); await page.waitForFunction(() => window.__app.game.sound.context?.state === 'running');
  await page.evaluate(() => { const s = window.__app.game.sound; window.oldAnchorPanner = s.anchorPanner; window.cues = []; const original = s.noiseCue.bind(s); s.noiseCue = (...args) => { window.cues.push(args); original(...args); }; });
  assert.equal(await page.evaluate(() => window.__app.game.sound.mix.anchor), 0);
  await page.keyboard.press('b'); await page.waitForFunction(() => window.__app.game.sound.mix.anchor > .01);
  const raising = await page.evaluate(() => { const g = window.__app.game; return { gain: g.sound.mix.anchor, hz: g.sound.mix.anchorHz, drop: g.frameWorld.ship.anchorDrop }; });
  await page.waitForFunction(() => window.__app.game.frameWorld.ship.anchorDrop === 0 && window.__app.game.sound.anchorGain.gain.value < .0001);
  assert.equal(await page.evaluate(() => window.cues.length), 0, 'The old short anchor burst is replaced by the working machinery');
  await page.keyboard.press('b'); await page.waitForFunction(() => window.__app.game.sound.mix.anchor > .01);
  const loweringHz = await page.evaluate(() => window.__app.game.sound.mix.anchorHz); assert.ok(loweringHz < raising.hz);
  await page.waitForFunction(() => window.__app.game.frameWorld.ship.anchorDrop === 1 && window.__app.game.sound.anchorGain.gain.value < .0001);
  holdDrop = .5;
  await page.waitForFunction(() => window.__app.game.sound.mix.anchor > .01);
  const sample = () => page.evaluate(() => { const g = window.__app.game, s = g.sound; return { gain: s.mix.anchor, pan: s.mix.anchorPan, cutoff: s.mix.anchorCutoff, sourceError: g.models.anchorGear.gypsy.getWorldPosition(s.anchorPosition.clone()).distanceTo(s.anchorPosition) }; });
  const deck = await sample();
  const orbit = await page.evaluate(() => window.__app.game.orbit);
  await page.keyboard.down('q'); await page.waitForFunction(orbit => window.__app.game.orbit > orbit + Math.PI, {}, orbit); await page.keyboard.up('q');
  try { await page.waitForFunction(pan => window.__app.game.sound.mix.anchorPan * pan < 0, { timeout: 2000 }, deck.pan); }
  catch (error) { throw new Error(JSON.stringify({ deck, after: await sample(), pose: await page.evaluate(() => { const g = window.__app.game; return { mode: g.lastMode, view: g.view, orbit: g.orbit, camera: g.app.camera.position.toArray(), right: g.app.camera.matrixWorld.elements.slice(0, 3), player: g.state.players[g.net.id] }; }) }), { cause: error }); }
  const turned = await sample(); assert.ok(deck.sourceError < 1e-8 && turned.sourceError < 1e-8);
  await page.click('#sound'); await page.waitForFunction(() => !window.__app.game.sound.enabled && window.__app.game.sound.ambient.master.gain.value < .00001);
  await page.click('#sound'); await page.waitForFunction(() => window.__app.game.sound.enabled && window.__app.game.sound.ambient.master.gain.value > .001);
  assert.ok(await page.evaluate(() => window.__app.game.sound.anchorPanner === window.oldAnchorPanner));
  paused = true; await page.waitForFunction(() => window.__app.game.sound.mix.anchor === 0 && window.__app.game.sound.anchorGain.gain.value < .0001);
  paused = false; await page.waitForFunction(() => window.__app.game.sound.mix.anchor > .01);
  await page.keyboard.press('v'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  const identity = await page.evaluate(() => { const g = window.__app.game; return { room: g.net.room, id: g.net.id }; }), world = app.rooms.get(identity.room).world;
  Object.assign(world.players[identity.id], { x: world.ship.x + 8, y: -6, z: world.ship.z });
  await page.waitForFunction(() => window.__app.game.app.camera.position.y < -5.9); const submerged = await sample();
  assert.ok(submerged.cutoff < deck.cutoff && submerged.gain < deck.gain);
  world.players[identity.id].x = world.ship.x + 110;
  await page.waitForFunction(() => { const g = window.__app.game; return Math.abs(g.app.camera.position.x - g.frameWorld.ship.x) > 109; });
  const distant = await sample(); assert.ok(distant.gain < submerged.gain * .1);
  const audio = await page.evaluate(async () => {
    const prototype = Object.getPrototypeOf(window.__app.game.sound);
    const render = async (pan, volume = 1, strength = .075, cutoff = 1400) => {
      const context = new OfflineAudioContext(2, 24000, 48000), master = context.createGain(); master.gain.value = volume; master.connect(context.destination);
      const noise = context.createBufferSource(); noise.buffer = context.createBuffer(2, 24000, 48000);
      let seed = 713; for (let channel = 0; channel < 2; channel++) { const data = noise.buffer.getChannelData(channel); for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; } } noise.start();
      const sound = { ambient: { context, master, noise } }; prototype.create.call(sound);
      sound.anchorGain.gain.value = strength; sound.anchorPanner.pan.value = pan; sound.anchorFilter.frequency.value = cutoff; sound.anchorRattleGain.gain.value = .5;
      const buffer = await context.startRendering();
      return [0, 1].map(channel => Math.sqrt(buffer.getChannelData(channel).reduce((sum, x) => sum + x * x, 0) / buffer.length));
    };
    return { left: await render(-.75), right: await render(.75), center: await render(0), half: await render(0, .5), distant: await render(0, 1, .0075), muted: await render(.75, 0), underwater: await render(0, 1, .03375, 220), idle: await render(0, 1, 0) };
  });
  assert.ok(audio.left[0] > audio.left[1] * 4 && audio.right[1] > audio.right[0] * 4);
  assert.ok(audio.center[0] > .001 && Math.abs(audio.center[0] - audio.center[1]) < 1e-8);
  assert.ok(Math.abs(audio.half[0] / audio.center[0] - .5) < 1e-6 && Math.abs(audio.distant[0] / audio.center[0] - .1) < 1e-6);
  assert.deepEqual(audio.muted, [0, 0]); assert.deepEqual(audio.idle, [0, 0]); assert.ok(audio.underwater[0] < audio.center[0] * .5, JSON.stringify(audio));
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), raising, loweringHz, nativeEndpointsStop: true, noOldBurst: true, deck, turned, submerged, distant, liveMute: true, reusedGraph: true, stalledSnapshotStops: true, audio, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
