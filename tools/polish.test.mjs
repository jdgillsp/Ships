import { RADIO_STATION } from '../src/game/RadioStation.js';
import { LOGBOOK_STATION } from '../src/game/LogbookStation.js';

test('the ship logbook has a local deck interaction, separate from machinery and diving', () => {
  const w = createWorld(), p = addPlayer(w, 'reader');
  Object.assign(p, { deckX: LOGBOOK_STATION.x, deckZ: -.7 });
  assert.equal(nearbyDeckStation(w, p.id).action, 'logbook');
  w.cargo.recovered = true;
  assert.equal(nearbyDeckStation(w, p.id).action, 'logbook');
  p.mode = 'diver'; assert.equal(nearbyDeckStation(w, p.id), null);
  p.mode = 'deck'; p.deckZ = -2; assert.notEqual(nearbyDeckStation(w, p.id)?.station, 'logbook');
  p.deckX = RADIO_STATION.x; p.deckZ = -.7; assert.equal(nearbyDeckStation(w, p.id).station, 'radio');
});
import { advanceAnchor, anchorDeployment, anchorStatus } from '../src/game/Anchoring.js';
import test from 'node:test';
import { DiveSplashTrail, splashPose, SPLASH_LIMIT } from '../src/game/DiveSplashTrail.js';
import { BOARDING_LADDER, boardingEntry } from '../src/game/Boarding.js';
import { deckSightlineBlocked } from '../src/game/DeckCamera.js';
import { nearbyDeckStation } from '../src/game/DeckInteraction.js';
import * as THREE from 'three';
import { CrewMotion } from '../src/game/CrewMotion.js';
import { CrewRig } from '../src/game/CrewRig.js';
import { Connection } from '../src/game/Connection.js';
import { surveyStatus, SURVEY_SECONDS } from '../src/game/Survey.js';
import { BubbleTrail, bubblePose, BUBBLE_LIMIT } from '../src/game/BubbleTrail.js';
import { breathPhase, breathEnvelope } from '../src/game/DiverBreath.js';
import { diver, DIVER_EYE } from '../src/game/VesselModels.js';
import { StudyHold } from '../src/game/CrewNaturalist.js';
import { diveLampLevel, diveExposure } from '../src/game/DiveLight.js';
import { voyageSites, courseTarget, courseBearing } from '../src/game/VoyageSites.js';
import assert from 'node:assert/strict';
import { WakeTrail, WAKE_POINTS, WAKE_LIFETIME } from '../src/game/WakeTrail.js';
import { createWorld, addPlayer, CRATE, act, tick, snapshot, RECIPE, setInput, availableActions } from '../src/game/Simulation.js';

test('a pending rejoin keeps its last world visible while input is paused', async () => {
  const connection = new Connection(() => {}, () => {}), world = createWorld();
  connection.receive(world); connection.room = 'same-room'; connection.token = 'fixture-token'; connection.ready = true;
  let rejectRequest;
  connection.request = () => new Promise((resolve, reject) => { rejectRequest = reject; });
  const joining = connection.join('same-room', 'Mira');
  try {
    assert.equal(connection.ready, false);
    assert.equal(connection.interpolated(), world);
  } finally {
    rejectRequest(new Error('Fixture connection cancelled'));
    await assert.rejects(joining, /Fixture connection cancelled/); connection.close();
  }
});

test('anchor feedback distinguishes machinery travel from a cutter still settling', () => {
  assert.equal(anchorStatus({ anchor: true, anchorDrop: .5, speed: 2 }).state, 'Lowering…');
  assert.equal(anchorStatus({ anchor: true, anchorDrop: 1, speed: 2 }).state, 'Setting…');
  assert.equal(anchorStatus({ anchor: true, anchorDrop: 1, speed: -.3 }).description, 'Anchor setting');
  assert.equal(anchorStatus({ anchor: true, anchorDrop: 1, speed: .1 }).state, 'Holding');
  assert.equal(anchorStatus({ anchor: false, anchorDrop: .5, speed: 2 }).state, 'Raising…');
  assert.equal(anchorStatus({ anchor: false, anchorDrop: 0, speed: 2 }).state, 'Raised');
  for (const anchor of [true, false]) assert.equal(anchorStatus({ anchor, speed: 0 }).moving, false, 'Legacy snapshots without deployment do not claim moving gear');
});

test('anchor deployment reverses smoothly, reaches exact endpoints and preserves legacy states', () => {
  const a = { anchor: false, anchorDrop: 1 }, b = { ...a };
  for (let i = 0; i < 40; i++) advanceAnchor(a, 1 / 20);
  for (let i = 0; i < 120; i++) advanceAnchor(b, 1 / 60);
  assert.ok(Math.abs(a.anchorDrop - .5) < 1e-12); assert.ok(Math.abs(a.anchorDrop - b.anchorDrop) < 1e-12);
  a.anchor = true; advanceAnchor(a, .4); assert.ok(Math.abs(a.anchorDrop - .6) < 1e-12);
  advanceAnchor(a, 10); assert.equal(a.anchorDrop, 1);
  a.anchor = false; advanceAnchor(a, 10); assert.equal(a.anchorDrop, 0);
  for (const anchor of [true, false]) { const old = { anchor }; assert.equal(anchorDeployment(old), Number(anchor)); advanceAnchor(old, .05); assert.equal(old.anchorDrop, Number(anchor)); }
  const net = new Connection(() => {}, () => {}), now = performance.now();
  const state = drop => ({ time: drop, ship: { anchorDrop: drop }, cargo: {}, players: {} });
  net.state = state(1); net.samples = [{ at: now - 220, state: state(0) }, { at: now - 20, state: state(1) }];
  assert.ok(Math.abs(net.interpolated().ship.anchorDrop - .5) < .01, 'The rendered deployment interpolates between shared snapshots');
});

test('dive entry spray follows witnessed crew transitions and expires without join or resume bursts', () => {
  const t = new DiveSplashTrail(), p = { id: 'Mira', connected: true, mode: 'deck', x: 20, y: 3, z: 40 };
  assert.equal(t.update([p], 1).length, 0);
  p.mode = 'diver'; p.y = -.8;
  const drops = t.update([p], 1.05); assert.equal(drops.length, 96);
  const d = drops[0], rising = splashPose(d, d.born + .1), falling = splashPose(d, d.born + d.life);
  assert.ok(rising.y > d.y); assert.ok(Math.abs(falling.y - d.y) < 1e-9); assert.ok(falling.opacity < 1e-9);
  assert.equal(t.update([p], 1.1).length, 96, 'Repeated snapshots do not repeat the burst');
  assert.equal(t.update([p], 2.1).length, 0, 'All droplets disappear after falling back');
  assert.equal(new DiveSplashTrail().update([p], 1).length, 0, 'Joining a diver does not imply an entry');
  for (const gap of [-1, 2]) {
    const trail = new DiveSplashTrail(); trail.update([{ ...p, mode: 'deck' }], 3);
    assert.equal(trail.update([p], 3 + gap).length, 0, 'Time discontinuities do not replay events');
  }
  for (const middle of [[], [{ ...p, connected: false }]]) {
    const trail = new DiveSplashTrail(); trail.update([{ ...p, mode: 'deck' }], 1); trail.update(middle, 1.05);
    assert.equal(trail.update([p], 1.1).length, 0, 'Reconnects do not splash');
  }
  for (const mode of ['helm', 'winch', 'deck']) {
    const trail = new DiveSplashTrail(); trail.update([{ ...p, mode }], 1);
    assert.equal(trail.update([p], 1.05).length, 96);
  }
  const deep = new DiveSplashTrail(); deep.update([{ ...p, mode: 'deck' }], 1);
  assert.equal(deep.update([{ ...p, y: -30 }], 1.05).length, 0);
  const crew = Array.from({ length: 4 }, (_, i) => ({ ...p, id: String(i), mode: 'deck' })), all = new DiveSplashTrail();
  all.update(crew, 1); assert.equal(all.update(crew.map(p => ({ ...p, mode: 'diver' })), 1.05).length, SPLASH_LIMIT);
});

test('nearby deck stations follow local walking and respect equipment ownership and readiness', () => {
  const w = createWorld(), p = addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  assert.equal(nearbyDeckStation(w, 'a'), null, 'The arrival walkway keeps the general interaction');
  Object.assign(p, { deckX: 0, deckZ: 5.5 });
  assert.equal(nearbyDeckStation(w, 'a').action, 'helm');
  for (const heading of [0, Math.PI / 2, Math.PI]) { Object.assign(w.ship, { heading, x: 800, z: -200, roll: .2 }); assert.equal(nearbyDeckStation(w, 'a').station, 'helm'); }
  act(w, 'b', 'helm'); assert.equal(nearbyDeckStation(w, 'a').action, null); assert.match(nearbyDeckStation(w, 'a').text, /Rowan/);
  Object.assign(p, { deckX: 1.9, deckZ: -3.1 });
  assert.equal(nearbyDeckStation(w, 'a').action, null); assert.match(nearbyDeckStation(w, 'a').text, /attach/);
  w.cargo.attached = true; assert.equal(nearbyDeckStation(w, 'a').action, 'winch'); assert.match(nearbyDeckStation(w, 'a').text, /closer/);
  Object.assign(w.ship, { x: w.cargo.x, z: w.cargo.z }); assert.match(nearbyDeckStation(w, 'a').text, /ready/);
  w.ship.anchor = false; assert.match(nearbyDeckStation(w, 'a').text, /anchor/); w.ship.anchor = true;
  act(w, 'b', 'winch'); assert.equal(nearbyDeckStation(w, 'a').action, null); assert.match(nearbyDeckStation(w, 'a').text, /Rowan/);
  w.cargo.recovered = true; assert.equal(nearbyDeckStation(w, 'a').action, null); assert.match(nearbyDeckStation(w, 'a').text, /secured/);
  p.mode = 'diver'; assert.equal(nearbyDeckStation(w, 'a'), null);
  p.mode = 'deck'; p.connected = false; assert.equal(nearbyDeckStation(w, 'a'), null);
});

test('the deck radio is reachable locally without taking the helm and explains the crew channel', () => {
  const w=createWorld(),p=addPlayer(w,'a','Mira');
  Object.assign(p,{deckX:RADIO_STATION.x,deckZ:-.9});
  assert.equal(nearbyDeckStation(w,'a').action,'radio');assert.match(nearbyDeckStation(w,'a').text,/solo/);
  const peer=addPlayer(w,'b','Rowan');act(w,'b','helm');
  assert.match(nearbyDeckStation(w,'a').text,/1 crewmate/);assert.equal(w.ship.pilot,'b');
  for(const heading of [0,1,3]){Object.assign(w.ship,{heading,x:400,z:900});assert.equal(nearbyDeckStation(w,'a').action,'radio');}
  peer.connected=false;assert.match(nearbyDeckStation(w,'a').text,/solo/);
  p.deckX=2.5;assert.equal(nearbyDeckStation(w,'a'),null);
  p.deckX=RADIO_STATION.x;p.mode='diver';assert.equal(nearbyDeckStation(w,'a'),null);
});

test('the deck ladder enters beside the modeled ship side and faces open water at every heading', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, 1.1]) {
    const w = createWorld(), p = addPlayer(w, 'a', 'Mira');
    Object.assign(w.ship, { x: 730, z: -240, heading });
    Object.assign(p, { deckX: BOARDING_LADDER.deckX, deckZ: BOARDING_LADDER.z, pitch: -.8 });
    assert.equal(nearbyDeckStation(w, 'a').action, 'dive');
    const entry = boardingEntry(w.ship); act(w, 'a', 'dive');
    for (const key of ['x', 'y', 'z', 'yaw', 'pitch']) assert.equal(p[key], entry[key]);
    const dx = p.x - w.ship.x, dz = p.z - w.ship.z, c = Math.cos(heading), s = Math.sin(heading);
    assert.ok(Math.abs(c * dx - s * dz - BOARDING_LADDER.entryX) < 1e-9);
    assert.ok(Math.abs(s * dx + c * dz - BOARDING_LADDER.z) < 1e-9);
    assert.ok(Math.abs(Math.sin(p.yaw) * c - Math.cos(p.yaw) * s - 1) < 1e-9, 'Initial view points outboard');
    assert.ok(availableActions(w, 'a').includes('board'), 'A newly entered diver can climb straight back aboard');
    act(w, 'a', 'board'); assert.equal(nearbyDeckStation(w, 'a').station, 'ladder');
    w.ship.speed = 2.1; assert.equal(nearbyDeckStation(w, 'a').action, null); assert.match(nearbyDeckStation(w, 'a').text, /slow/);
    assert.equal(act(w, 'a', 'dive').ok, false);
  }
});

test('deck sightlines respect solid equipment without hiding signals through railings or beyond their target', () => {
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  assert.equal(deckSightlineBlocked(v(0, 3.6, -2), v(0, 4, 200)), true, 'Cabin blocks the forward signal');
  assert.equal(deckSightlineBlocked(v(0, 5.2, -2), v(0, 5.2, 200)), false, 'Looking over the roof remains clear');
  assert.equal(deckSightlineBlocked(v(2.5, 3.6, 5.5), v(0, 4, 200)), false, 'The foredeck has an open view');
  assert.equal(deckSightlineBlocked(v(0, 3.6, -2), v(0, 3.6, -1)), false, 'Equipment beyond a nearby signal does not hide it');
  assert.equal(deckSightlineBlocked(v(0, 2.5, -2), v(8, 2.5, -2)), false, 'Empty recovery deck and thin rails remain clear');
  assert.equal(deckSightlineBlocked(v(0, 2.5, -2), v(8, 2.5, -2), true), true, 'The recovered archive blocks that sightline');
  assert.equal(deckSightlineBlocked(v(0, 3, -6), v(0, 3, -2)), true, 'Winch housing is solid');
  assert.equal(deckSightlineBlocked(v(0, 5.6, -8), v(0, 5.6, -4)), true, 'The lifting crossbeam is solid');
  assert.equal(deckSightlineBlocked(v(0, 5.9, -8), v(0, 5.9, -4)), false, 'No follow-camera padding is used');
  assert.equal(deckSightlineBlocked(v(2.4, 4, -8), v(2.4, 4, -4)), true, 'Lifting pillars occlude narrow sightlines');
  assert.equal(deckSightlineBlocked(v(0, 3, 5.5), v(0, 3, 10)), true, 'The helm console is solid');
  assert.equal(deckSightlineBlocked(v(0, 3, 0), v(0, 3, 0)), false, 'A signal at the eye has no useful sightline');
});
import { oceanFloor } from '../src/underwater/OceanDomain.js';
import { normalizeSettings } from '../src/game/GameSettings.js';
import { objectiveFor, objectiveDistance, recoveryStatus, missionGuidance } from '../src/game/Guidance.js';
import { vesselSoundMix, engineSpatialMix } from '../src/game/ExpeditionSound.js';
import { recoveryRigState } from '../src/game/RecoveryRig.js';
import { crewTarget } from '../src/game/CrewTracking.js';
import { crewActivities, crewActivityLabel } from '../src/game/CrewActivities.js';
import { wreckSite } from '../src/game/WreckSite.js';
import { activeCrewCalls, CALL_LIFETIME } from '../src/game/CrewCalls.js';
import { disconnectPlayer } from '../src/game/Simulation.js';
import { clearDeckCamera, deckFollowPose } from '../src/game/DeckCamera.js';
import { vesselLightLevel, updateVesselLighting, WORK_LIGHTS, WORK_LIGHT_DIRECTION } from '../src/game/VesselLighting.js';
import { U } from '../src/core/SharedUniforms.js';
import referenceDepths from './fixtures/terrain-depths.json' with { type: 'json' };
import { helmRigState } from '../src/game/HelmRig.js';
import { onWalkableDeck } from '../src/game/Deck.js';
import { CrewFootsteps } from '../src/game/CrewFootsteps.js';

test('crew footsteps count deck travel without ship-motion steps or reconnect bursts', () => {
  const tracker=new CrewFootsteps(),p={id:'a',connected:true,mode:'deck',deckX:0,deckZ:0,x:0,z:0},w={time:0,players:{a:p}},right={x:1,z:0};
  assert.deepEqual(tracker.update(w,'a',right),[]);
  for(let i=0;i<2;i++){w.time+=.15;p.deckZ+=.3;p.z+=.3;assert.deepEqual(tracker.update(w,'a',right),[]);}
  w.time+=.15;p.deckZ+=.3;p.z+=.3;assert.deepEqual(tracker.update(w,'a',right),[{id:'a',strength:.07,pan:0}]);
  assert.deepEqual(tracker.update(w,'a',right),[],'Repeated render time cannot repeat a footfall');
  w.time+=.2;p.x+=50;p.z+=50;assert.deepEqual(tracker.update(w,'a',right),[],'World-space ship motion is silent');
  w.time+=.1;p.deckZ+=20;assert.deepEqual(tracker.update(w,'a',right),[],'Teleport clears accumulated distance');
  w.time+=4;p.deckZ+=2;assert.deepEqual(tracker.update(w,'a',right),[],'A long update gap cannot queue old footsteps');
  w.time=0;assert.deepEqual(tracker.update(w,'a',right),[]);
  p.mode='helm';tracker.update(w,'a',right);assert.equal(tracker.states.size,0);
  p.mode='deck';tracker.update(w,'a',right);p.connected=false;tracker.update(w,'a',right);assert.equal(tracker.states.size,0);
});

test('nearby crew footsteps follow the listener view, fade with distance and stay out of dive audio', () => {
  const sample=(x,right={x:1,z:0},mode='helm')=>{
    const tracker=new CrewFootsteps(),a={id:'a',mode,connected:true,x:0,z:0},b={id:'b',connected:true,mode:'deck',deckX:x,deckZ:0,x,z:0},w={time:0,players:{a,b}};
    tracker.update(w,'a',right);w.time=.4;b.deckZ=.9;b.z=.9;return tracker.update(w,'a',right);
  };
  const near=sample(2)[0],far=sample(8)[0],reversed=sample(2,{x:-1,z:0})[0];
  assert.ok(near.pan>0&&sample(-2)[0].pan<0);assert.equal(reversed.pan,-near.pan);
  assert.ok(near.strength>far.strength&&near.strength<.07);
  assert.deepEqual(sample(20),[]);assert.deepEqual(sample(2,{x:1,z:0},'diver'),[]);
});

test('propeller phase follows ahead and astern motion, pauses at rest and remains continuous across revolutions', t => {
  const sail = hz => {
    const w = createWorld(), p = addPlayer(w, 'pilot'); act(w, p.id, 'helm'); act(w, p.id, 'anchor');
    for (let i = 0; i < hz * 2; i++) { setInput(w, p.id, { forward: 1 }); tick(w, 1 / hz); }
    return w;
  };
  const w = sail(20), fine = sail(60);
  assert.ok(w.ship.propellerAngle > Math.PI * 2);
  assert.ok(Math.abs(w.ship.propellerAngle - fine.ship.propellerAngle) < .002, 'The shared phase is consistent across simulation rates');
  w.ship.speed = -3; const phase = w.ship.propellerAngle; setInput(w, 'pilot', { forward: -1 }); tick(w);
  assert.ok(w.ship.propellerAngle < phase, 'Astern turns the shaft in reverse');
  w.ship.anchor = true; w.ship.speed = 0; const stopped = w.ship.propellerAngle; tick(w); assert.equal(w.ship.propellerAngle, stopped);
  delete w.ship.propellerAngle; tick(w); assert.equal(w.ship.propellerAngle, 0, 'Legacy stationary voyages initialize safely');
  const a = createWorld(), b = createWorld(); a.time = 1; b.time = 2; a.ship.propellerAngle = 6; b.ship.propellerAngle = 7; a.ship.yawRate = 0; b.ship.yawRate = -.2;
  const net = new Connection(() => {}, () => {}); net.state = b; net.samples = [{ state: a, at: 0 }, { state: b, at: 200 }];
  t.mock.method(performance, 'now', () => 220);
  assert.equal(net.interpolated().ship.propellerAngle, 6.5, 'Crossing a revolution interpolates forward instead of rewinding');
  assert.equal(net.interpolated().ship.yawRate, -.1, 'The visible rudder receives interpolated steering');
});

test('engine stereo follows the listener orientation and distance without hard panning at the source', () => {
  const source = { x: 0, y: 0, z: 0 }, right = { x: 1, y: 0, z: 0 };
  const left = engineSpatialMix(source, { x: 8, y: 3, z: 0 }, right), turned = engineSpatialMix(source, { x: 8, y: 3, z: 0 }, { x: -1, y: 0, z: 0 });
  assert.ok(left.pan < -.5); assert.equal(turned.pan, -left.pan); assert.equal(turned.proximity, left.proximity);
  assert.deepEqual(engineSpatialMix(source, source, right), { pan: 0, proximity: 1 });
  assert.ok(Math.abs(engineSpatialMix(source, { x: .1, y: 0, z: 0 }, right).pan) < .03, 'Crossing the machinery center cannot snap the sound from ear to ear');
  const far = engineSpatialMix(source, { x: 100, y: 0, z: 0 }, right); assert.ok(far.proximity < left.proximity * .1);
  const w = createWorld(), p = addPlayer(w, 'listener');
  assert.equal(vesselSoundMix(w, p, left).enginePan, left.pan);
  assert.ok(vesselSoundMix(w, p, far).engine < vesselSoundMix(w, p, left).engine * .1);
  assert.equal(vesselSoundMix(w, p, left).engineHz, vesselSoundMix(w, p, far).engineHz, 'Moving the listener does not change the engine speed');
});

test('helm instruments follow shared steering, heading and speed while the console blocks deck walking', () => {
  const w=createWorld();w.ship.speed=10/1.944;w.ship.yawRate=-(.12+w.ship.speed*.025);w.ship.heading=1.3;
  assert.deepEqual(helmRigState(w),{wheel:.9,rudder:.55,propeller:0,compass:1.3,speed:0});
  w.ship.yawRate=-w.ship.yawRate;assert.equal(helmRigState(w).wheel,-.9);
  w.ship.yawRate=0;assert.ok(helmRigState(w).wheel===0);
  assert.equal(onWalkableDeck(0,6.8),false);assert.equal(onWalkableDeck(0,5.3),true);assert.equal(onWalkableDeck(1.2,6.8),true);
  for (const [knots, angle] of [[0, -2.2], [5, -1.1], [10, 0], [15, 1.1], [20, 2.2], [30, 2.2], [-5, -1.1]]) {
    w.ship.speed = knots / 1.944;
    assert.ok(Math.abs(helmRigState(w).speed - angle) < 1e-12, 'The needle matches the printed knots scale, including astern speed magnitude');
  }
});

test('terrain fast paths preserve the original habitat cores, blend boundaries and trench depths', () => {
  // Captured from the sampler before its zero-weight work was removed.
  for (const { x, z, recipe, depth } of referenceDepths) assert.equal(oceanFloor(x, z, recipe), depth);
});

test('work lights adapt to weather and remain fixed to a heaving, rolling deck', () => {
  assert.equal(vesselLightLevel(.6, 0), 0); assert.equal(vesselLightLevel(0, 0), 1); assert.equal(vesselLightLevel(.6, 1), .85);
  const ship = new THREE.Group(); ship.position.set(-140, 1.8, 440); ship.rotation.set(.2, 1.8, -.15);
  const oldSun = U.uSunDir.value.clone(), oldStorm = U.uStormFactor.value;
  U.uSunDir.value.set(0, .04, 1); U.uStormFactor.value = 0; updateVesselLighting(ship);
  WORK_LIGHTS.forEach((point, i) => assert.ok(U[`uVesselWorkLight${i}`].value.distanceTo(ship.localToWorld(new THREE.Vector3(...point))) < 1e-10));
  assert.ok(U.uVesselWorkDirection.value.distanceTo(new THREE.Vector3(...WORK_LIGHT_DIRECTION).transformDirection(ship.matrixWorld)) < 1e-10);
  const point = ship.localToWorld(new THREE.Vector3(0, 1.72, -4));
  assert.ok(Math.abs(U.uVesselDeckPlane.value.dot(new THREE.Vector4(point.x, point.y, point.z, 1))) < 1e-10);
  U.uSunDir.value.copy(oldSun); U.uStormFactor.value = oldStorm; U.uVesselLightLevel.value = 0;
});

test('deck follow camera tracks local walking and clears the cabin, winch and recovered archive', () => {
  const a = deckFollowPose({ deckX: 2.5, deckZ: -1.7 }, 0, .3, 7.5);
  const b = deckFollowPose({ deckX: 2.5, deckZ: -.7 }, 0, .3, 7.5);
  assert.ok(b.position.z > a.position.z + .8);
  const target = new THREE.Vector3(0, 3.15, 5.5), blocked = new THREE.Vector3(0, 3.5, 0);
  assert.ok(clearDeckCamera(target, blocked).z > 4.75, 'The segment stops outside the cabin');
  const cargoTarget = new THREE.Vector3(2.5, 3.15, -2), cargoDesired = new THREE.Vector3(-2.5, 3.15, -2);
  assert.ok(clearDeckCamera(cargoTarget, cargoDesired, true).x > 1.25, 'Recovered cargo also blocks the camera');
  for (const [x, z] of [[2.5, -1.7], [-2.5, -1.7], [0, 5.5], [0, 7], [2.5, -5.5], [2.4, -5.8], [-2.4, -5.8], [0, -3.3]]) for (const distance of [3, 7.5, 15]) for (let i = 0; i < 36; i++) {
    const pose = deckFollowPose({ deckX: x, deckZ: z }, i * Math.PI / 18, .3, distance, true);
    assert.ok(pose.position.toArray().every(Number.isFinite)); assert.ok(pose.position.distanceTo(pose.target) > .2);
    const c = pose.position;
    assert.ok(!(Math.abs(c.x) < 2.15 && c.y > 1.8 && c.y < 4.45 && c.z > -.15 && c.z < 4.75));
  }
});

test('crew calls authenticate their sender, limit repeats and acknowledge an exact live request', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Ada'); addPlayer(w, 'b', 'Bo');
  assert.equal(act(w, 'a', 'crewCall', { kind: 'pickup' }).ok, false, 'An aboard player cannot request a diver pickup');
  assert.equal(act(w, 'a', 'crewCall', { kind: '<script>' }).ok, false);
  assert.equal(act(w, 'missing', 'crewCall', { kind: 'slow' }).ok, false);
  assert.equal(act(w, 'a', 'crewCall', { kind: 'slow', owner: 'b' }).ok, true);
  const call = w.calls.a; assert.equal(call.owner, 'a'); assert.equal(w.calls.b, undefined);
  assert.equal(act(w, 'a', 'crewCall', { kind: 'ready' }).ok, false);
  assert.equal(act(w, 'a', 'acknowledgeCall', { owner: 'a', callId: call.id }).ok, false);
  assert.equal(act(w, 'b', 'acknowledgeCall', { owner: 'a', callId: call.id + 1 }).ok, false);
  assert.equal(act(w, 'b', 'acknowledgeCall', { owner: 'a', callId: call.id }).ok, true);
  const revision = w.revision;
  assert.equal(act(w, 'b', 'acknowledgeCall', { owner: 'a', callId: call.id }).ok, true);
  assert.equal(w.revision, revision, 'A duplicate acknowledgement is idempotent');
  disconnectPlayer(w, 'b'); assert.equal(call.acknowledgedBy, null, 'A departed helper releases the request');
  w.time += 3.1; assert.equal(act(w, 'a', 'crewCall', { kind: 'ready' }).ok, true);
  assert.equal(activeCrewCalls(w).length, 1, 'A sender has only one active call');
  w.time += CALL_LIFETIME; tick(w); assert.equal(activeCrewCalls(w).length, 0);
});

test('pickup calls clear on boarding and calls do not return after their sender disconnects', () => {
  const w = createWorld(); addPlayer(w, 'a'); act(w, 'a', 'dive');
  assert.equal(act(w, 'a', 'crewCall', { kind: 'pickup' }).ok, true);
  act(w, 'a', 'rescue'); tick(w); assert.equal(activeCrewCalls(w).length, 0);
  w.time += 3.1; act(w, 'a', 'crewCall', { kind: 'thanks' });
  disconnectPlayer(w, 'a'); addPlayer(w, 'a'); assert.equal(activeCrewCalls(w).length, 0);
});

test('procedural wreck stays finite and leaves the archive lifting path clear', () => {
  const wreck = wreckSite(); wreck.updateMatrixWorld(true);
  let triangles = 0, meshes = 0;
  wreck.traverse(o => { if (!o.isMesh) return; meshes++; const p = o.geometry.attributes.position;
    assert.ok([...p.array].every(Number.isFinite)); assert.ok([...o.geometry.attributes.normal.array].every(Number.isFinite)); triangles += (o.geometry.index?.count || p.count) / 3;
  });
  assert.ok(meshes <= 7 && triangles < 20000, 'Detail stays batched and bounded');
  for (const dx of [-1.2, 0, 1.2]) for (const dz of [-.9, 0, .9]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(CRATE.x + dx, 10, CRATE.z + dz), new THREE.Vector3(0, -1, 0), 0, 10 - CRATE.y + 1);
    assert.equal(ray.intersectObject(wreck, true).length, 0, 'The whole crate can rise vertically without passing through wreckage');
  }
});

test('crew activities offer useful work without taking the occupied helm or bypassing station rules', () => {
  const w = createWorld(); addPlayer(w, 'captain', 'Mira'); addPlayer(w, 'crew', 'Rowan'); act(w, 'captain', 'helm');
  const model = crewActivities(w, 'crew');
  assert.match(model.intro, /Mira has the helm/);
  assert.equal(model.jobs.find(j => j.recommended).id, 'mission');
  w.ship.anchor = false;
  assert.equal(crewActivities(w, 'crew').jobs.find(j => j.recommended).action, 'lookout');
  w.ship.anchor = true;
  assert.equal(model.jobs.find(j => j.id === 'navigate').enabled, true);
  assert.equal(model.jobs.find(j => j.id === 'recover').enabled, false);
  w.ship.speed = 3;
  assert.equal(crewActivities(w, 'crew').jobs.find(j => j.id === 'dive').enabled, false);
  assert.equal(w.ship.pilot, 'captain');
  w.ship.speed = 0; act(w, 'crew', 'dive');
  const underwater = crewActivities(w, 'crew');
  assert.equal(underwater.jobs.find(j => j.id === 'dive').action, 'study');
  assert.equal(underwater.jobs.find(j => j.id === 'lookout').enabled, false);
  assert.equal(underwater.jobs.find(j => j.id === 'recover').enabled, false);
  Object.assign(w.players.crew, CRATE); Object.assign(w.ship, { x: CRATE.x, z: CRATE.z });
  assert.equal(crewActivities(w, 'crew').jobs.find(j => j.id === 'recover').enabled, true);
  act(w, 'crew', 'rescue'); w.cargo.recovered = true; w.mission = 'return';
  const returning = crewActivities(w, 'crew').jobs.find(j => j.id === 'recover');
  assert.equal(returning.action, 'deliver'); assert.equal(returning.enabled, false);
  Object.assign(w.ship, { x: -140, z: 440 });
  assert.equal(crewActivities(w, 'crew').jobs.find(j => j.id === 'recover').enabled, true);
  act(w, 'crew', 'deliver');
  assert.equal(crewActivities(w, 'crew').jobs.find(j => j.id === 'recover').action, 'chart');
});

test('blocked crew duties offer contextual radio requests only when another aboard crewmate can help', () => {
  const w = createWorld(), captain = addPlayer(w, 'captain', 'Mira'), crew = addPlayer(w, 'crew', 'Rowan');
  act(w, 'captain', 'helm'); w.ship.speed = 3;
  const job = (id, who = 'crew') => crewActivities(w, who).jobs.find(j => j.id === id);
  assert.equal(job('dive').request.kind, 'slow');
  assert.equal(job('dive', 'captain').request, undefined, 'The captain can slow directly');
  act(w, 'crew', 'course', { destination: 'reef' });
  assert.equal(job('survey').request.kind, 'slow'); assert.equal(job('dive').request, undefined, 'One request fits the current dive briefing');
  w.ship.speed = 0; assert.equal(job('survey').request, undefined);
  crew.mode = 'diver'; Object.assign(w.ship, { x: CRATE.x, z: CRATE.z, anchor: false });
  assert.equal(job('recover').request.kind, 'anchor');
  w.ship.x += 40; assert.equal(job('recover').request, undefined, 'Do not ask to anchor beyond cable range');
  w.cargo.attached = true; assert.equal(job('recover').request.kind, 'winch');
  w.winch = 'captain'; assert.equal(job('recover').request, undefined);
  w.winch = null; captain.connected = false; assert.equal(job('recover').request, undefined);
  captain.connected = true; captain.mode = 'diver'; assert.equal(job('recover').request, undefined, 'A submerged crew cannot operate the deck machinery');
  captain.mode = 'deck'; w.cargo.recovered = true; assert.equal(job('recover').request, undefined);
});

test('survey briefings follow the plotted habitat and reveal only eligible active scanners', () => {
  const w = createWorld(), a = addPlayer(w, 'a', 'Rowan'), b = addPlayer(w, 'b', 'Mira');
  assert.equal(crewActivities(w, 'a').jobs.some(j => j.id === 'survey'), false);
  act(w, 'a', 'course', { destination: 'reef' });
  const site = voyageSites({ seed: w.seed }).find(s => s.id === 'reef');
  w.ship.speed = 3;
  assert.equal(crewActivities(w, 'a').jobs.find(j => j.id === 'survey').enabled, false);
  w.ship.speed = 0;
  Object.assign(a, { mode: 'diver', x: site.x, y: site.y, z: site.z });
  Object.assign(b, { mode: 'diver', x: site.x, y: site.y, z: site.z });
  setInput(w, 'a', { survey: true }); tick(w);
  const visible = snapshot(w);
  assert.equal(visible.players.a.surveying, true); assert.equal(visible.players.b.surveying, false);
  assert.equal(visible.players.a.input, undefined, 'Roster status does not expose raw controls');
  assert.match(crewActivityLabel(visible.players.a), /^Surveying/);
  const job = crewActivities(visible, 'b').jobs.find(j => j.id === 'survey');
  assert.equal(job.recommended, true); assert.equal(job.button, 'Show survey controls'); assert.match(job.detail, /Rowan scanning/);
  assert.ok(job.progress > 0); assert.match(job.detail, /combined diver effort/);
  a.x += 100; assert.equal(snapshot(w).players.a.surveying, false, 'A held key outside range cannot claim active work');
  a.x = site.x; a.connected = false; assert.equal(snapshot(w).players.a.surveying, false);
  a.connected = true; for (let i = 0; i < 15; i++) tick(w);
  assert.equal(snapshot(w).players.a.surveying, false, 'Expired input stops the roster status');
  Object.assign(w.surveys.reef, { completedAt: w.time, seconds: SURVEY_SECONDS });
  setInput(w, 'a', { survey: true }); assert.equal(snapshot(w).players.a.surveying, false, 'A logged site cannot keep someone scanning');
  const logged = crewActivities(snapshot(w), 'b').jobs.find(j => j.id === 'survey');
  assert.equal(logged.action, 'chart'); assert.match(logged.detail, /Logged by Rowan/);
  act(w, 'b', 'course', { destination: null }); assert.equal(crewActivities(w, 'b').jobs.some(j => j.id === 'survey'), true, 'Local survey history remains available without a course');
});

test('exhaled bubbles retain their world positions and do not depend on rendering cadence', () => {
  const simulate = hz => {
    const trail = new BubbleTrail();
    for (let i = 0; i <= hz * 6; i++) trail.update([{ id: 'diver', x: i / hz * 2, y: -12, z: 0 }], i / hz);
    return trail;
  };
  const slow = simulate(20), fast = simulate(144);
  assert.ok(slow.bubbles.length > 10); assert.deepEqual(slow.bubbles.map(b => b.id), fast.bubbles.map(b => b.id));
  slow.bubbles.forEach((b, i) => {
    assert.ok(Math.abs(b.x - fast.bubbles[i].x) < 1e-10);
    assert.ok(breathPhase(b.born, 'diver') >= .38 && breathPhase(b.born, 'diver') < .85, 'Bubbles emerge during the exhale');
    assert.ok(b.x < 12.05, 'Old bubbles stay along the path instead of following the mouth');
    const older = bubblePose(b, b.born + 1), younger = bubblePose(b, b.born + .5);
    assert.ok(older.y > younger.y && older.radius > younger.radius);
  });
  const paused = structuredClone(slow.bubbles); slow.update([{ id: 'diver', x: 12, y: -12, z: 0 }], 6);
  assert.deepEqual(slow.bubbles, paused, 'Repeated snapshots never duplicate a breath');
  slow.update([{ id: 'diver', x: 500, y: -12, z: 0 }], 6.1);
  assert.ok(slow.bubbles.every(b => b.x < 12.05), 'A rescue or teleport cannot leave a bridge of bubbles');
  slow.update([], 11); assert.equal(slow.bubbles.length, 0); assert.equal(slow.states.size, 0, 'Leaving the water ends emission and old bubbles expire');
  fast.update([{ id: 'diver', x: 0, y: -12, z: 0 }], 0); assert.equal(fast.bubbles.length, 0, 'A clock reset clears stale particles');
});

test('bubble count, surface popping and breathing envelopes remain bounded', () => {
  const trail = new BubbleTrail();
  for (let i = 0; i < 300; i++) trail.update(Array.from({ length: 12 }, (_, n) => ({ id: `diver-${n}`, x: n, y: -12, z: 0 })), i / 10);
  assert.ok(trail.bubbles.length > 0 && trail.bubbles.length <= BUBBLE_LIMIT);
  for (let i = 0; i <= 100; i++) {
    const envelope = breathEnvelope(i / 10, 'diver'); assert.ok(envelope >= 0 && envelope <= 1);
  }
  const surface = new BubbleTrail();
  for (let i = 0; i < 100; i++) surface.update([{ id: 'diver', x: 0, y: 3, z: 0 }], i / 10);
  assert.equal(surface.bubbles.length, 0, 'An above-water mouth never emits');
  surface.bubbles = [{ born: 0, x: 0, y: -.3, z: 0, dx: 0, dz: 0, rise: .8, radius: .03, seed: 0 }];
  surface.time = 0; surface.update([], 2); assert.equal(surface.bubbles.length, 0, 'Rising bubbles disappear at the moving surface');
});

test('nearby divers share a habitat survey, retain partial progress and record its contributors once', () => {
  const w = createWorld(), site = voyageSites().find(s => s.id === 'reef');
  const a = addPlayer(w, 'a', 'Rowan'), b = addPlayer(w, 'b', 'Mira');
  for (const p of [a, b]) Object.assign(p, { mode: 'diver', x: site.x, y: site.y, z: site.z });
  assert.equal(act(w, 'a', 'course', { destination: site.id }).ok, true);
  const scan = n => { for (let i = 0; i < n; i++) { setInput(w, 'a', { survey: true }); setInput(w, 'b', { survey: true }); tick(w); } };
  scan(40); assert.ok(Math.abs(w.surveys.reef.seconds - 4) < 1e-9, 'Two divers supply four seconds of work in two seconds');
  assert.equal(w.surveys.reef.completedAt, null); assert.equal(w.surveys.reef.active, 2);
  act(w, 'a', 'course', { destination: 'kelp' }); scan(20);
  assert.equal(w.surveys.reef.active, 2, 'Divers keep surveying their actual location when the captain changes course'); assert.equal(w.surveys.kelp, undefined, 'A course change cannot scan another habitat remotely');
  act(w, 'a', 'course', { destination: 'reef' }); scan(40);
  assert.equal(w.surveys.reef.seconds, SURVEY_SECONDS); assert.equal(surveyStatus(w, 'a').complete, true);
  assert.deepEqual(w.surveys.reef.contributors, [{ id: 'a', name: 'Rowan' }, { id: 'b', name: 'Mira' }]);
  const record = structuredClone(w.surveys.reef), revision = w.revision;
  scan(100); assert.deepEqual(w.surveys.reef, record); assert.equal(w.revision, revision, 'Holding scan never awards a completed site twice');
  assert.match(w.log, /Rowan & Mira/); assert.equal(w.mission, 'outbound'); assert.equal(w.cargo.attached, false);
  act(w, 'a', 'course', { destination: null }); assert.equal(surveyStatus(w, 'a').site.id, 'reef');
  assert.deepEqual(snapshot(w).surveys.reef, record, 'Mission guidance retains the expedition survey log');
});

test('survey validation requires deliberate live input at the actual dive site and depth', () => {
  const site = voyageSites().find(s => s.id === 'reef');
  for (const invalid of ['aboard', 'far', 'above', 'surface', 'disconnected', 'string', 'number']) {
    const w = createWorld(), p = addPlayer(w, 'a');
    Object.assign(p, { mode: 'diver', x: site.x, y: site.y, z: site.z });
    act(w, 'a', 'course', { destination: 'reef' });
    if (invalid === 'aboard') p.mode = 'deck';
    if (invalid === 'far') p.x += 30;
    if (invalid === 'above') p.y += 20;
    if (invalid === 'surface') p.y = 0;
    setInput(w, 'a', { survey: invalid === 'string' ? 'true' : invalid === 'number' ? 1 : true });
    if (invalid === 'disconnected') p.connected = false;
    tick(w); assert.deepEqual(w.surveys, {}, invalid);
  }
  const w = createWorld(), p = addPlayer(w, 'a');
  Object.assign(p, { mode: 'diver', x: site.x, y: site.y, z: site.z }); act(w, 'a', 'course', { destination: 'reef' });
  setInput(w, 'a', { survey: true });
  for (let i = 0; i < 60; i++) tick(w);
  assert.ok(w.surveys.reef.seconds > 0 && w.surveys.reef.seconds < .7, 'A lost heartbeat cannot leave the scanner running');
  const paused = w.surveys.reef.seconds; setInput(w, 'a', {}); tick(w);
  assert.equal(w.surveys.reef.seconds, paused); assert.equal(w.surveys.reef.active, 0);
  assert.equal(surveyStatus({ ...w, surveys: undefined }, 'a'), null, 'Older servers do not advertise unavailable survey controls');
});

test('crew gait follows local movement consistently across render rates and snapshot pauses', () => {
  const simulate = hz => {
    const p = addPlayer(createWorld(), 'walker'), motion = new CrewMotion();
    let pose = motion.update(p, 0);
    for (let i = 1; i <= hz; i++) { p.deckZ += 2.5 / hz; pose = motion.update(p, i / hz); }
    return { p, motion, pose };
  };
  const a = simulate(30), b = simulate(144);
  assert.ok(a.pose.walk > .99);
  assert.ok(Math.abs(a.pose.walk - b.pose.walk) < 1e-10, 'Walking strength does not depend on rendering cadence');
  assert.deepEqual(a.motion.update(a.p, 1), a.pose, 'Repeated snapshots retain their pose');
  a.p.x += 100; a.p.z += 100;
  assert.ok(a.motion.update(a.p, 1.1).walk < a.pose.walk, 'Ship motion cannot create deck footsteps');
  assert.ok(a.motion.update(a.p, 2).walk < .001, 'Stopped feet settle back to idle');
  a.p.deckZ += 100; assert.equal(a.motion.update(a.p, 2.1).walk < .001, true, 'Teleporting does not create a burst of motion');
  a.p.mode = 'helm'; assert.equal(a.motion.update(a.p, 2.2).walk, 0);
});

test('divers lean into forward strokes while their eyes and aim stay aligned with the player', () => {
  const root = diver(0), rig = new CrewRig(root), motion = new CrewMotion();
  const p = addPlayer(createWorld(), 'swimmer'); p.mode = 'diver'; p.yaw = .8; p.pitch = .35;
  motion.update(p, 0);
  const heading = new THREE.Vector3(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch));
  let pose;
  for (let i = 1; i <= 60; i++) { p.x += heading.x * 5 / 60; p.y += heading.y * 5 / 60; p.z += heading.z * 5 / 60; pose = motion.update(p, i / 60); }
  assert.ok(pose.swim > .99 && pose.bodyPitch > 1, 'Forward swimming becomes horizontal');
  assert.ok(Math.abs(pose.knees[0] - pose.knees[1]) > .01, 'Legs alternate kicks');
  const eye = rig.apply(pose, true);
  root.rotation.y = p.yaw; root.position.set(p.x, p.y, p.z).sub(eye.applyQuaternion(root.quaternion));
  const actualEye = rig.head.localToWorld(new THREE.Vector3(...DIVER_EYE));
  assert.ok(actualEye.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 1e-10);
  const actualAim = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.head.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(actualAim.distanceTo(heading) < 1e-10, 'The head looks along the real camera direction');
  const hoseEnd = rig.hose.at(-1).localToWorld(new THREE.Vector3(0, .5, 0));
  const regulator = rig.head.localToWorld(new THREE.Vector3(0, .14, .235));
  assert.ok(hoseEnd.distanceTo(regulator) < 1e-10, 'The breathing hose stays attached while the head counter-rotates');
  assert.equal(rig.cameraInside(actualEye), true, 'An overlapping swimming helmet is suppressed');
  assert.equal(rig.cameraInside(actualEye.clone().add(new THREE.Vector3(4, 0, 0))), false);
  assert.ok(rig.joints.every(j => j.fin.visible));
  p.mode = 'deck'; rig.apply(motion.update(p, 1.1), false);
  assert.ok(rig.joints.every(j => !j.fin.visible), 'Deck crew walk in boots');
  assert.equal(rig.pose.rotation.x, 0, 'Boarding restores an upright body');
});

test('stowed fin assemblies do not hide nearby deck crew', () => {
  const root = diver(0), rig = new CrewRig(root);
  const eyeBesideFin = new THREE.Vector3(.145, -.78, .53);
  assert.equal(rig.cameraInside(eyeBesideFin, 0), true, 'An extended fin occupies this part of the camera clearance bounds');
  for (const j of rig.joints) j.fin.visible = false;
  assert.equal(rig.cameraInside(eyeBesideFin, 0), false, 'Hidden fin children must not extend the deck body bounds');
  assert.equal(rig.cameraInside(new THREE.Vector3(0, .4, 0), 0), true, 'The visible body still protects the camera');
});

test('crew tracking follows live player positions, depth and connection state', () => {
  const w = createWorld(), self = addPlayer(w, 'a'), peer = addPlayer(w, 'b', 'Mira');
  Object.assign(self, { x: 0, y: 0, z: 0 }); Object.assign(peer, { x: 3, y: -4, z: 0, mode: 'diver' });
  const target = crewTarget(w, 'a', 'b');
  assert.equal(target.distance, 5); assert.equal(target.detail, '4 m deep'); assert.equal(target.label, 'Mira');
  w.ship.x += 1000; assert.equal(crewTarget(w, 'a', 'b').distance, 5, 'Aboard or diving, range is measured between players');
  peer.y = -12; assert.equal(crewTarget(w, 'a', 'b').detail, '12 m deep');
  peer.mode = 'deck'; assert.equal(crewTarget(w, 'a', 'b').detail, 'On deck');
  peer.connected = false; assert.equal(crewTarget(w, 'a', 'b'), null, 'Disconnected positions are not shown as live');
  peer.connected = true; assert.equal(crewTarget(w, 'a', 'b').label, 'Mira');
  for (const id of ['a', '', 'missing']) assert.equal(crewTarget(w, 'a', id), null);
  peer.x = NaN; assert.equal(crewTarget(w, 'a', 'b'), null);
});

test('recovery machinery follows shared lift progress and stops under every lift blocker', () => {
  const w = createWorld(); addPlayer(w, 'operator');
  w.ship.x = CRATE.x; w.ship.z = CRATE.z; w.ship.anchor = true; w.cargo.attached = true;
  assert.equal(recoveryRigState(w).waiting, true);
  act(w, 'operator', 'winch'); const before = recoveryRigState(w);
  tick(w, 1); const after = recoveryRigState(w);
  assert.equal(after.active, true); assert.ok(after.drum < before.drum);
  assert.ok(Math.abs((after.drum - before.drum) * .47 + 2.2) < 1e-10);
  assert.deepEqual(recoveryRigState(snapshot(w)), after, 'A joining spectator sees the same pose without local animation history');
  for (const blocker of ['anchor', 'range', 'operator']) {
    const paused = structuredClone(w);
    if (blocker === 'anchor') paused.ship.anchor = false;
    if (blocker === 'range') paused.ship.x += 40;
    if (blocker === 'operator') paused.winch = null;
    const pose = recoveryRigState(paused); tick(paused, .1);
    assert.equal(recoveryRigState(paused).drum, pose.drum, `${blocker} pauses the machinery`);
    assert.equal(pose.waiting, true); assert.equal(pose.lever, 0);
  }
  w.cargo.y = 1.99; tick(w, .1);
  const secured = recoveryRigState(w); tick(w, .1);
  assert.equal(secured.waiting, false); assert.equal(secured.lever, 0);
  assert.equal(recoveryRigState(w).drum, secured.drum, 'The secured archive does not keep turning the drum');
});

test('wake deposits stay behind through turns, expire when stopped, and remain bounded', () => {
  const wake = new WakeTrail(), ship = { x: 0, z: 0, heading: 0, speed: 8 };
  for (let t = 0; t < 4; t += .1) { ship.z = t * 8; wake.update(ship, t); }
  const deposited = structuredClone(wake.points[0]);
  ship.heading = Math.PI / 2;
  for (let t = 4; t < 8; t += .1) { ship.x = (t - 4) * 8; wake.update(ship, t); }
  assert.deepEqual(wake.points[0], deposited, 'turning never transforms deposited foam');
  for (let t = 8; t < 80; t += .1) { ship.x = (t - 4) * 8; assert.ok(wake.update(ship, t).length <= WAKE_POINTS); }
  ship.speed = 0;
  assert.ok(wake.update(ship, 80).length > 0, 'stopping leaves a fading wake');
  for (let t = 80; t < 81 + WAKE_LIFETIME; t += .1) wake.update(ship, t);
  assert.equal(wake.points.length, 0);
});

test('wake resets across teleports or clock resets instead of spanning the ocean', () => {
  const wake = new WakeTrail(), ship = { x: 0, z: 0, heading: 0, speed: 5 };
  wake.update(ship, 1); ship.z = 5; wake.update(ship, 2);
  ship.x = 1000;
  assert.equal(wake.update(ship, 2.1).length, 1);
  assert.equal(wake.update(ship, 0).length, 1);
});

test('dive guidance follows cable eligibility and switches to the moving ship after attachment', () => {
  const w = createWorld(), p = addPlayer(w, 'a'); p.mode = 'diver'; Object.assign(p, CRATE);
  assert.match(objectiveFor(w, 'a').hint, /cable cannot reach/);
  assert.equal(objectiveFor(w, 'a').key, 'ship');
  Object.assign(w.ship, { x: CRATE.x, z: CRATE.z, anchor: false });
  assert.match(objectiveFor(w, 'a').hint, /deploy the anchor/);
  w.ship.anchor = true;
  assert.match(objectiveFor(w, 'a').hint, /F to attach/);
  w.cargo.attached = true;
  assert.equal(objectiveFor(w, 'a').key, 'ship');
  assert.equal(objectiveFor(w, 'a').x, w.ship.x);
  assert.match(objectiveFor(w, 'a').hint, /Ascend/);
});

test('quiet recovery guidance yields to the readout only while positioned for lifting', () => {
  const w = createWorld(), p = addPlayer(w, 'a'); w.cargo.attached = true;
  Object.assign(w.ship, { x: w.cargo.x, z: w.cargo.z, anchor: true });
  for (const mode of ['deck', 'helm', 'winch']) {
    p.mode = mode;
    assert.equal(objectiveFor(w, 'a', { quiet: true }), null);
    assert.equal(objectiveFor(w, 'a').key, 'lift', 'Tools retains the full objective');
  }
  w.ship.x += 34;
  assert.equal(objectiveFor(w, 'a', { quiet: true }).key, 'lift', 'Repositioning needs a bearing');
  w.ship.x = w.cargo.x; w.ship.anchor = false;
  assert.equal(objectiveFor(w, 'a', { quiet: true }).key, 'lift');
  w.ship.anchor = true; p.mode = 'diver';
  assert.equal(objectiveFor(w, 'a', { quiet: true }).key, 'ship', 'Divers still need their boarding guidance');
  p.mode = 'deck'; w.cargo.recovered = true; w.mission = 'return';
  assert.equal(objectiveFor(w, 'a', { quiet: true }).key, 'base');
});

test('recovery feedback distinguishes lift blockers and warns of crew still submerged', () => {
  const w = createWorld(), p = addPlayer(w, 'a'); w.cargo.attached = true;
  assert.match(recoveryStatus(w).text, /move closer/);
  Object.assign(w.ship, { x: CRATE.x, z: CRATE.z });
  assert.match(recoveryStatus(w).text, /operate the winch/);
  w.winch = 'a'; w.cargo.y = (CRATE.y + 2) / 2;
  assert.equal(recoveryStatus(w).progress, .5);
  assert.match(recoveryStatus(w).text, /Lifting/);
  w.ship.anchor = false;
  assert.match(recoveryStatus(w).text, /deploy the anchor/);
  w.cargo.recovered = true; p.mode = 'diver';
  assert.match(recoveryStatus(w).text, /1 diver still/);
  assert.equal(recoveryStatus(w).progress, 1);
  p.mode = 'deck';
  assert.match(recoveryStatus(w).text, /crew aboard/);
});

test('navigation range is measured from the player, independently of chase camera zoom', () => {
  const w = createWorld(), p = addPlayer(w, 'a');
  const target = { x: w.ship.x + 3, y: -40, z: w.ship.z + 4 };
  assert.equal(objectiveDistance(w, 'a', target), 5);
  p.mode = 'diver'; p.x = target.x; p.z = target.z; p.y = -10;
  assert.equal(objectiveDistance(w, 'a', target), 30);
});

test('vessel audio responds to engine load, depth, distance and actual lift eligibility', () => {
  const w = createWorld(), p = addPlayer(w, 'a');
  const idle = vesselSoundMix(w, p); w.ship.speed = 10;
  const ahead = vesselSoundMix(w, p); assert.ok(ahead.engine > idle.engine && ahead.engineHz > idle.engineHz);
  w.ship.speed = -10; assert.equal(vesselSoundMix(w, p).engine, ahead.engine);
  p.mode = 'diver'; p.y = -10; const below = vesselSoundMix(w, p);
  assert.ok(below.cutoff < ahead.cutoff && below.engine < ahead.engine && below.breath > 0);
  p.x += 100; assert.ok(vesselSoundMix(w, p).engine < below.engine * .1);
  p.mode = 'deck'; w.cargo.attached = true; w.winch = 'a'; Object.assign(w.ship, { x: CRATE.x, z: CRATE.z });
  assert.ok(vesselSoundMix(w, p).winch > 0); w.ship.anchor = false; assert.equal(vesselSoundMix(w, p).winch, 0);
  w.ship.anchor = true; w.cargo.recovered = true; assert.equal(vesselSoundMix(w, p).winch, 0);
});

test('windlass sound follows working deployment, spatial range and underwater filtering', () => {
  const w = createWorld(), p = addPlayer(w, 'a');
  assert.equal(vesselSoundMix(w, p).anchor, 0);
  w.ship.anchor = false; w.ship.anchorDrop = .5;
  const raising = vesselSoundMix(w, p, undefined, { pan: -.6, proximity: 1 });
  assert.ok(raising.anchor > 0); assert.equal(raising.anchorPan, -.6);
  w.ship.anchor = true;
  const lowering = vesselSoundMix(w, p); assert.ok(lowering.anchor > 0); assert.ok(lowering.anchorHz < raising.anchorHz);
  w.ship.anchorDrop = .52; assert.notEqual(vesselSoundMix(w, p).anchorRattle, lowering.anchorRattle);
  const far = vesselSoundMix(w, p, undefined, { pan: .6, proximity: .05 }); assert.equal(far.anchorPan, .6); assert.ok(far.anchor < raising.anchor * .1);
  p.mode = 'diver'; p.y = -6;
  const submerged = vesselSoundMix(w, p); assert.ok(submerged.anchorCutoff < lowering.anchorCutoff); assert.ok(submerged.anchor < lowering.anchor * .5);
  for (const anchor of [false, true]) { w.ship.anchor = anchor; w.ship.anchorDrop = Number(anchor); assert.equal(vesselSoundMix(w, p).anchor, 0); }
  delete w.ship.anchorDrop; assert.equal(vesselSoundMix(w, p).anchor, 0, 'Legacy snapshots cannot start a perpetual motor');
});

test('crew signals validate location, limit frequency, replace per player and expire', () => {
  const w = createWorld(), p = addPlayer(w, 'a');
  const point = { x: p.x + 10, y: 0, z: p.z + 10, owner: 'spoof', label: 'spoof' };
  assert.equal(act(w, 'a', 'signal', point).ok, true);
  assert.equal(w.signals.a.owner, 'a'); assert.notEqual(w.signals.a.label, 'spoof');
  assert.equal(act(w, 'a', 'signal', point).ok, false);
  for (let n = 0; n < 42; n++) tick(w);
  assert.equal(act(w, 'a', 'signal', { ...point, x: point.x + 20 }).ok, true);
  assert.equal(Object.keys(w.signals).length, 1); assert.equal(w.signals.a.id, 2);
  assert.deepEqual(snapshot(w).signals, w.signals);
  for (let n = 0; n < 361; n++) tick(w);
  assert.equal(Object.keys(w.signals).length, 0);
});

test('signals reject non-finite, distant, sky, buried and disconnected requests', () => {
  const w = createWorld(), p = addPlayer(w, 'a');
  const point = { x: p.x, y: 0, z: p.z };
  for (const bad of [null, {}, { ...point, x: NaN }, { ...point, z: Infinity }, { ...point, x: '5' }, { ...point, x: point.x + 601 }, { ...point, y: 13 }, { ...point, y: oceanFloor(point.x, point.z, RECIPE) - 3 }]) {
    assert.equal(act(w, 'a', 'signal', bad).ok, false);
  }
  p.connected = false; assert.equal(act(w, 'a', 'signal', point).ok, false);
  assert.equal(Object.keys(w.signals).length, 0);
  p.connected = true; delete w.signals; delete w.signalSequence;
  assert.equal(act(w, 'a', 'signal', point).ok, true, 'rooms created before the update can use signals');
});

test('stored graphics and camera settings tolerate invalid or obsolete preferences', () => {
  assert.deepEqual(normalizeSettings(null), { graphics: 'auto', sensitivity: 1, invertY: false, volume: .5, interface: 'full', immersive: true, alwaysShowControls: false, textScale: 1, readablePanels: false, views: { deck: 'deck', helm: 'chase', winch: 'deck' } });
  assert.deepEqual(normalizeSettings({ graphics: 'unknown', sensitivity: 999, invertY: 'false', volume: -3, interface: 'hidden' }), { graphics: 'auto', sensitivity: 2.5, invertY: false, volume: 0, interface: 'full', immersive: true, alwaysShowControls: false, textScale: 1, readablePanels: false, views: { deck: 'deck', helm: 'chase', winch: 'deck' } });
  assert.equal(normalizeSettings({ alwaysShowControls: true }).alwaysShowControls, true);
  assert.equal(normalizeSettings({ alwaysShowControls: 'true' }).alwaysShowControls, false);
  assert.equal(normalizeSettings({ textScale: 99 }).textScale, 2);
  assert.equal(normalizeSettings({ textScale: '2' }).textScale, 1);
  assert.equal(normalizeSettings({ readablePanels: 'true' }).readablePanels, false);
  assert.equal(normalizeSettings({ interface: 'compact' }).interface, 'compact');
  assert.equal(normalizeSettings({ interface: 'full' }).immersive, true);
  assert.equal(normalizeSettings({ immersive: false }).immersive, false);
  assert.deepEqual(normalizeSettings({ views: { deck: 'chase', helm: 'deck', winch: 'chase' } }).views, { deck: 'chase', helm: 'deck', winch: 'chase' });
  assert.deepEqual(normalizeSettings({ views: { deck: [], helm: 'orbit', winch: null } }).views, { deck: 'deck', helm: 'chase', winch: 'deck' });
});
test('field study requires continuous visibility of the same animal', () => {
  const hold = new StudyHold();
  assert.equal(hold.update('turtle', 100), 0);
  for (let t = 250; t <= 1300; t += 150) hold.update('turtle', t);
  assert.equal(hold.update('turtle', 1300), 1);
  assert.equal(hold.update('ray', 1450), 0, 'Switching animals starts a new study');
  assert.equal(hold.update('ray', 1600), .125);
  assert.equal(hold.update(null, 1750), 0, 'Occlusion breaks the sighting');
  assert.equal(hold.update('ray', 1900), 0);
  assert.equal(hold.update('ray', 5000), 0, 'A suspended/background frame cannot finish a study');
  assert.equal(hold.update('ray', 100), 0, 'Clock reset clears elapsed time');
});

test('automatic dive lighting preserves daylight and follows depth and darkness', () => {
  assert.equal(diveLampLevel('auto', true, 28, .7), 0);
  assert.equal(diveLampLevel('auto', true, 230, .7), 1);
  assert.equal(diveLampLevel('auto', true, 28, .03), .8);
  const levels = [0, 50, 80, 100, 150, 200, 250].map(d => diveLampLevel('auto', true, d, .7));
  assert.ok(levels.every((v, i) => v >= (levels[i - 1] ?? 0) && v <= 1));
  assert.equal(diveLampLevel('off', true, 1400, 0), 0);
  assert.equal(diveLampLevel('on', true, 20, 1), 1);
  assert.equal(diveLampLevel('on', false, 0, 0), 0, 'Boarding always extinguishes the dive light');
  assert.deepEqual(diveExposure(28, 0), { fixedExposure: 2.6, fixedExposureMix: 0 });
  assert.deepEqual(diveExposure(1400, 0), { fixedExposure: 1.5, fixedExposureMix: 1 });
  assert.equal(diveExposure(28, 1).fixedExposureMix, .98, 'Night diving limits eye adaptation around the beam');
});

test('crew courses accept only charted sites and preserve the salvage mission', () => {
  const w = createWorld(); addPlayer(w, 'a'); addPlayer(w, 'b');
  assert.equal(voyageSites().length, 15);
  assert.deepEqual([{ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }].map(p => courseBearing({ x: 0, z: 0 }, p)), [0, 90, 180, 270], 'Courses use the cutter compass orientation');
  for (const site of voyageSites()) assert.ok(site.y > oceanFloor(site.x, site.z, RECIPE), `${site.name} has a reachable dive target`);
  for (const destination of [undefined, 'invented', { x: 1 }, '__proto__']) assert.equal(act(w, 'a', 'course', { destination }).ok, false);
  const cargo = { ...w.cargo }, ship = { ...w.ship };
  assert.equal(act(w, 'b', 'course', { destination: 'kelp', owner: 'spoof' }).ok, true);
  assert.deepEqual(w.course, { id: 'kelp', owner: 'b' }); assert.equal(w.mission, 'outbound');
  assert.deepEqual(w.cargo, cargo); assert.deepEqual(w.ship, ship);
  assert.deepEqual(snapshot(w).course, w.course);
  const surface = courseTarget(w, 'a'); assert.equal(surface.y, 2); assert.match(surface.detail, /m deep/);
  w.players.a.mode = 'diver'; const dive = courseTarget(w, 'a'); assert.ok(dive.y < -10); assert.ok(dive.distance > 0);
  w.players.b.connected = false; assert.equal(act(w, 'b', 'course', { destination: null }).ok, false);
  assert.equal(act(w, 'a', 'course', { destination: null }).ok, true); assert.equal(courseTarget(w, 'a'), null);
});


test('mission guidance follows achievable salvage steps and keeps optional courses deliberate', () => {
  const w = createWorld(), p = addPlayer(w, 'a');
  assert.equal(missionGuidance(w, 'a').action, 'anchor');
  w.ship.anchor = false;
  assert.equal(missionGuidance(w, 'a').action, 'helm');
  p.mode = 'diver';
  assert.match(missionGuidance(w, 'a').text, /cannot reach/);
  Object.assign(w.ship, { x: CRATE.x, z: CRATE.z });
  assert.match(missionGuidance(w, 'a').text, /Return aboard and deploy/);
  w.ship.anchor = true;
  Object.assign(p, CRATE);
  assert.equal(missionGuidance(w, 'a').action, 'attach');
  w.cargo.attached = true;
  assert.match(missionGuidance(w, 'a').title, /Return aboard/);
  p.mode = 'deck';
  assert.equal(missionGuidance(w, 'a').action, 'winch');
  w.cargo.recovered = true; w.mission = 'return';
  assert.match(missionGuidance(w, 'a').title, /home/);
  addPlayer(w, 'diver').mode = 'diver';
  assert.match(missionGuidance(w, 'a').text, /1 diver/);
  act(w, 'a', 'course', { destination: 'reef' });
  assert.equal(crewActivities(w, 'a').jobs.some(j => j.id === 'mission'), false);
});
