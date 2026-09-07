import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, addPlayer, disconnectPlayer, setInput, act, tick, availableActions, snapshot, BASE, CRATE, STEP, distance } from '../src/game/Simulation.js';
import { createGameServer } from '../server/index.mjs';
import { onWalkableDeck } from '../src/game/Deck.js';

function advance(w, seconds, inputs = {}) {
  for (let n = 0; n < seconds / STEP; n++) { for (const [id, i] of Object.entries(inputs)) setInput(w, id, i); tick(w); }
}
function action(w, id, name) { assert.equal(act(w, id, name).ok, true, `${id}: ${name}`); }

test('late input from a previous station cannot overwrite a dive and neutral input preserves facing', () => {
  const w = createWorld(), p = addPlayer(w, 'a', 'Mira');
  const delayed = { mode: 'deck', forward: 1, yaw: w.ship.heading, pitch: -.2, walkYaw: .8 };
  action(w, 'a', 'dive'); const yaw = p.yaw;
  setInput(w, 'a', delayed); tick(w);
  assert.equal(p.yaw, yaw, 'A late deck packet must not turn the new diver back toward the bow');
  assert.equal(p.input.forward || 0, 0, 'Old movement must not become swimming');
  setInput(w, 'a', { mode: 'diver', forward: 1, yaw: 1.2, pitch: -.4 }); tick(w);
  assert.equal(p.yaw, 1.2); assert.equal(p.pitch, -.4);
  setInput(w, 'a', {}); tick(w);
  assert.equal(p.yaw, 1.2, 'Neutral heartbeats stop movement without resetting head direction');
  assert.equal(p.pitch, -.4); assert.equal(p.input.forward, 0);
  action(w, 'a', 'board'); const position = [p.deckX, p.deckZ];
  setInput(w, 'a', { mode: 'diver', forward: 1, yaw: 1.2 }); tick(w);
  assert.deepEqual([p.deckX, p.deckZ], position, 'An old swim packet cannot walk the newly boarded player');
});
function sailTo(w, id, destination) {
  for (let n = 0; n < 6000 && distance(w.ship, destination) > 8; n++) {
    const target = Math.atan2(destination.x - w.ship.x, destination.z - w.ship.z);
    const delta = Math.atan2(Math.sin(target - w.ship.heading), Math.cos(target - w.ship.heading));
    setInput(w, id, { forward: Math.abs(delta) < .5 ? Math.min(1, distance(w.ship, destination) / 35) : .1, turn: Math.max(-1, Math.min(1, -delta * 3)) }); tick(w);
  }
  assert.ok(distance(w.ship, destination) < 9, 'ship reached destination');
  if (!w.ship.anchor) action(w, id, 'anchor'); advance(w, 2);
}
function swimTo(w, id, destination) {
  for (let n = 0; n < 3000; n++) {
    const p = w.players[id], dx = destination.x - p.x, dy = destination.y - p.y, dz = destination.z - p.z;
    if (Math.hypot(dx, dy, dz) < 2) return;
    setInput(w, id, { forward: 1, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }); tick(w);
  }
  assert.fail('diver did not arrive');
}

test('solo expedition is completable using the public action and movement rules', () => {
  const w = createWorld(); addPlayer(w, 'a');
  assert.equal(act(w, 'a', 'attach').ok, false);
  action(w, 'a', 'helm'); action(w, 'a', 'anchor'); sailTo(w, 'a', { x: CRATE.x, z: CRATE.z + 8 });
  assert.equal(w.mission, 'dive'); action(w, 'a', 'dive');
  swimTo(w, 'a', CRATE); action(w, 'a', 'attach');
  swimTo(w, 'a', { x: w.ship.x + 7, y: -.5, z: w.ship.z }); action(w, 'a', 'board');
  action(w, 'a', 'winch'); advance(w, 20); assert.equal(w.mission, 'return');
  action(w, 'a', 'helm'); action(w, 'a', 'anchor'); sailTo(w, 'a', BASE); action(w, 'a', 'deliver');
  assert.equal(w.mission, 'complete'); assert.ok(w.cargo.recovered); assert.ok(w.stormStart !== null);
});

test('crew ownership, reconnection, stale controls and anchor rules remain authoritative', () => {
  const w = createWorld(); for (const id of ['a', 'b', 'c', 'd']) addPlayer(w, id);
  assert.throws(() => addPlayer(w, 'e'), /four/);
  action(w, 'a', 'helm'); assert.equal(act(w, 'b', 'helm').ok, false);
  setInput(w, 'b', { forward: 1 }); advance(w, 2); assert.equal(w.ship.speed, 0);
  action(w, 'a', 'anchor'); advance(w, 3, { a: { forward: 1 } }); assert.ok(w.ship.speed > 5);
  advance(w, 12); assert.ok(w.ship.speed < .1, 'stale throttle expires');
  disconnectPlayer(w, 'a'); action(w, 'b', 'helm'); addPlayer(w, 'a');
  assert.equal(w.ship.pilot, 'b'); assert.equal(w.players.a.mode, 'deck');
  action(w, 'b', 'anchor'); const pos = { ...w.ship }; advance(w, 20, { b: { forward: 1, turn: 1 } });
  assert.equal(w.ship.x, pos.x); assert.equal(w.ship.z, pos.z);
  action(w, 'a', 'dive'); disconnectPlayer(w, 'a'); const diver = { ...w.players.a }; advance(w, 5); addPlayer(w, 'a');
  assert.equal(w.players.a.mode, 'diver'); assert.equal(w.players.a.x, diver.x);
  action(w, 'a', 'rescue'); assert.equal(w.players.a.mode, 'deck');
});

test('invalid input cannot poison the shared world; actions enforce proximity and station rules', () => {
  const w = createWorld(); addPlayer(w, 'a'); action(w, 'a', 'helm'); action(w, 'a', 'anchor');
  setInput(w, 'a', { forward: Infinity, yaw: NaN, turn: 999999 }); tick(w);
  assert.ok(Number.isFinite(w.ship.x)); assert.ok(Number.isFinite(w.ship.heading));
  assert.equal(act(w, 'a', 'deliver').ok, false); assert.equal(act(w, 'a', 'winch').ok, false);
  action(w, 'a', 'dive'); assert.equal(act(w, 'a', 'attach').ok, false);
  assert.equal(availableActions(w, 'nobody').length, 0);
  assert.equal(snapshot(w).players.a.input, undefined);
});

test('the floating dock blocks the cutter and a rejoined identity starts with neutral controls', () => {
  const w = createWorld(); addPlayer(w, 'a'); action(w, 'a', 'helm'); action(w, 'a', 'anchor');
  w.ship.heading = -Math.PI / 2;
  advance(w, 15, { a: { forward: 1 } });
  assert.ok(w.ship.x > BASE.x - 10, 'cutter cannot cross into the dock');
  disconnectPlayer(w, 'a'); advance(w, 10); addPlayer(w, 'a');
  assert.equal(w.players.a.lastInput, w.time); assert.deepEqual(w.players.a.input, {});
});

test('the storm eases continuously after delivery and stays clear during further exploration', () => {
  const w = createWorld(); addPlayer(w, 'a');
  w.time = 200; w.stormStart = 0; w.mission = 'return'; w.cargo.recovered = true;
  tick(w); assert.equal(w.storm, .85, 'The return leg retains the established storm');
  action(w, 'a', 'deliver'); const atDelivery = w.storm;
  tick(w);
  assert.ok(w.storm < atDelivery && atDelivery - w.storm < .001, 'Delivery starts a gradual clearing, without an abrupt sea-state change');
  advance(w, 30); const afterThirty = w.storm;
  assert.ok(afterThirty < .6 && afterThirty > .3, 'Rain and swell have time to ease');
  const resumed = JSON.parse(JSON.stringify(w));
  for (let i = 0; i < 600; i++) tick(w, 1 / 20);
  for (let i = 0; i < 1800; i++) tick(resumed, 1 / 60);
  assert.ok(Math.abs(w.storm - resumed.storm) < 1e-9, 'Saved weather resumes with the same clearing rate at different tick sizes');
  advance(w, 90); assert.equal(w.storm, 0);
  assert.equal(act(w, 'a', 'course', { destination: 'kelp' }).ok, true); advance(w, 30);
  assert.equal(w.storm, 0, 'Choosing the next dive does not resurrect the salvage storm');
});

test('delivery records the time and present crew once, independently of later voyage changes', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan'); addPlayer(w, 'c', 'Ellis');
  disconnectPlayer(w, 'c'); Object.assign(w, { time: 1234.5, mission: 'return' }); w.cargo.recovered = true;
  action(w, 'a', 'deliver');
  const record = { time: 1234.5, receivedFrom: 'Mira', crew: ['Mira', 'Rowan'] };
  assert.deepEqual(w.delivery, record);
  advance(w, 20); w.players.b.name = 'Changed'; addPlayer(w, 'c');
  assert.deepEqual(snapshot(w).delivery, record, 'Subsequent play and crew changes cannot rewrite the receipt');
  assert.equal(act(w, 'a', 'deliver').ok, false); assert.deepEqual(w.delivery, record);
});

test('right steering and strafe move toward camera-right with the ship and diver facing +Z', () => {
  const w = createWorld(); addPlayer(w, 'a'); action(w, 'a', 'helm'); action(w, 'a', 'anchor');
  w.ship.heading = 0; const startX = w.ship.x;
  advance(w, 2, { a: { forward: 1, turn: 1 } });
  assert.ok(w.ship.heading < 0, 'right rudder rotates clockwise viewed from above');
  assert.ok(w.ship.x < startX, 'forward-right travels to camera-right (-X when facing +Z)');
  action(w, 'a', 'anchor'); advance(w, 2); action(w, 'a', 'dive');
  const diverX = w.players.a.x;
  advance(w, 1, { a: { yaw: 0, strafe: 1 } });
  assert.ok(w.players.a.x < diverX, 'D strafes to screen-right');
});

test('deck crew can walk, stay aboard a turning ship, and cannot walk through cabin, winch or railings', () => {
  const w = createWorld(); addPlayer(w, 'captain'); addPlayer(w, 'crew');
  const p = w.players.crew, startZ = p.deckZ;
  advance(w, 1, { crew: { forward: 1, walkYaw: 0 } });
  assert.ok(p.deckZ > startZ + 1, 'W moves a crew member along the side deck');
  assert.equal(w.ship.speed, 0, 'walking never drives the ship');
  p.deckX = 0; p.deckZ = -1.7;
  advance(w, 3, { crew: { forward: 1 } }); assert.ok(p.deckZ <= -.3, 'cabin blocks passage');
  advance(w, 3, { crew: { forward: -1 } }); assert.ok(p.deckZ >= -3.35, 'winch blocks passage');
  for (const dir of [-1, 1]) {
    advance(w, 30, { crew: { forward: dir, strafe: dir, walkYaw: .4 } });
    assert.ok(onWalkableDeck(p.deckX, p.deckZ), 'railings keep the player aboard');
  }
  advance(w, 1); const local = { x: p.deckX, z: p.deckZ };
  action(w, 'captain', 'helm'); action(w, 'captain', 'anchor');
  advance(w, 4, { captain: { forward: 1, turn: 1 } });
  assert.equal(p.deckX, local.x); assert.equal(p.deckZ, local.z);
  assert.ok(Math.abs(p.x - (w.ship.x + Math.cos(w.ship.heading) * local.x + Math.sin(w.ship.heading) * local.z)) < 1e-8, 'crew rides with the hull');
  const saved = { x: p.deckX, z: p.deckZ }; disconnectPlayer(w, 'crew'); addPlayer(w, 'crew');
  assert.equal(p.deckX, saved.x); assert.equal(p.deckZ, saved.z);
  setInput(w, 'crew', { walkYaw: Infinity, forward: NaN }); tick(w); assert.ok(Number.isFinite(p.x));
});

test('HTTP rooms authenticate, stream equal state, reject a fifth crew, and resume an identity', async t => {
  const { server } = createGameServer(); server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = async (path, body = {}, token) => { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  const code = (await post('/api/rooms')).data.room, path = `/api/rooms/${code}`;
  const a = (await post(path + '/join', { name: 'Ada' })).data, b = (await post(path + '/join', { name: 'Bo' })).data;
  assert.equal((await post(path + '/action', { action: 'helm' }, 'fake')).status, 401);
  const controllers = [new AbortController(), new AbortController()]; t.after(() => controllers.forEach(c => c.abort()));
  const streams = await Promise.all([a, b].map(async (p, i) => { const res = await fetch(base + path + '/events?token=' + p.token, { signal: controllers[i].signal }); return res.body.getReader(); }));
  const read = async reader => { const result = await reader.read(); return new TextDecoder().decode(result.value).split('\n\n').filter(Boolean).map(s => JSON.parse(s.slice(6))).at(-1); };
  await Promise.all(streams.map(read));
  assert.equal((await post(path + '/action', { action: 'helm' }, a.token)).status, 200);
  assert.equal((await post(path + '/action', { action: 'helm' }, b.token)).status, 409);
  const states = await Promise.all(streams.map(read));
  assert.equal(states[0].ship.pilot, a.id); assert.deepEqual(states[0], states[1]);
  await post(path + '/join'); await post(path + '/join'); assert.equal((await post(path + '/join')).status, 400);
  await post(path + '/leave', {}, a.token);
  const reconnect = await post(path + '/join', { token: a.token }); assert.equal(reconnect.data.id, a.id); assert.equal(Object.keys(reconnect.data.state.players).length, 4);
  assert.equal((await post('/api/rooms/abcdefghijkl/join')).status, 404);
});
test('heartbeat expiry releases stations and closes the event stream cleanly for reconnection', async t => {
  const { server, rooms } = createGameServer(); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body = {}, token) => (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
  const { room } = await post('/api/rooms'), path = `/api/rooms/${room}`;
  const player = await post(path + '/join', { name: 'Diver' });
  const response = await fetch(`${base}${path}/events?token=${player.token}`, { signal: AbortSignal.timeout(3000) });
  const reader = response.body.getReader(); await reader.read();
  await post(path + '/action', { action: 'helm' }, player.token);
  const world = rooms.get(room).world; world.players[player.id].lastInput = world.time - 5;
  await assert.doesNotReject(async () => { while (!(await reader.read()).done) {} }, 'A deliberate heartbeat timeout must end HTTP framing, not truncate it');
  assert.equal(world.players[player.id].connected, false); assert.equal(world.ship.pilot, null);
  const rejoined = await post(path + '/join', { token: player.token });
  assert.equal(rejoined.id, player.id); assert.equal(rejoined.state.players[player.id].connected, true);
});
