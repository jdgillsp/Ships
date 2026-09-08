import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { RoomStore, RETENTION_MS } from '../server/RoomStore.mjs';
import { rememberExpedition, recentExpeditions } from '../src/game/SavedExpeditions.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';
import { RECIPE } from '../src/game/Simulation.js';
import { discoverWrecks } from '../src/game/WreckDiscoveries.js';
import { SALVAGE_SITES } from '../src/game/SalvageSites.js';
import { stormAfter } from '../src/game/WeatherOutlook.js';

test('unavailable browser storage does not throw while listing or remembering voyages', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage access denied'); } });
  try {
    assert.deepEqual(recentExpeditions(), []);
    assert.equal(rememberExpedition({ state: { persistence: { enabled: false } } }), false);
    assert.equal(rememberExpedition({ id: 'crew', room: 'room', token: 'token', state: { persistence: { enabled: true }, players: { crew: { name: 'Mira' } }, surveys: {} } }), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kestrel-save-'));
  const apps = [];
  t.after(async () => {
    for (const app of apps) await app.stop().catch(() => {});
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'kestrel-save-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const start = async () => {
    const app = createGameServer(undefined, { dataDir: dir }); await app.ready;
    app.server.listen(0, '127.0.0.1'); await new Promise(r => app.server.once('listening', r)); apps.push(app);
    app.post = async (route, data = {}, token) => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/rooms${route}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
      return { status: response.status, ...await response.json() };
    };
    return app;
  };
  return { dir, start };
}

test('disk checkpoint survives a real HTTP server restart with the same invite and crew', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  const p = await a.post(`/${room}/join`, { name: 'Rowan' });
  const w = a.rooms.get(room).world;
  assert.equal((await a.post(`/${room}/action`, { action: 'paintHull', paint: 'blue' }, p.token)).ok, true);
  assert.equal((await a.post(`/${room}/action`, { action: 'inscribeShip', text: 'Our ocean home', expectedRevision: 0 }, p.token)).ok, true);
  Object.assign(w.players[p.id], SALVAGE_SITES[1].cargo, { mode: 'diver' }); discoverWrecks(w);
  assert.equal((await a.post(`/${room}/action`, { action: 'shareSighting', type: 'turtle' }, p.token)).ok, true);
  Object.assign(w.ship, { x: 100, z: 200, speed: 3, anchor: false, pilot: p.id, propellerAngle: 123.4, anchorDrop: .35 });
  Object.assign(w.players[p.id], { mode: 'helm', input: { forward: 1 } });
  Object.assign(w.cargo, { recovered: true, attached: true, y: 3 }); w.mission = 'return';
  w.surveys.reef = { seconds: 8, completedAt: w.time, active: 0, contributors: [{ id: p.id, name: 'Rowan' }] };
  w.milestones = { departed: { time: w.time, crew: ['Rowan'] } };
  w.places = { 'place-1': { id: 'place-1', name: 'Sheltered water', x: 100, y: 0, z: 200, time: w.time, savedBy: 'Rowan' } }; w.signalSequence = 1;
  assert.equal((await a.post(`/${room}/action`, { action: 'updatePlace', destination: 'place-1', expectedRevision: 0, name: 'Sheltered water', note: 'Kelp beside the eastern rock.' }, p.token)).ok, true);
  await a.post(`/${room}/action`, { action: 'course', destination: 'place-1' }, p.token);
  assert.equal((await a.post(`/${room}/action`, { action: 'chartSighting', type: 'turtle' }, p.token)).ok, true);
  await a.post(`/${room}/action`, { action: 'crewCall', kind: 'slow' }, p.token);
  assert.equal((await a.post(`/${room}/action`, { action: 'writeCrewLog', entryId: 'persistent-crew-entry', text: 'Return to the eastern kelp at sunrise.' }, p.token)).ok, true);
  await a.stop();
  const text = await fs.readFile(path.join(f.dir, 'expeditions.json'), 'utf8');
  assert.ok(!text.includes(p.token), 'Bearer tokens never reach the disk save');
  const b = await f.start(), restored = b.rooms.get(room).world;
  assert.equal(restored.ship.anchor, true); assert.equal(restored.ship.pilot, null); assert.equal(restored.ship.speed, 0);
  assert.equal(restored.ship.paint, 'blue');
  assert.equal(restored.daylightStart, w.daylightStart);
  assert.deepEqual(restored.ship.inscription, w.ship.inscription);
  assert.deepEqual(restored.wreckDiscoveries, w.wreckDiscoveries, 'Explored wrecks survive disk restart');
  assert.deepEqual(restored.sightings, w.sightings, 'Shared wildlife reports survive disk restart');
  assert.equal(restored.ship.propellerAngle, w.ship.propellerAngle, 'The shaft orientation survives the checkpoint');
  assert.equal(restored.ship.anchorDrop, w.ship.anchorDrop, 'The anchor deployment survives the checkpoint');
  assert.equal(restored.players[p.id].mode, 'deck'); assert.deepEqual(restored.players[p.id].input, {});
  const time = restored.time; await new Promise(r => setTimeout(r, 150)); assert.equal(restored.time, time, 'Empty voyages pause');
  const rejoined = await b.post(`/${room}/join`, { token: p.token, resume: true });
  assert.equal(rejoined.id, p.id); assert.equal(rejoined.state.course.id, 'place-1');
  assert.deepEqual(rejoined.state.places, w.places, 'Named places and their course survive a real server restart');
  assert.equal(rejoined.state.cargo.recovered, true); assert.equal(rejoined.state.mission, 'return');
  assert.deepEqual(rejoined.state.surveys.reef, w.surveys.reef);
  assert.deepEqual(rejoined.state.milestones, w.milestones, 'Voyage memories survive disk restart and authenticated rejoin');
  assert.deepEqual(rejoined.state.crewLog, w.crewLog, 'Crew-written memories survive disk restart and rejoin');
  assert.deepEqual(rejoined.state.calls, {}, 'Transient calls are not replayed after restarting a voyage');
  assert.equal(rejoined.state.persistence.enabled, true);
  assert.equal((await b.post(`/${room}/join`, { token: 'invalid', resume: true })).status, 409);
  assert.equal(Object.keys(restored.players).length, 1, 'Failed resume does not silently create a new player');
});

test('an accepted second salvage restores its wreck, cargo, history and continuing weather', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  const p = await a.post(`/${room}/join`, { name: 'Mira' }), w = a.rooms.get(room).world;
  w.mission = 'return'; w.cargo.recovered = true; w.storm = .7;
  assert.equal((await a.post(`/${room}/action`, { action: 'deliver' }, p.token)).ok, true);
  assert.equal((await a.post(`/${room}/action`, { action: 'nextSalvage', destination: 'west' }, p.token)).ok, true);
  await a.stop(); const b = await f.start(), restored = b.rooms.get(room).world;
  assert.deepEqual(restored.contract, w.contract); assert.deepEqual(restored.salvageHistory, w.salvageHistory);
  assert.deepEqual(restored.locations, w.locations); assert.deepEqual(restored.cargo, w.cargo);
  assert.deepEqual(restored.weatherCarry, w.weatherCarry);
  assert.equal((await b.post(`/${room}/join`, { token: p.token, resume: true })).id, p.id);
});

test('a saved pickup restores the plotted route when restart loses live diver contact', async t => {
  const f=await fixture(t),a=await f.start(),{room}=await a.post('');
  const captain=await a.post(`/${room}/join`,{name:'Mira'}),diver=await a.post(`/${room}/join`,{name:'Rowan'});
  assert.equal((await a.post(`/${room}/action`,{action:'course',destination:'kelp'},captain.token)).ok,true);
  assert.equal((await a.post(`/${room}/action`,{action:'dive'},diver.token)).ok,true);
  assert.equal((await a.post(`/${room}/action`,{action:'pickupCourse',diver:diver.id},captain.token)).ok,true);
  assert.equal(a.rooms.get(room).world.pickup.diver,diver.id);
  await a.stop(); const b=await f.start(),w=b.rooms.get(room).world;
  assert.equal(w.pickup,null); assert.equal(w.course.id,'kelp');
  assert.equal((await b.post(`/${room}/join`,{token:captain.token,resume:true})).id,captain.id);
  assert.equal((await b.post(`/${room}/join`,{token:diver.token,resume:true})).id,diver.id);
  assert.equal((await b.post(`/${room}/action`,{action:'pickupCourse',diver:diver.id},captain.token)).ok,true);
  assert.equal((await b.post(`/${room}/action`,{action:'board'},diver.token)).ok,true);
  const recorded=structuredClone(w.pickupRecords); await b.stop(); const c=await f.start();
  assert.deepEqual(c.rooms.get(room).world.pickupRecords,recorded);
});

test('research requests, partial survey work and filed reports survive real server restarts', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  const p = await a.post(`/${room}/join`, { name: 'Mira' }), w = a.rooms.get(room).world;
  w.mission = 'return'; w.cargo.recovered = true;
  assert.equal((await a.post(`/${room}/action`, { action: 'deliver' }, p.token)).ok, true);
  assert.equal((await a.post(`/${room}/action`, { action: 'acceptResearch', destination: 'reef' }, p.token)).ok, true);
  assert.equal((await a.post(`/${room}/action`, { action: 'dive' }, p.token)).ok, true);
  w.players[p.id].diveRecord.maximumDepth = 12;
  assert.equal((await a.post(`/${room}/action`, { action: 'board' }, p.token)).ok, true);
  w.surveys.reef = { seconds: 3, completedAt: null, active: 0, contributors: [{ id: p.id, name: 'Mira' }] };
  await a.stop(); const b = await f.start(), restored = b.rooms.get(room).world;
  assert.deepEqual(restored.research, w.research); assert.equal(restored.surveys.reef.seconds, 3);
  assert.equal(restored.research.experience.dives, 1); assert.equal(restored.research.experience.maximumDepth, 12);
  await b.post(`/${room}/join`, { token: p.token, resume: true });
  Object.assign(restored.surveys.reef, { seconds: 8, completedAt: restored.time });
  assert.equal((await b.post(`/${room}/action`, { action: 'fileResearch' }, p.token)).ok, true);
  await b.stop(); const c = await f.start(), filed = c.rooms.get(room).world;
  assert.equal(filed.research, null); assert.deepEqual(filed.researchHistory, restored.researchHistory); assert.equal(filed.researchHistory[0].status, 'filed');
});

test('a completed voyage resumes its clearing sea state after a server restart', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  const p = await a.post(`/${room}/join`, { name: 'Rowan' }), w = a.rooms.get(room).world;
  Object.assign(w, { time: 220, stormStart: 0, storm: .85, mission: 'return' }); w.cargo.recovered = true;
  assert.equal((await a.post(`/${room}/action`, { action: 'deliver' }, p.token)).ok, true);
  await new Promise(resolve => setTimeout(resolve, 150));
  await a.stop(); const savedStorm = w.storm;
  assert.ok(savedStorm < .85 && savedStorm > .8);
  const b = await f.start(), restored = b.rooms.get(room).world;
  assert.equal(restored.storm, savedStorm); assert.equal(restored.mission, 'complete');
  assert.deepEqual(restored.delivery, w.delivery, 'The historical delivery record survives a real disk checkpoint');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(restored.storm, savedStorm, 'Weather pauses while the saved crew is away');
  const rejoined = await b.post(`/${room}/join`, { token: p.token, resume: true });
  assert.equal(rejoined.id, p.id);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(restored.storm < savedStorm && savedStorm - restored.storm < .01, 'Rejoining resumes gradual clearing rather than rebuilding the storm');
});

test('a passing exploration front resumes its weather clock and forecast after restart', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  const p = await a.post(`/${room}/join`, { name: 'Mira' }), w = a.rooms.get(room).world;
  w.mission = 'return'; w.cargo.recovered = true; w.storm = .85;
  assert.equal((await a.post(`/${room}/action`, { action: 'deliver' }, p.token)).ok, true);
  w.time = w.explorationWeather.time + 560; w.storm = stormAfter(w);
  await a.stop(); const b = await f.start(), restored = b.rooms.get(room).world;
  assert.deepEqual(restored.explorationWeather, w.explorationWeather); assert.equal(restored.storm, w.storm);
  assert.ok(restored.storm > .5); assert.equal(stormAfter(restored, 200), stormAfter(w, 200));
  const time = restored.time; await new Promise(r => setTimeout(r, 150)); assert.equal(restored.time, time);
  await b.post(`/${room}/join`, { token: p.token, resume: true });
  await new Promise(r => setTimeout(r, 150)); assert.ok(restored.time > time); assert.deepEqual(restored.explorationWeather, w.explorationWeather);
});

test('diver position and partial survey survive; inactive identities are kept while space remains', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  const p = await a.post(`/${room}/join`, { name: 'Mira' }), w = a.rooms.get(room).world;
  // Keep the saved diver above terrain even when a simulation tick runs while
  // the checkpoint is being written. A buried fixture gets clamped on resume.
  const position = { x: 30, y: oceanFloor(30, 40, RECIPE) + 6, z: 40 };
  assert.equal((await a.post(`/${room}/action`, { action: 'dive' }, p.token)).ok, true);
  Object.assign(w.players[p.id], { mode: 'diver', ...position });
  w.surveys.reef = { seconds: 3, completedAt: null, active: 1, contributors: [{ id: p.id, name: 'Mira' }] };
  await a.post(`/${room}/leave`, {}, p.token); a.rooms.get(room).departed.set(p.id, Date.now() - 150_000);
  await a.stop(); const b = await f.start();
  await b.post(`/${room}/join`, { name: 'New crew' });
  const restored = await b.post(`/${room}/join`, { token: p.token, resume: true });
  assert.equal(restored.id, p.id);
  const { x, y, z } = restored.state.players[p.id]; assert.deepEqual({ x, y, z }, position);
  assert.equal(restored.state.surveys.reef.seconds, 3); assert.equal(restored.state.surveys.reef.active, 0);
  assert.deepEqual(restored.state.players[p.id].diveRecord, w.players[p.id].diveRecord, 'Active dive timing survives restart');
  assert.equal((await b.post(`/${room}/action`, { action: 'rescue' }, p.token)).ok, true);
  const finished = b.rooms.get(room).world.diveRecords;
  assert.equal(finished.length, 1); assert.equal(finished[0].assisted, true);
  await b.stop(); const c = await f.start(); assert.deepEqual(c.rooms.get(room).world.diveRecords, finished);
});

test('failed disk writes keep the crew connected and leave the last valid save intact', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  const p = await a.post(`/${room}/join`, { name: 'Ada' }), saved = await fs.readFile(a.store.file, 'utf8');
  // A directory where the atomic temporary file belongs produces a real I/O failure.
  await fs.mkdir(a.store.file + '.tmp');
  const result = await a.post(`/${room}/leave`, {}, p.token);
  assert.equal(result.status, 503); assert.match(result.error, /still aboard/);
  assert.equal(a.rooms.get(room).world.players[p.id].connected, true);
  assert.equal(await fs.readFile(a.store.file, 'utf8'), saved); assert.ok(a.store.error);
  await fs.rmdir(a.store.file + '.tmp');
  assert.equal((await a.post(`/${room}/leave`, {}, p.token)).saved, true);
  assert.equal(a.rooms.get(room).world.players[p.id].connected, false);
});

test('corrupt save fails closed and queued snapshots preserve their order', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  await a.post(`/${room}/join`); await a.stop();
  const store = new RoomStore(f.dir), record = a.rooms.get(room);
  record.world.log = 'first'; const first = store.save(a.rooms);
  record.world.log = 'second'; const second = store.save(a.rooms); await Promise.all([first, second]);
  assert.equal((await store.load())[0].world.log, 'second');
  assert.equal(JSON.parse(await fs.readFile(store.file + '.bak', 'utf8')).rooms[0].world.log, 'first');
  await fs.writeFile(store.file, '{broken');
  await assert.rejects(store.load()); assert.equal(await fs.readFile(store.file, 'utf8'), '{broken');
});

test('delivery log validation accepts legacy saves and rejects malformed historical records', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  await a.post(`/${room}/join`, { name: 'Mira' }); await a.stop();
  const store = new RoomStore(f.dir), data = JSON.parse(await fs.readFile(store.file, 'utf8'));
  const world = data.rooms[0].world; delete world.delivery;
  await fs.writeFile(store.file, JSON.stringify(data));
  assert.equal((await store.load())[0].world.delivery, undefined, 'Older voyages remain loadable');
  const valid = { time: world.time, receivedFrom: 'Mira', crew: ['Mira'] };
  for (const invalid of [{ ...valid, time: -1 }, { ...valid, time: world.time + 1 }, { ...valid, crew: [] }, { ...valid, crew: Array(5).fill('Mira') }, { ...valid, crew: [42] }, { ...valid, receivedFrom: null }]) {
    world.delivery = invalid; await fs.writeFile(store.file, JSON.stringify(data));
    await assert.rejects(store.load(), /Invalid saved delivery log/);
  }
});

test('propeller phase validation permits legacy saves and rejects nonnumeric phases', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post(''); await a.post(`/${room}/join`); await a.stop();
  const store = new RoomStore(f.dir), data = JSON.parse(await fs.readFile(store.file, 'utf8')), ship = data.rooms[0].world.ship;
  delete ship.propellerAngle; await fs.writeFile(store.file, JSON.stringify(data)); assert.equal((await store.load()).length, 1);
  for (const phase of [null, '12', {}, []]) { ship.propellerAngle = phase; await fs.writeFile(store.file, JSON.stringify(data)); await assert.rejects(store.load(), /Invalid saved propeller phase/); }
  ship.propellerAngle = -1234.5; await fs.writeFile(store.file, JSON.stringify(data)); assert.equal((await store.load())[0].world.ship.propellerAngle, -1234.5);
});

test('anchor deployment validation accepts legacy voyages and rejects corrupt progress', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post(''); await a.post(`/${room}/join`); await a.stop();
  const store = new RoomStore(f.dir), data = JSON.parse(await fs.readFile(store.file, 'utf8')), ship = data.rooms[0].world.ship;
  delete ship.anchorDrop; await fs.writeFile(store.file, JSON.stringify(data)); assert.equal((await store.load()).length, 1);
  for (const drop of [null, '1', {}, [], -.1, 1.1]) { ship.anchorDrop = drop; await fs.writeFile(store.file, JSON.stringify(data)); await assert.rejects(store.load(), /Invalid saved anchor deployment/); }
  ship.anchorDrop = .45; await fs.writeFile(store.file, JSON.stringify(data)); assert.equal((await store.load())[0].world.ship.anchorDrop, .45);
});

test('expired voyages are pruned on load and browser history is bounded and validated', async t => {
  const f = await fixture(t), a = await f.start(), { room } = await a.post('');
  const p = await a.post(`/${room}/join`); await a.stop();
  a.rooms.get(room).touched = Date.now() - RETENTION_MS - 1; await a.flush();
  assert.deepEqual(await new RoomStore(f.dir).load(), []);
  let raw = null; const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  assert.ok(rememberExpedition({ room, token: p.token, id: p.id, state: p.state }, storage));
  assert.equal(recentExpeditions(storage)[0].room, room);
  raw = '[{"room":"<script>"}]'; assert.deepEqual(recentExpeditions(storage), []);
  raw = '{}'; assert.deepEqual(recentExpeditions(storage), []);
  assert.equal(rememberExpedition({ state: {} }, storage), false);
});
