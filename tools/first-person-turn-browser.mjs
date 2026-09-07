import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameServer } from '../server/index.mjs';

const app = createGameServer(); app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r));
const out = 'tools/shots/first-person-turn'; await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-angle=d3d11', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
try {
  const page = await browser.newPage(), errors = [], checks = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?mode=expedition&preset=low&adaptive=0`);
  await page.waitForFunction(() => window.__app?.running && !document.getElementById('boot'), { timeout: 120000 });
  await page.click('#start-expedition'); await page.waitForFunction(() => { const g = window.__app.game; return g.started && g.net.ready && g.lastMode === 'deck' && !document.querySelector('.launch-screen'); });
  const identity = await page.evaluate(() => { const g = window.__app.game; return { room: g.net.room, id: g.net.id }; }), world = app.rooms.get(identity.room).world;
  const frames = () => page.evaluate(async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); });
  const angle = () => page.evaluate(() => { const g = window.__app.game; return g.lastMode === 'diver' ? g.yaw : g.orbit; });
  const cameraAngle = () => page.evaluate(() => { const a = window.__app, d = a.camera.getWorldDirection(a.camera.position.clone()); return Math.atan2(d.x, d.z); });
  const signedTurn = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const mode = value => page.waitForFunction(value => window.__app.game.lastMode === value, {}, value);
  const sensitivity = async label => {
    for (const value of [.5, 1, 2.5]) {
      await page.keyboard.press('i'); await page.click('#game-settings'); await page.waitForSelector('#settings-dialog[open]');
      await page.focus('#camera-sensitivity'); await page.keyboard.press('Home');
      for (let i = 0; i < Math.round((value - .35) / .05); i++) await page.keyboard.press('ArrowRight');
      assert.equal(await page.$eval('#camera-sensitivity', e => Number(e.value)), value);
      await page.keyboard.press('Escape'); await page.keyboard.press('i'); await page.mouse.click(100, 400);
      await page.evaluate(() => {
        const g = window.__app.game, original = g.update;
        g.turnProbe = { angle: 0, seconds: 0 };
        g.update = function(dt) {
          const active = this.keys.has('KeyQ'), before = this.lastMode === 'diver' ? this.yaw : this.orbit;
          original.call(this, dt);
          if (active) { this.turnProbe.angle += (this.lastMode === 'diver' ? this.yaw : this.orbit) - before; this.turnProbe.seconds += dt; }
        };
        g.stopTurnProbe = () => { g.update = original; };
      });
      await page.keyboard.down('q'); await frames(); await page.keyboard.up('q');
      const measured = await page.evaluate(() => { const g = window.__app.game; g.stopTurnProbe(); return g.turnProbe.angle / g.turnProbe.seconds; });
      assert.ok(Math.abs(measured - 1.5 * value) < .001, `${label}: ${value}x look sensitivity should change keyboard turning, measured ${measured} rad/s`);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('abyssal:expedition-settings')).sensitivity), value);
    }
    // Restore the normal setting for the remaining station and depth checks.
    await page.keyboard.press('i'); await page.click('#game-settings'); await page.focus('#camera-sensitivity'); await page.keyboard.press('Home');
    for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape'); await page.keyboard.press('i'); await page.mouse.click(100, 400);
    checks.push(`${label}: keyboard turn sensitivity follows native slider changes and saves`);
  };
  const turn = async label => {
    const before = await angle(), cameraBefore = await cameraAngle(), p = { ...world.players[identity.id] }, heading = world.ship.heading;
    await page.keyboard.down('q'); await page.waitForFunction(a => { const g = window.__app.game; return (g.lastMode === 'diver' ? g.yaw : g.orbit) > a + .25; }, {}, before); await page.keyboard.up('q');
    const cameraLeft = await cameraAngle(); assert.ok(signedTurn(cameraBefore, cameraLeft) > .2, `${label}: the rendered camera must turn left`);
    const left = await angle(); await page.keyboard.down('e'); await page.waitForFunction(a => { const g = window.__app.game; return (g.lastMode === 'diver' ? g.yaw : g.orbit) < a - .25; }, {}, left); await page.keyboard.up('e');
    assert.ok(signedTurn(cameraLeft, await cameraAngle()) < -.2, `${label}: the rendered camera must turn right`);
    const eyeError = await page.evaluate(() => { const g = window.__app.game, p = g.frameWorld.players[g.net.id]; return g.app.camera.position.distanceTo(p.mode === 'diver' ? g.app.camera.position.clone().set(p.x, p.y, p.z) : g.models.ship.position); });
    assert.ok(eyeError < (p.mode === 'diver' ? .2 : 15), `${label}: the camera must stay with the player`);
    assert.equal(world.players[identity.id].deckX, p.deckX); assert.equal(world.players[identity.id].deckZ, p.deckZ); assert.equal(world.ship.heading, heading);
    assert.equal(world.players[identity.id].input.vertical || 0, 0, 'Q/E never sends a depth command');
    if (p.mode === 'diver') assert.equal(world.players[identity.id].y, p.y, 'Turning does not change diving depth');
    await page.keyboard.down('q'); await page.keyboard.down('e'); await frames(); const both = await angle(); await frames(); assert.equal(await angle(), both); await page.keyboard.up('q'); await page.keyboard.up('e');
    checks.push(label);
  };
  const leaveFacing = async (key, label) => {
    const start = await angle();
    await page.keyboard.down('q'); await page.waitForFunction(start => window.__app.game.orbit > start + .6, {}, start); await page.keyboard.up('q');
    await page.mouse.move(100, 400); await page.mouse.down(); await page.mouse.move(100, 430); await page.mouse.up();
    const before = await page.evaluate(() => { const g = window.__app.game; return { yaw: g.orbit, pitch: g.deckPitch, direction: g.app.camera.getWorldDirection(g.app.camera.position.clone()).toArray() }; });
    await page.keyboard.press(key); await mode('deck');
    const after = await page.evaluate(before => { const g = window.__app.game, direction = g.app.camera.getWorldDirection(g.app.camera.position.clone()); return { yaw: g.orbit, pitch: g.deckPitch, cameraTurn: direction.angleTo(direction.clone().fromArray(before.direction)) }; }, before);
    assert.equal(after.yaw, before.yaw, `${label}: keep the view yaw when stepping away`);
    assert.equal(after.pitch, before.pitch, `${label}: keep the view pitch when stepping away`);
    assert.ok(after.cameraTurn < .12, `${label}: rendered camera must not snap to the bow (${after.cameraTurn} radians)`);
    checks.push(label);
  };
  await turn('Deck first-person left/right turn without walking');
  await sensitivity('Deck');
  await page.keyboard.press('c'); const chase = await angle(); await page.keyboard.down('q'); await frames(); await page.keyboard.up('q'); assert.equal(await angle(), chase); await page.keyboard.press('c');
  await page.keyboard.press('l'); await turn('Binocular keyboard aim'); await page.keyboard.press('Escape');
  await page.keyboard.press('h'); await mode('helm'); await page.keyboard.press('c'); await turn('First-person helm look without steering the cutter');
  await page.click('#crew-activities'); await page.waitForSelector('#crew-activities-dialog[open]');
  const blocked = await angle(); await page.keyboard.down('q'); await frames(); await page.keyboard.up('q'); assert.equal(await angle(), blocked); await page.keyboard.press('Escape');
  checks.push('Notebook keeps look keys isolated'); await leaveFacing('h', 'Leaving the helm preserves first-person aim');
  const walkingFrom = { ...world.players[identity.id] }, walkingYaw = await angle();
  await page.keyboard.down('w'); await page.waitForFunction(({ x, z }) => { const g = window.__app.game, p = g.state.players[g.net.id]; return Math.hypot(p.deckX - x, p.deckZ - z) > .15; }, {}, { x: walkingFrom.deckX, z: walkingFrom.deckZ }); await page.keyboard.up('w');
  const walked = world.players[identity.id], dx = walked.deckX - walkingFrom.deckX, dz = walked.deckZ - walkingFrom.deckZ;
  assert.ok(dx * Math.sin(walkingYaw) + dz * Math.cos(walkingYaw) > .15);
  assert.ok(Math.abs(dx * Math.cos(walkingYaw) - dz * Math.sin(walkingYaw)) < .03, 'Walking follows the retained first-person direction');
  checks.push('Walking follows the view after leaving helm');
  Object.assign(world.cargo, { attached: true, x: world.ship.x, z: world.ship.z, y: -100 }); world.mission = 'recovery';
  await page.waitForFunction(() => window.__app.game.state.cargo.attached); await page.keyboard.press('r'); await mode('winch'); await turn('Winch first-person look');
  await leaveFacing('r', 'Leaving the winch preserves first-person aim'); await page.keyboard.press('v'); await mode('diver');
  Object.assign(world.players[identity.id], { y: -6 }); await page.waitForFunction(() => window.__app.game.state.players[window.__app.game.net.id].y === -6);
  await turn('Diver Q/E yaw without rising or descending');
  await sensitivity('Diver');
  // Escape intentionally restores keyboard focus to the notebook's opener.
  // Return to the scene before using Space as a swimming command.
  await page.mouse.click(100, 400);
  await page.keyboard.down('ControlLeft'); await page.waitForFunction(() => window.__app.game.state.players[window.__app.game.net.id].y < -6.5); await page.keyboard.up('ControlLeft');
  await page.keyboard.down('Space'); await page.waitForFunction(() => window.__app.game.state.players[window.__app.game.net.id].y > -6); await page.keyboard.up('Space'); checks.push('Ctrl descends and Space ascends');
  assert.deepEqual(errors, []); const result = { recordedAt: new Date().toISOString(), checks, chaseUnaffected: true, errors };
  await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await app.stop(); }
