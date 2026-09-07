import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { useExpandedTools } from './browser-tools-view.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(resolve => app.server.once('listening', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await useExpandedTools(page);
  await page.goto(`${base}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition');
  await page.waitForFunction(() => window.__app.game.lastMode === 'deck');
  await page.keyboard.press('c'); await page.click('#sound');
  await page.waitForFunction(() => window.__app.game.sound.context?.state === 'running');
  const room = await page.evaluate(() => window.__app.game.net.room);
  const post = async (path, body, token) => {
    const response = await fetch(`${base}/api/rooms/${room}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.ok(response.ok); return response.json();
  };
  const peer = await post('join', { name: 'Rowan' });
  await page.waitForFunction(id => window.__app.game.state.players[id]?.connected, {}, peer.id);
  await page.evaluate(() => {
    const sound = window.__app.game.sound, original = sound.tone;
    window.radioTones = [];
    sound.tone = function (notes, duration, strength, pan) {
      if (notes[0] === 480 || (notes[0] === 640 && notes[1] === 800)) window.radioTones.push({ notes, strength, pan });
      return original.call(this, notes, duration, strength, pan);
    };
  });
  const call = async () => {
    // Expire only the sender's cooldown; retain the authoritative action path.
    app.rooms.get(room).world.players[peer.id].lastCall = -Infinity;
    await post('action', { action: 'crewCall', kind: 'ready' }, peer.token);
  };
  await call(); await page.waitForFunction(() => window.radioTones.length === 1);
  const first = await page.evaluate(() => window.radioTones[0]);
  assert.ok(Math.abs(first.pan) > .15 && first.strength > .035 && first.strength < .065);
  await page.mouse.move(100, 400); await page.mouse.down(); await page.mouse.move(885, 400, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(() => Math.abs(window.__app.game.orbit) > 2.7);
  await call(); await page.waitForFunction(() => window.radioTones.length === 2);
  const turned = await page.evaluate(() => window.radioTones[1]);
  assert.ok(first.pan * turned.pan < 0, 'Turning away reverses the deck radio in stereo');
  await page.click('#sound');
  await page.waitForFunction(() => !window.__app.game.sound.enabled && !document.getElementById('sound').disabled);
  await call();
  await page.waitForFunction(() => window.__app.game.sound.last?.calls >= 3, { timeout: 10000 }).catch(async error => {
    console.log(await page.evaluate(() => ({ running: window.__app.running, last: window.__app.game.sound.last, calls: window.__app.game.state.callSequence, ready: window.__app.game.net.ready, enabled: window.__app.game.sound.enabled })), errors);
    throw error;
  });
  assert.equal(await page.evaluate(() => window.radioTones.length), 2);
  await page.click('#sound');
  await page.waitForFunction(() => window.__app.game.sound.enabled && !document.getElementById('sound').disabled);
  await page.waitForFunction(() => window.__app.game.sound.last?.calls >= 3);
  assert.equal(await page.evaluate(() => window.radioTones.length), 2, 'Unmuting does not replay old calls');
  await page.keyboard.press('v'); await page.waitForFunction(() => window.__app.game.lastMode === 'diver');
  await call(); await page.waitForFunction(() => window.radioTones.length === 3);
  const diver = await page.evaluate(() => window.radioTones[2]);
  assert.equal(diver.pan, 0); assert.equal(diver.strength, .065);
  const audio = await page.evaluate(async () => {
    const sound = window.__app.game.sound;
    const render = async (pan, volume = 1, strength = .065) => {
      const context = new OfflineAudioContext(2, 14400, 48000), master = context.createGain();
      master.gain.value = volume; master.connect(context.destination);
      Object.getPrototypeOf(sound).tone.call({ context, ambient: { master } }, [480, 640], .13, strength, pan);
      const buffer = await context.startRendering();
      return [0, 1].map(channel => Math.sqrt(buffer.getChannelData(channel).reduce((sum, v) => sum + v * v, 0) / buffer.length));
    };
    return { left: await render(-.8), right: await render(.8), center: await render(0), half: await render(0, .5), distant: await render(0, 1, .0325), muted: await render(.8, 0) };
  });
  assert.ok(audio.left[0] > audio.left[1] * 4 && audio.right[1] > audio.right[0] * 4);
  assert.ok(audio.center[0] > .001 && Math.abs(audio.center[0] - audio.center[1]) < 1e-8);
  assert.ok(Math.abs(audio.half[0] / audio.center[0] - .5) < 1e-6);
  assert.ok(Math.abs(audio.distant[0] / audio.center[0] - .5) < 1e-6);
  assert.deepEqual(audio.muted, [0, 0]); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ first, turned, diver, audio, muteNoReplay: true, errors }));
} finally { await browser.close(); await app.stop(); }
