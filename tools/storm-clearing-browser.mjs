import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';
import * as simulation from '../src/game/Simulation.js';

const app = createGameServer(); app.server.listen(0, '127.0.0.1');
await new Promise(resolve => app.server.once('listening', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`, out = 'tools/shots/storm-clearing';
await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage(), errors = [];
try {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/?mode=expedition&preset=high&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  await page.keyboard.press('h'); await page.waitForFunction(() => window.__app.game.lastMode === 'helm');
  const identity = await page.evaluate(() => ({ room: window.__app.game.net.room, id: window.__app.game.net.id }));
  const world = app.rooms.get(identity.room).world;
  Object.assign(world, { time: 200, stormStart: 0, storm: .85, mission: 'return' });
  Object.assign(world.cargo, { attached: true, recovered: true });
  simulation.setInput(world, identity.id, {});
  await page.waitForFunction(() => window.__app.game.state.storm > .8 && window.__app.game.contextAction() === 'deliver');
  const capture = async name => {
    const result = await page.evaluate(async () => {
      const a = window.__app, g = a.game; g.root.hidden = true;
      for (let i = 0; i < 18; i++) await new Promise(requestAnimationFrame);
      const weather = a.weather.state;
      return { serverStorm: g.state.storm, renderedStorm: weather.storm, wind: weather.windSpeed, rain: weather.rain, swell: weather.swellHs, sun: weather.sunElevation };
    });
    assert.ok(Math.abs(result.serverStorm - result.renderedStorm) < .025);
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.evaluate(() => { window.__app.game.root.hidden = false; });
    return result;
  };
  const storm = await capture('01-return-storm');
  await page.keyboard.press('f'); await page.waitForSelector('#mission-complete:not([hidden])');
  assert.equal(world.mission, 'complete');
  await page.click('#continue-sailing');
  const advance = seconds => {
    for (let i = 0; i < seconds / simulation.STEP; i++) { simulation.setInput(world, identity.id, {}); simulation.tick(world); }
  };
  advance(30);
  await page.waitForFunction(() => window.__app.game.state.storm < .55);
  const easing = await capture('02-clearing');
  advance(50);
  await page.waitForFunction(() => window.__app.game.state.storm === 0);
  const clear = await capture('03-clear-sea');
  assert.ok(storm.rain > easing.rain && easing.rain > clear.rain);
  assert.ok(storm.swell > easing.swell && easing.swell > clear.swell);
  assert.equal(clear.rain, 0); assert.equal(clear.wind, 5); assert.equal(clear.swell, .7);
  const joined = await fetch(`${base}/api/rooms/${identity.room}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rowan' }) }).then(response => response.json());
  assert.equal(joined.state.storm, 0, 'A joining crewmate receives the same cleared sea');
  await page.keyboard.press('n'); await page.select('#voyage-destination', 'kelp'); await page.click('#plot-course');
  await page.waitForFunction(() => window.__app.game.state.course?.id === 'kelp');
  assert.equal(world.storm, 0); assert.equal(world.ship.pilot, identity.id);
  assert.deepEqual(errors, []);
  const result = { storm, easing, clear, sharedWeather: true, nextDive: true, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  console.error(await page.evaluate(() => { const g = window.__app?.game; return { started: g?.started, mode: g?.lastMode, ready: g?.net.ready, mission: g?.state?.mission, modal: g?.dialogOpen(), focus: document.activeElement?.id, message: g?.message }; }), errors);
  await page.screenshot({ path: `${out}/failure.png` }); throw error;
} finally { await browser.close(); await app.stop(); }
