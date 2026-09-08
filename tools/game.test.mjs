import { voyageLight, validVoyageLight, DAY_PERIOD } from '../src/game/VoyageLight.js';
import { validPickup, validPickupRecords } from '../src/game/PickupCourse.js';
import { helmCourseState } from '../src/game/HelmCourse.js';
import { helmDepthDigits } from '../src/game/HelmSounder.js';
import { researchExperienceText } from '../src/game/ResearchExperience.js';
import { validInscription } from '../src/game/CrewInscription.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, addPlayer, disconnectPlayer, setInput, act, tick, availableActions, snapshot, BASE, CRATE, STEP, distance } from '../src/game/Simulation.js';
import { createGameServer } from '../server/index.mjs';
import { onWalkableDeck } from '../src/game/Deck.js';
import { voyageEntries, voyageText, validMilestones } from '../src/game/VoyageLog.js';
import { voyageSites } from '../src/game/VoyageSites.js';
import { surveyStatus } from '../src/game/Survey.js';
import { validPlaces, PLACE_LIMIT } from '../src/game/SavedPlaces.js';
import { courseTarget } from '../src/game/VoyageSites.js';
import { stormAfter, weatherOutlook, divePlan, salvagePlan } from '../src/game/WeatherOutlook.js';
import { activeSalvage, validSalvageState } from '../src/game/SalvageVoyages.js';
import { objectiveFor } from '../src/game/Guidance.js';
import { canReply } from '../src/game/CrewCalls.js';
import { validCrewLog } from '../src/game/CrewLog.js';
import { validDiveRecords } from '../src/game/DiveRecords.js';
import { crewActivityLabel, crewActivities } from '../src/game/CrewActivities.js';
import { discoverWrecks, discoveredWrecks, validWreckDiscoveries } from '../src/game/WreckDiscoveries.js';
import { SALVAGE_SITES } from '../src/game/SalvageSites.js';
import { validSightings } from '../src/game/CrewSightings.js';
import { seabedReading } from '../src/game/DepthSounder.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';
import { researchReady, validResearch, researchHarborReason } from '../src/game/ResearchVoyages.js';
import { missionGuidance } from '../src/game/Guidance.js';
import { explorationWeather, validExplorationWeather, FRONT_PERIOD, FRONT_BUILD, FRONT_PEAK, FRONT_EASE, FRONT_END } from '../src/game/ExplorationWeather.js';
import { diveReturnPlan } from '../src/game/DiveReturn.js';

test('shared daylight advances continuously and forecasts a dive returning after dark', () => {
  const w=createWorld(); addPlayer(w,'a','Mira'); assert.ok(Math.abs(voyageLight(w).elevation-.55)<1e-12);
  w.time=1200; const shallow={x:w.ship.x,z:w.ship.z,y:-20},deep={...shallow,y:-600};
  assert.equal(divePlan(w,shallow,30).returnLight,'Afternoon'); assert.equal(divePlan(w,deep,180).returnLight,'Night');
  const forecast=voyageLight(w,420); advance(w,420); assert.ok(Math.abs(voyageLight(w).elevation-forecast.elevation)<1e-10);
  const copy=structuredClone(w); assert.deepEqual(voyageLight(copy),voyageLight(w));
  const before=voyageLight(w); w.time+=DAY_PERIOD; assert.ok(Math.abs(voyageLight(w).elevation-before.elevation)<1e-10);
  assert.equal(validVoyageLight(w),true); assert.equal(validVoyageLight({...w,daylightStart:w.time+1}),false);
  delete w.daylightStart; const legacy=voyageLight(w); tick(w); assert.ok(Math.abs(voyageLight(w).elevation-legacy.elevation)<.001,'Older saves begin from familiar daylight');
});

test('pickup guidance gives a buddy diver swimming directions at the actual depth', () => {
  const w=createWorld(); addPlayer(w,'a','Mira'); addPlayer(w,'b','Rowan'); addPlayer(w,'c','Ivo');
  action(w,'b','dive'); action(w,'c','dive');
  Object.assign(w.players.b,{x:w.ship.x+100,y:-20,z:w.ship.z});
  Object.assign(w.players.c,{x:w.ship.x+70,y:-5,z:w.ship.z});
  assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true);
  const buddy=courseTarget(w,'c'); assert.equal(buddy.y,-20);
  assert.equal(buddy.distance,Math.hypot(30,15));
  assert.match(buddy.hint,/Find Rowan at 20 m depth/); assert.doesNotMatch(buddy.hint,/Sail|slow for boarding/);
  assert.match(courseTarget(w,'a').hint,/Sail toward/);
  assert.match(courseTarget(w,'b').hint,/Ascend and return alongside Kestrel/);
});

test('pickup history remembers the return method and crew without inventing a rescue', () => {
  const w=createWorld(); addPlayer(w,'a','Mira'); addPlayer(w,'b','Rowan'); addPlayer(w,'c','Ivo');
  action(w,'b','dive'); assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true);
  advance(w,3); assert.equal(act(w,'c','pickupCourse',{diver:'b'}).ok,true);
  assert.equal(w.pickup.navigator,'Mira'); assert.equal(w.pickup.time,0);
  action(w,'c','helm'); action(w,'b','board');
  assert.deepEqual(w.pickupRecords[0],{id:1,startedAt:0,time:w.time,diver:'Rowan',navigator:'Mira',pilot:'Ivo',assisted:false});
  tick(w); assert.equal(w.pickupRecords.length,1); assert.equal(w.pickup,null);
  action(w,'b','dive'); assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true); action(w,'b','rescue');
  assert.equal(w.pickupRecords[1].assisted,true); assert.match(voyageText(w),/crew pickup/); assert.match(voyageText(w),/Course set by Mira.*At the helm: Ivo/);
  action(w,'b','dive'); assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true); disconnectPlayer(w,'b');
  assert.equal(w.pickupRecords.length,2,'Losing contact does not create a completed return');
  assert.equal(validPickupRecords(w),true);
  const invalid=structuredClone(w); invalid.pickupRecords[0].time=w.time+1; assert.equal(validPickupRecords(invalid),false);
  assert.equal(validPickupRecords({}),true);
});

test('pickup duties guide the crew through departure, holding and boarding', () => {
  const w=createWorld(); addPlayer(w,'a','Mira'); addPlayer(w,'b','Rowan');
  action(w,'b','dive'); Object.assign(w.players.b,{x:w.ship.x+90,y:-10,z:w.ship.z});
  assert.equal(act(w,'a','course',{destination:'kelp'}).ok,true);
  assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true);
  assert.equal(missionGuidance(w,'a').action,'anchor');
  assert.equal(crewActivities(w,'a').jobs.find(j=>j.recommended).id,'mission');
  assert.match(crewActivities(w,'a').intro,/Pickup in progress/);
  action(w,'a','anchor'); assert.equal(missionGuidance(w,'a').action,'helm');
  Object.assign(w.ship,{x:w.players.b.x,z:w.players.b.z});
  assert.equal(missionGuidance(w,'a').button,'Deploy anchor'); action(w,'a','anchor');
  assert.match(missionGuidance(w,'a').text,/Hold position/);
  assert.equal(missionGuidance(w,'b').action,'glance');
  Object.assign(w.players.b,{x:w.ship.x+7,y:-.5,z:w.ship.z});
  assert.equal(missionGuidance(w,'b').action,'board');
  assert.equal(crewActivities(w,'b').jobs.find(j=>j.recommended).action,'board');
  action(w,'b','board'); tick(w); assert.equal(w.pickup,null);
  assert.equal(crewActivities(w,'a').jobs.some(j=>j.id==='mission'),false);
  assert.equal(w.course.id,'kelp');
});

test('shared pickup navigation follows a diver and restores the expedition course', () => {
  const w=createWorld(); addPlayer(w,'a','Mira'); addPlayer(w,'b','Rowan');
  assert.equal(act(w,'a','course',{destination:'kelp'}).ok,true); const original=structuredClone(w.course);
  assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,false);
  action(w,'b','dive'); Object.assign(w.players.b,{x:w.ship.x+100,z:w.ship.z,y:-10});
  assert.equal(act(w,'b','pickupCourse',{diver:'b'}).ok,false);
  assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true); assert.deepEqual(w.course,original);
  assert.match(courseTarget(w,'a').label,/Rowan.*live pickup/); assert.match(courseTarget(w,'b').label,/Kestrel/);
  assert.equal(courseTarget(w,'a').x,w.players.b.x); assert.match(helmCourseState(w).label,/Rowan/);
  advance(w,30,{b:{forward:1,yaw:Math.PI/2,pitch:0}});
  assert.equal(courseTarget(w,'a').x,w.players.b.x,'The pickup outlasts a radio call and tracks actual swimming');
  assert.equal(validPickup(w),true);
  assert.equal(act(w,'a','cancelPickup').ok,true); assert.deepEqual(w.course,original); assert.equal(courseTarget(w,'a').site.id,'kelp');
  assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true);
  Object.assign(w.players.b,{x:w.ship.x+7,y:-.5,z:w.ship.z}); action(w,'b','board'); tick(w);
  assert.equal(w.pickup,null); assert.deepEqual(w.course,original);
  action(w,'b','dive'); assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true); disconnectPlayer(w,'b');
  assert.equal(w.pickup,null); assert.deepEqual(w.course,original);
  addPlayer(w,'b','Rowan'); assert.equal(act(w,'a','pickupCourse',{diver:'b'}).ok,true);
  assert.equal(act(w,'a','course',{destination:'reef'}).ok,true); assert.equal(w.pickup,null); assert.equal(w.course.id,'reef');
  assert.equal(validPickup({...w,pickup:{diver:'missing',owner:'a',time:w.time}}),false);
});

test('the helm course pointer follows shared navigation and real steering', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  assert.equal(helmCourseState(w), null);
  assert.equal(act(w, 'b', 'course', { destination: 'reef' }).ok, true);
  const site = voyageSites().find(s => s.id === 'reef');
  for (const [x, z, expected] of [[0,-100,0],[100,0,Math.PI/2],[-100,0,-Math.PI/2],[0,100,Math.PI]]) {
    Object.assign(w.ship, { x:site.x+x,z:site.z+z,heading:0 });
    assert.ok(Math.abs(Math.abs(helmCourseState(w).angle)-Math.abs(expected)) < 1e-9);
    if (Math.abs(expected) < Math.PI) assert.ok(Math.abs(helmCourseState(w).angle-expected) < 1e-9);
  }
  Object.assign(w.ship, {x:site.x+100,z:site.z,heading:0});
  action(w,'a','helm'); action(w,'a','anchor');
  const before=helmCourseState(w).angle; advance(w,2,{a:{turn:1}});
  assert.ok(helmCourseState(w).angle < before && helmCourseState(w).angle > 0, 'Steering right brings the right-hand course pointer toward the top index');
  Object.assign(w.players.b,{mode:'diver',x:BASE.x,y:-20,z:BASE.z});
  const pointer=helmCourseState(w); w.players.b.x+=500; assert.deepEqual(helmCourseState(w),pointer);
  Object.assign(w.ship,{x:site.x,z:site.z}); assert.equal(helmCourseState(w),null,'No unstable bearing at the destination');
  assert.equal(act(w,'a','course',{destination:null}).ok,true); assert.equal(helmCourseState(w),null);
});

test('the physical helm sounder follows Kestrel across depths and ignores a remote diver', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  for (const name of ['reef', 'kelp', 'deep']) {
    const site = voyageSites().find(s => s.id === name); Object.assign(w.ship, { x: site.x, z: site.z, y: .7 });
    assert.equal(Number(helmDepthDigits(w)), Math.round(seabedReading(w, 'a').metres));
  }
  const ship = helmDepthDigits(w); Object.assign(w.players.b, { mode: 'diver', x: BASE.x, y: -5, z: BASE.z });
  assert.equal(helmDepthDigits(w), ship); assert.notEqual(Number(ship), Math.round(seabedReading(w, 'b').metres));
  w.ship.y += 5; assert.equal(Number(helmDepthDigits(w)), Number(ship) + 5);
});

test('filed research preserves measured dive experience independently of the rolling dive log', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  action(w, 'a', 'dive'); advance(w, 2); action(w, 'a', 'board');
  w.mission = 'return'; w.cargo.recovered = true; action(w, 'a', 'deliver');
  w.time = 390; w.explorationWeather = { time: 0, storm: 0 }; w.storm = 0;
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, true);
  advance(w, 150); const peak = w.storm; assert.ok(peak >= .55);
  const site = voyageSites().find(s => s.id === 'reef'); Object.assign(w.ship, { x: site.x, z: site.z });
  action(w, 'a', 'dive'); action(w, 'b', 'dive');
  Object.assign(w.players.a, { x: site.x, y: site.y, z: site.z }); const deep = voyageSites().find(s => s.id === 'deep'); Object.assign(w.players.b, { x: deep.x, y: -40, z: deep.z });
  advance(w, 8, { a: { survey: true } });
  action(w, 'b', 'rescue');
  Object.assign(w.players.a, { x: w.ship.x + 7, y: -.5, z: w.ship.z }); action(w, 'a', 'board');
  const observed = structuredClone(w.research.experience);
  assert.equal(observed.dives, 2); assert.equal(observed.beaconReturns, 1);
  assert.ok(Math.abs(observed.diverSeconds - 16) < .001); assert.ok(observed.maximumDepth >= 40);
  assert.equal(observed.strongestStorm, peak);
  // More dives can rotate the general-purpose log; the request keeps its totals.
  for (let i = 0; i < 65; i++) { action(w, 'a', 'dive'); action(w, 'a', 'board'); }
  assert.equal(w.diveRecords.length, 64); assert.equal(w.research.experience.dives, 67);
  Object.assign(w.ship, BASE); action(w, 'a', 'fileResearch');
  const report = structuredClone(w.researchHistory.at(-1));
  assert.equal(report.experience.maximumDepth, observed.maximumDepth);
  assert.match(researchExperienceText(report), /67 completed dives.*40 m deepest.*rough.*1 safety-beacon return/);
  assert.match(voyageText(w), /Strongest seas during request: rough/);
  advance(w, 500); action(w, 'a', 'dive'); advance(w, 2); action(w, 'a', 'board');
  assert.deepEqual(w.researchHistory.at(-1), report, 'Later weather and dives cannot rewrite a filed report');
  assert.equal(validResearch(w), true);
  const invalid = structuredClone(w); invalid.researchHistory[0].experience.diverSeconds = 1e9; assert.equal(validResearch(invalid), false);
  delete invalid.researchHistory[0].experience; assert.equal(validResearch(invalid), true, 'Older reports remain valid without invented measurements');
});

test('crew inscriptions belong to the ship and protect a crewmate’s harbor edit', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  assert.equal(validInscription(w), true);
  const write = (id, text, expectedRevision = 0) => act(w, id, 'inscribeShip', { text, expectedRevision });
  assert.equal(write('a', 'Leave no diver behind').ok, true);
  assert.equal(w.ship.inscription.author, 'Mira');
  assert.equal(write('b', 'Our ocean home').ok, false, 'A stale draft cannot replace the crew inscription');
  assert.equal(write('b', 'Our ocean home', 1).ok, true);
  assert.equal(write('b', 'Our ocean home', 2).ok, true); assert.equal(w.ship.inscription.revision, 2);
  for (const text of ['', 'x'.repeat(49), 'two\nlines', ' leading', '\u0000', '\u202ehidden']) assert.equal(write('a', text, 2).ok, false);
  action(w, 'a', 'dive'); assert.equal(write('a', 'Underwater edit', 2).ok, false); action(w, 'a', 'board');
  action(w, 'a', 'anchor'); assert.equal(write('a', 'Unanchored edit', 2).ok, false); action(w, 'a', 'anchor');
  w.ship.x += 100; assert.equal(write('a', 'Offshore edit', 2).ok, false); w.ship.x -= 100;
  const inscription = structuredClone(w.ship.inscription);
  w.mission = 'return'; w.cargo.recovered = true; action(w, 'a', 'deliver');
  assert.equal(act(w, 'a', 'nextSalvage', { destination: 'west' }).ok, true);
  assert.deepEqual(w.ship.inscription, inscription); assert.equal(validInscription(w), true);
  assert.equal(validInscription({ ...w, ship: { inscription: { ...inscription, time: w.time + 1 } } }), false);
  assert.equal(validInscription({ ...w, ship: { inscription: { ...inscription, revision: 0 } } }), false);
});

test('research return guidance recovers the crew before departure and leads into harbor', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  w.mission = 'return'; w.cargo.recovered = true; action(w, 'a', 'deliver');
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, true);
  const site = voyageSites().find(s => s.id === 'reef'); Object.assign(w.ship, { x: site.x, z: site.z });
  action(w, 'b', 'dive'); Object.assign(w.players.b, { x: site.x, y: site.y, z: site.z });
  advance(w, 8, { b: { survey: true } });
  assert.equal(missionGuidance(w, 'a').action, 'radio');
  const recovery = crewActivities(w, 'a').jobs.find(j => j.id === 'recover');
  assert.equal(recovery.request.kind, 'recall'); assert.equal(recovery.recommended, true);
  assert.equal(act(w, 'a', 'crewCall', { kind: recovery.request.kind }).ok, true);
  assert.equal(missionGuidance(w, 'b').action, 'glance');
  Object.assign(w.players.b, { x: w.ship.x + 7, y: -.5, z: w.ship.z });
  assert.equal(missionGuidance(w, 'b').action, 'board'); action(w, 'b', 'board');
  assert.equal(missionGuidance(w, 'a').action, 'anchor');
  assert.equal(crewActivities(w, 'a').jobs.find(j => j.id === 'recover').request, undefined);
  action(w, 'a', 'anchor'); assert.equal(missionGuidance(w, 'a').action, 'helm');
  action(w, 'b', 'helm'); assert.equal(missionGuidance(w, 'a').action, 'glance');
  Object.assign(w.ship, BASE, { speed: 3 }); assert.equal(missionGuidance(w, 'b').action, 'anchor');
  action(w, 'b', 'anchor'); advance(w, 2);
  assert.equal(missionGuidance(w, 'a').action, 'fileResearch');
  action(w, 'a', 'fileResearch'); assert.equal(w.researchHistory.at(-1).status, 'filed');
});

test('resuming research guidance restores its briefing and useful actions after a detour', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); w.mission = 'return'; w.cargo.recovered = true; action(w, 'a', 'deliver');
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, true);
  assert.equal(act(w, 'a', 'course', { destination: 'kelp' }).ok, true);
  assert.equal(surveyStatus(w, 'a').site.id, 'kelp');
  assert.equal(act(w, 'a', 'course', { destination: null }).ok, true);
  assert.equal(surveyStatus(w, 'a')?.site.id, 'reef');
  assert.equal(missionGuidance(w, 'a').action, 'anchor');
  assert.ok(crewActivities(w, 'a').jobs.some(j => j.id === 'mission' && j.action === 'anchor'));
  action(w, 'a', 'anchor'); assert.equal(missionGuidance(w, 'a').action, 'helm');
  const site = voyageSites().find(s => s.id === 'reef'); Object.assign(w.ship, { x: site.x, z: site.z });
  assert.equal(missionGuidance(w, 'a').action, 'anchor'); action(w, 'a', 'anchor');
  assert.equal(missionGuidance(w, 'a').action, 'dive');
  assert.doesNotThrow(() => crewActivities(w, 'a')); action(w, 'a', 'dive');
  Object.assign(w.players.a, { x: site.x, y: site.y, z: site.z }); advance(w, 8, { a: { survey: true } });
  assert.equal(act(w, 'a', 'course', { destination: null }).ok, true);
  assert.equal(surveyStatus(w, 'a').complete, true, 'The completed local survey remains readable underwater');
  action(w, 'a', 'rescue'); assert.equal(surveyStatus(w, 'a'), null, 'Aboard guidance now serves the research return');
  assert.match(objectiveFor(w, 'a').label, /RESEARCH REPORT/);
});

test('live dive returns distinguish shallow and deep teams and track a moving pickup point', () => {
  const w = createWorld(), a = addPlayer(w, 'a', 'Mira'), b = addPlayer(w, 'b', 'Rowan');
  assert.equal(diveReturnPlan(w, 'a'), null);
  const deep = voyageSites().find(s => s.id === 'deep');
  Object.assign(w.ship, { x: deep.x + 100, z: deep.z });
  Object.assign(a, { mode: 'diver', x: deep.x, y: -10, z: deep.z });
  Object.assign(b, { mode: 'diver', x: deep.x, y: -600, z: deep.z });
  assert.equal(diveReturnPlan(w, 'a').sea, null, 'An untriggered salvage squall has no invented return forecast');
  Object.assign(w, { mission: 'complete', time: 390, storm: 0, explorationWeather: { time: 0, storm: 0 } });
  assert.equal(diveReturnPlan(w, 'a').total, 22); assert.equal(diveReturnPlan(w, 'a').sea, 'Fair');
  assert.equal(diveReturnPlan(w, 'b').total, 140); assert.equal(diveReturnPlan(w, 'b').sea, 'Rough');
  w.ship.x += 100; w.ship.speed = -1; assert.equal(diveReturnPlan(w, 'a').total, 42); assert.equal(diveReturnPlan(w, 'a').moving, true);
  w.ship.x -= 100; w.ship.speed = 0;
  const planned = diveReturnPlan(w, 'a');
  advance(w, planned.ascent, { a: { vertical: 1 } });
  advance(w, planned.swim, { a: { forward: 1, yaw: Math.PI / 2, pitch: 0 } });
  assert.ok(availableActions(w, 'a').includes('board'), 'The estimated ascent and surface swim reach a stationary cutter through actual input');
  action(w, 'a', 'board'); assert.equal(diveReturnPlan(w, 'a'), null);
  disconnectPlayer(w, 'b'); assert.equal(diveReturnPlan(w, 'b'), null);
});

test('open-sea fronts give research crews useful forecasts and repeat without jumps', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); w.mission = 'return'; w.cargo.recovered = true; w.storm = .85; action(w, 'a', 'deliver');
  const savedStart = structuredClone(w.explorationWeather);
  advance(w, 100); assert.equal(w.storm, 0, 'The archive squall clears before exploration weather begins');
  advance(w, 290); assert.equal(w.storm, 0);
  assert.equal(weatherOutlook(w).trend, 'Weather front approaching');
  const site = { x: w.ship.x, y: -25, z: w.ship.z };
  assert.equal(divePlan(w, site, 30).returnSea, 'Fair'); assert.equal(divePlan(w, site, 180).returnSea, 'Rough');
  const forecast = stormAfter(w, 120); advance(w, 120); assert.ok(Math.abs(w.storm - forecast) < 1e-9);
  const resumed = structuredClone(w); advance(w, 180); for (let i = 0; i < 10800; i++) tick(resumed, 1 / 60);
  assert.ok(Math.abs(w.storm - resumed.storm) < 1e-8, 'Saved fronts agree across simulation step sizes');
  assert.equal(weatherOutlook(w).trend, 'Weather front easing');
  for (const boundary of [FRONT_BUILD, FRONT_PEAK, FRONT_EASE, FRONT_END, FRONT_PERIOD]) {
    const at = time => explorationWeather({ ...w, time, explorationWeather: { time: 0, storm: 0 } }).storm;
    assert.ok(Math.abs(at(boundary - .001) - at(boundary + .001)) < .0001, `Continuous weather at ${boundary}s`);
  }
  w.time = savedStart.time + FRONT_PERIOD + FRONT_PEAK; w.storm = stormAfter(w);
  assert.ok(w.storm >= .55 && w.storm <= .8); assert.equal(explorationWeather(w).cycle, 1);
  assert.equal(validExplorationWeather(w), true);
  const before = w.storm; assert.equal(act(w, 'a', 'nextSalvage', { destination: 'west' }).ok, true); tick(w);
  assert.ok(w.storm < before && before - w.storm < .001, 'A new salvage job carries the current front smoothly');
  assert.equal(validExplorationWeather({ time: 0 }), true);
  assert.equal(validExplorationWeather({ time: 10, explorationWeather: { time: 11, storm: .5 } }), false);
  assert.equal(validExplorationWeather({ time: 10, explorationWeather: { time: 0, storm: NaN } }), false);
});

test('older completed voyages begin exploration weather from their saved sea state', () => {
  const w = createWorld(); w.time = 5000; w.mission = 'complete'; w.storm = .4;
  tick(w); assert.equal(w.explorationWeather.time, 5000); assert.equal(w.explorationWeather.storm, .4);
  assert.ok(w.storm < .4 && w.storm > .399); assert.equal(explorationWeather(w).cycle, 0);
});

test('a research voyage sails, surveys and returns to file its report using public movement rules', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira');
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, false);
  w.cargo.recovered = true; w.mission = 'return'; action(w, 'a', 'deliver');
  const delivery = structuredClone(w.delivery), site = voyageSites().find(s => s.id === 'reef');
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, true);
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'kelp' }).ok, false);
  assert.equal(act(w, 'a', 'nextSalvage', { destination: 'west' }).ok, false);
  assert.equal(act(w, 'a', 'fileResearch').ok, false);
  assert.equal(objectiveFor(w, 'a').label, site.name); assert.equal(missionGuidance(w, 'a').action, 'anchor');
  action(w, 'a', 'helm'); action(w, 'a', 'anchor'); sailTo(w, 'a', site); action(w, 'a', 'dive'); swimTo(w, 'a', site);
  advance(w, 8, { a: { survey: true } }); assert.equal(researchReady(w), true);
  assert.equal(w.course.id, 'pelican-station'); assert.match(objectiveFor(w, 'a').label, /RESEARCH TEAM/);
  assert.equal(act(w, 'a', 'fileResearch').ok, false, 'A report cannot be delivered from the dive site');
  swimTo(w, 'a', { x: w.ship.x + 7, y: -.5, z: w.ship.z }); action(w, 'a', 'board');
  action(w, 'a', 'helm'); action(w, 'a', 'anchor'); sailTo(w, 'a', BASE);
  assert.equal(researchHarborReason(w, 'a'), ''); action(w, 'a', 'fileResearch');
  assert.equal(w.research, null); assert.equal(w.researchHistory[0].status, 'filed'); assert.deepEqual(w.researchHistory[0].contributors, ['Mira']);
  assert.deepEqual(w.delivery, delivery); assert.equal(validResearch(w), true);
  assert.match(voyageText(w), /Filed research report:.*\nMira at Pelican Station/);
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, false, 'Completed habitats are not offered as new work');
  assert.equal(act(w, 'a', 'nextSalvage', { destination: 'west' }).ok, true);
  assert.equal(validResearch(w), true, 'Research history survives later salvage');
});

test('research keeps detours and partial work, requires crew aboard, and validates saved requests', () => {
  const w = createWorld(), a = addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan'); w.cargo.recovered = true; w.mission = 'return'; action(w, 'a', 'deliver');
  action(w, 'b', 'dive'); assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, false); action(w, 'b', 'board');
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'unknown' }).ok, false);
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, true);
  const site = voyageSites().find(s => s.id === 'reef'); Object.assign(a, site, { id: 'a', mode: 'diver' });
  advance(w, 3, { a: { survey: true } }); const seconds = w.surveys.reef.seconds;
  action(w, 'a', 'rescue'); action(w, 'a', 'setAsideResearch'); assert.equal(w.surveys.reef.seconds, seconds);
  assert.equal(w.researchHistory[0].status, 'set-aside');
  assert.equal(act(w, 'a', 'acceptResearch', { destination: 'reef' }).ok, true);
  assert.equal(act(w, 'a', 'course', { destination: 'kelp' }).ok, true);
  Object.assign(a, site, { id: 'a', mode: 'diver' }); advance(w, 8, { a: { survey: true } });
  assert.equal(w.course.id, 'kelp', 'Finishing an encountered research site preserves a deliberate detour');
  assert.equal(act(w, 'b', 'fileResearch').ok, false); action(w, 'a', 'rescue'); action(w, 'b', 'fileResearch');
  assert.equal(w.researchHistory.length, 2); assert.equal(validResearch(w), true);
  assert.equal(validResearch({ seed: 713, time: 0 }), true);
  const broken = structuredClone(w); broken.researchHistory[0].finishedAt = -1; assert.equal(validResearch(broken), false);
  broken.researchHistory[0].finishedAt = w.time; broken.researchHistory[0].site = 'unknown'; assert.equal(validResearch(broken), false);
});

test('seabed instruments follow the ship or diver independently of a plotted destination', () => {
  const w = createWorld(), p = addPlayer(w, 'a', 'Mira');
  const initial = seabedReading(w, 'a');
  assert.equal(initial.metres, -oceanFloor(BASE.x, BASE.z, { seed: w.seed, relief: 1, habitatScale: 1 }));
  assert.match(initial.text, /below Kestrel/);
  w.ship.y = 1.5; assert.equal(seabedReading(w, 'a').metres, initial.metres + 1.5);
  const deep = voyageSites().find(s => s.id === 'deep'); Object.assign(w.ship, { x: deep.x, z: deep.z });
  assert.ok(seabedReading(w, 'a').metres > 1000);
  Object.assign(p, { mode: 'diver', x: BASE.x, z: BASE.z, y: initial.floor + 6 });
  assert.equal(seabedReading(w, 'a').metres, 6); assert.match(seabedReading(w, 'a').text, /above the seabed/);
  assert.equal(act(w, 'a', 'course', { destination: 'deep' }).ok, true);
  assert.equal(seabedReading(w, 'a').metres, 6, 'A distant course does not replace local terrain depth');
  assert.equal(seabedReading(w, 'unknown'), null);
});

test('crew wildlife reports keep the first observer and authoritative location for shared return visits', () => {
  const w = createWorld(), a = addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  assert.equal(act(w, 'a', 'shareSighting', { type: 'turtle' }).ok, false);
  action(w, 'a', 'dive');
  assert.equal(act(w, 'a', 'shareSighting', { type: '__proto__' }).ok, false);
  assert.equal(act(w, 'a', 'shareSighting', { type: 'made-up-animal' }).ok, false);
  assert.equal(act(w, 'a', 'shareSighting', { type: 'turtle', observer: 'Fake', position: { x: NaN }, time: 999 }).ok, true);
  const first = structuredClone(w.sightings.turtle), mission = w.mission;
  assert.deepEqual(first.position, { x: a.x, y: a.y, z: a.z }); assert.equal(first.observer, 'Mira'); assert.equal(first.time, w.time);
  action(w, 'b', 'dive'); assert.equal(act(w, 'b', 'shareSighting', { type: 'turtle' }).ok, true);
  assert.deepEqual(w.sightings.turtle, first); assert.equal(w.mission, mission); assert.equal(w.course, null);
  assert.equal(voyageEntries(w).filter(e => e.sightingType === 'turtle').length, 1);
  assert.match(voyageText(w), /Sea turtle sighting\nReported by Mira/);
  const chart = act(w, 'b', 'chartSighting', { type: 'turtle', position: { x: 999, y: 0, z: 999 } });
  assert.equal(chart.ok, true); assert.equal(w.places[chart.destination].x, first.position.x);
  assert.match(w.places[chart.destination].note, /observer’s position/); assert.equal(validPlaces(w), true);
  assert.equal(act(w, 'a', 'chartSighting', { type: 'turtle' }).destination, chart.destination);
  assert.equal(act(w, 'a', 'chartSighting', { type: 'whale' }).ok, false);
  assert.equal(act(w, 'a', 'course', { destination: chart.destination }).ok, true);
  assert.equal(voyageEntries(w).find(e => e.sightingType === 'turtle').charted, true);
  action(w, 'a', 'rescue'); action(w, 'b', 'rescue'); w.cargo.recovered = true; w.mission = 'return'; action(w, 'a', 'deliver');
  assert.equal(act(w, 'a', 'nextSalvage', { destination: 'west' }).ok, true); assert.deepEqual(w.sightings.turtle, first);
  assert.equal(validSightings(w), true); assert.equal(validSightings({ time: 0 }), true);
  for (const bad of [[], { fake: first }, { turtle: { ...first, time: w.time + 1 } }, { turtle: { ...first, position: { x: NaN, y: 0, z: 0 } } }]) assert.equal(validSightings({ ...w, sightings: bad }), false);
  disconnectPlayer(w, 'a'); assert.equal(act(w, 'a', 'chartSighting', { type: 'turtle' }).ok, false);
});

test('off-mission wreck visits become permanent shared destinations without changing the assignment', () => {
  const w = createWorld(), a = addPlayer(w, 'a', 'Mira'), b = addPlayer(w, 'b', 'Rowan');
  const site = SALVAGE_SITES.find(s => s.id === 'west');
  assert.equal(act(w, 'a', 'course', { destination: 'wreck-west' }).ok, false);
  assert.equal(act(w, 'a', 'course', { destination: 'kelp' }).ok, true);
  const course = structuredClone(w.course), cargo = structuredClone(w.cargo);
  Object.assign(a, site.cargo); discoverWrecks(w); assert.equal(w.wreckDiscoveries, undefined, 'Deck positions cannot discover a wreck');
  Object.assign(a, { mode: 'diver', y: 0 }); discoverWrecks(w); assert.equal(w.wreckDiscoveries, undefined, 'Sailing or swimming over a wreck is not a visit');
  Object.assign(a, site.cargo, { x: site.cargo.x + 13 }); discoverWrecks(w); assert.equal(w.wreckDiscoveries, undefined);
  Object.assign(a, site.cargo, { connected: false }); discoverWrecks(w); assert.equal(w.wreckDiscoveries, undefined);
  a.connected = true; Object.assign(b, site.cargo, { mode: 'diver' }); tick(w);
  assert.deepEqual(w.wreckDiscoveries.west.crew, ['Mira', 'Rowan']); assert.deepEqual(w.course, course); assert.deepEqual(w.cargo, cargo);
  assert.equal(w.mission, 'outbound'); assert.equal(discoveredWrecks(w).length, 1);
  const first = structuredClone(w.wreckDiscoveries); a.name = 'Changed'; tick(w); assert.deepEqual(w.wreckDiscoveries, first);
  assert.equal(act(w, 'a', 'course', { destination: 'wreck-west' }).ok, true);
  assert.match(courseTarget(w, 'a').hint, /Explore the wreck/); assert.doesNotMatch(courseTarget(w, 'a').hint, /survey/);
  assert.match(voyageText(w), /Explored western survey wreck\nMira & Rowan/);
  Object.assign(a, { mode: 'deck' }); Object.assign(b, { mode: 'deck' });
  w.cargo.recovered = true; w.mission = 'return'; action(w, 'a', 'deliver');
  assert.equal(act(w, 'a', 'nextSalvage', { destination: 'east' }).ok, true);
  assert.deepEqual(w.wreckDiscoveries, first); assert.equal(validWreckDiscoveries(w), true);
  for (const bad of [{ unknown: first.west }, { west: { ...first.west, time: w.time + 1 } }, { west: { ...first.west, crew: [] } }, []]) {
    assert.equal(validWreckDiscoveries({ ...w, wreckDiscoveries: bad }), false);
  }
  assert.equal(validWreckDiscoveries({ time: 0 }), true, 'Older voyages remain readable');
});

test('hull paint is a shared harbor choice and remains through the next expedition', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira');
  assert.equal(act(w, 'a', 'paintHull', { paint: 'red' }).ok, true); assert.equal(w.ship.paint, 'red');
  w.ship.anchor = false; assert.equal(act(w, 'a', 'paintHull', { paint: 'blue' }).ok, false);
  w.ship.anchor = true; w.ship.x += 100; assert.equal(act(w, 'a', 'paintHull', { paint: 'blue' }).ok, false);
  Object.assign(w.ship, BASE); action(w, 'a', 'dive'); assert.equal(act(w, 'a', 'paintHull', { paint: 'blue' }).ok, false);
  action(w, 'a', 'board'); assert.equal(act(w, 'a', 'paintHull', { paint: 'invalid' }).ok, false);
  w.mission = 'return'; w.cargo.recovered = true; action(w, 'a', 'deliver');
  assert.equal(act(w, 'a', 'nextSalvage', { destination: 'west' }).ok, true); assert.equal(w.ship.paint, 'red');
});

test('a homeward course is available during exploration and brings divers back to the ship', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  w.ship.x += 150;
  assert.equal(act(w, 'a', 'course', { destination: 'pelican-station' }).ok, true);
  const home = courseTarget(w, 'a'); assert.equal(home.x, BASE.x); assert.equal(home.z, BASE.z);
  assert.match(home.hint, /homeward/); assert.equal(w.mission, 'outbound');
  action(w, 'b', 'dive');
  assert.match(courseTarget(w, 'a').hint, /Recover the dive team/);
  assert.equal(courseTarget(w, 'b').x, w.ship.x); assert.match(courseTarget(w, 'b').detail, /Board Kestrel/);
  action(w, 'b', 'board'); Object.assign(w.ship, BASE);
  assert.match(courseTarget(w, 'a').hint, /At Pelican Station/);
  assert.equal(Object.keys(w.surveys).length, 0);
});

test('dives record measured depth, elapsed time and normal or assisted return once', () => {
  const w = createWorld(), p = addPlayer(w, 'a', 'Mira');
  Object.assign(w.ship, { x: CRATE.x, z: CRATE.z }); action(w, 'a', 'dive');
  for (let i = 0; i < 80; i++) { setInput(w, 'a', { vertical: -1 }); tick(w); }
  const depth = p.diveRecord.maximumDepth;
  assert.match(crewActivityLabel(p, w.time), /elapsed.*deepest/);
  assert.doesNotMatch(crewActivityLabel(p), /elapsed/, 'Compact navigation labels keep the current depth only');
  assert.ok(depth > 10); disconnectPlayer(w, 'a'); addPlayer(w, 'a');
  assert.equal(p.diveRecord.maximumDepth, depth);
  swimTo(w, 'a', { x: w.ship.x + 7, y: -.5, z: w.ship.z }); action(w, 'a', 'board');
  assert.equal(w.diveRecords.length, 1); assert.equal(w.diveRecords[0].maximumDepth, depth);
  assert.ok(w.diveRecords[0].endedAt - w.diveRecords[0].startedAt > 4);
  assert.equal(w.diveRecords[0].assisted, false); assert.equal(p.diveRecord, undefined);
  assert.equal(crewActivityLabel(p, w.time), 'On deck');
  assert.equal(act(w, 'a', 'board').ok, false); assert.equal(w.diveRecords.length, 1);
  action(w, 'a', 'dive'); action(w, 'a', 'rescue');
  assert.equal(w.diveRecords[1].assisted, true); assert.equal(validDiveRecords(w), true);
  p.name = 'Changed'; assert.match(voyageText(w), /Mira returned from a dive/);
  const bad = structuredClone(w); bad.diveRecords[0].endedAt = -1; assert.equal(validDiveRecords(bad), false);
});

test('salvage planning includes recovery and homeward sailing and follows actual lift progress', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira');
  const short = salvagePlan(w, 30), long = salvagePlan(w, 300);
  assert.equal(long.total - short.total, 270); assert.ok(short.total > short.boarding + short.lift);
  assert.equal(short.homeSea, null);
  Object.assign(w.ship, { x: w.cargo.x, z: w.cargo.z, anchor: true });
  w.cargo.attached = true; w.mission = 'recovery'; w.stormStart = 0;
  action(w, 'a', 'winch'); const started = salvagePlan(w);
  advance(w, 2); const lifting = salvagePlan(w);
  assert.ok(Math.abs(started.lift - lifting.lift - 2) < .0001);
  assert.equal(lifting.boarding, 0); assert.ok(lifting.homeSea);
  advance(w, started.lift); assert.equal(salvagePlan(w).lift, 0);
  assert.equal(salvagePlan(w).total, salvagePlan(w).homeward);
  w.mission = 'complete'; assert.equal(salvagePlan(w).total, 0);
});

test('underwater log locations retain depth and older notes do not invent coordinates', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); action(w, 'a', 'dive');
  Object.assign(w.players.a, CRATE);
  assert.equal(act(w, 'a', 'writeCrewLog', { entryId: 'underwater-crew-entry', text: 'A quiet corner beside the wreck.' }).ok, true);
  assert.deepEqual(w.crewLog[0].position, CRATE);
  assert.equal(validCrewLog(w), true);
  const legacy = structuredClone(w); delete legacy.crewLog[0].position;
  assert.equal(validCrewLog(legacy), true);
  assert.equal(act(legacy, 'a', 'chartCrewEntry', { entryId: 'underwater-crew-entry' }).ok, false);
  w.crewLog[0].position.y = -9999; assert.equal(validCrewLog(w), false);
});

test('crew-written log entries preserve authorship, expedition context and exact retry identity', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  const data = { entryId: 'first-crew-entry', text: 'Changed course for the kelp.\nReturn at sunrise.', author: 'Forged', expedition: 99, time: 999 };
  assert.equal(act(w, 'a', 'writeCrewLog', data).ok, true);
  assert.equal(act(w, 'a', 'writeCrewLog', data).ok, true); assert.equal(w.crewLog.length, 1);
  assert.equal(act(w, 'b', 'writeCrewLog', data).ok, false);
  assert.equal(act(w, 'a', 'writeCrewLog', { ...data, text: {} }).ok, false);
  assert.deepEqual([w.crewLog[0].author, w.crewLog[0].expedition, w.crewLog[0].time], ['Mira', 1, 0]);
  const writtenAt = { ...w.crewLog[0].position }; w.ship.x += 20;
  assert.equal(act(w, 'b', 'chartCrewEntry', { entryId: data.entryId, x: 9999 }).ok, true);
  assert.equal(act(w, 'a', 'chartCrewEntry', { entryId: data.entryId }).ok, true);
  assert.equal(Object.keys(w.places).length, 1, 'Crew can save the entry only once');
  const saved = Object.values(w.places)[0];
  assert.deepEqual({ x: saved.x, y: saved.y, z: saved.z }, writtenAt, 'Chart location comes from writing time, not the later ship position or client data');
  assert.equal(saved.note, data.text); assert.equal(validPlaces(w), true);
  w.ship.x -= 20;
  w.players.a.name = 'Changed'; assert.match(voyageText(w), /Mira’s log/);
  assert.match(voyageText(w), /Return at sunrise/); assert.equal(validCrewLog(w), true);
  assert.equal(act(w, 'b', 'writeCrewLog', { entryId: 'second-crew-entry', text: 'x'.repeat(401) }).ok, false);
  const bad = structuredClone(w); bad.crewLog[0].time = 100; assert.equal(validCrewLog(bad), false);
  w.mission = 'return'; w.cargo.recovered = true; action(w, 'a', 'deliver');
  assert.equal(act(w, 'a', 'nextSalvage', { destination: 'west' }).ok, true);
  assert.equal(w.crewLog[0].expedition, 1); assert.match(voyageText(w), /Mira’s log/);
  assert.equal(act(w, 'b', 'writeCrewLog', { entryId: 'second-crew-entry', text: 'We are sailing west.' }).ok, true);
  assert.equal(w.crewLog[1].expedition, 2);
  for (let i = 2; i < 64; i++) assert.equal(act(w, 'a', 'writeCrewLog', { entryId: `crew-entry-number-${i}`, text: `Memory ${i}` }).ok, true);
  assert.equal(act(w, 'a', 'writeCrewLog', { entryId: 'overflow-crew-entry', text: 'One more.' }).ok, false);
  assert.equal(w.crewLog.length, 64); assert.equal(w.crewLog[0].text, data.text, 'A full log never discards old memories');
});

test('a return-aboard call remains until the last connected diver returns', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan'); addPlayer(w, 'c', 'Kai');
  assert.equal(act(w, 'a', 'crewCall', { kind: 'recall' }).ok, false);
  action(w, 'b', 'dive'); action(w, 'c', 'dive');
  assert.equal(act(w, 'b', 'crewCall', { kind: 'recall' }).ok, false);
  assert.equal(act(w, 'a', 'crewCall', { kind: 'recall' }).ok, true);
  const call = w.calls.a;
  addPlayer(w, 'd', 'Harper');
  assert.equal(canReply(w, 'd', call), false);
  assert.equal(act(w, 'd', 'acknowledgeCall', { owner: 'a', callId: call.id }).ok, false);
  assert.equal(act(w, 'b', 'acknowledgeCall', { owner: 'a', callId: call.id }).ok, true);
  assert.equal(w.players.b.mode, 'diver', 'Acknowledgement does not move a diver');
  assert.equal(act(w, 'c', 'acknowledgeCall', { owner: 'a', callId: call.id }).ok, true);
  assert.deepEqual(call.returning, ['b', 'c'], 'Each diver can confirm independently');
  assert.equal(canReply(w, 'b', call), false);
  const sequence = w.ackSequence;
  assert.equal(act(w, 'b', 'acknowledgeCall', { owner: 'a', callId: call.id }).ok, true);
  assert.equal(w.ackSequence, sequence, 'Retrying does not replay the reply');
  action(w, 'b', 'board'); tick(w); assert.equal(w.calls.a.id, call.id);
  action(w, 'c', 'board'); tick(w); assert.equal(w.calls.a, undefined);
});

test('attaching the archive hands the salvage course back to shared recovery guidance', () => {
  for (const destination of ['salvage-active', 'kelp']) {
    const w = createWorld(); addPlayer(w, 'diver', 'Mira'); addPlayer(w, 'deck', 'Rowan');
    Object.assign(w.ship, { x: CRATE.x, z: CRATE.z + 8 });
    action(w, 'diver', 'dive'); Object.assign(w.players.diver, CRATE);
    assert.equal(act(w, 'deck', 'course', { destination }).ok, true);
    action(w, 'diver', 'attach');
    if (destination === 'salvage-active') {
      assert.equal(courseTarget(w, 'diver'), null); assert.equal(courseTarget(w, 'deck'), null);
      const target = objectiveFor(w, 'diver'); assert.equal(target.key, 'ship');
      w.ship.x += 2; assert.equal(objectiveFor(w, 'diver').x, target.x + 2, 'Boarding target follows the cutter');
      assert.equal(objectiveFor(w, 'deck').key, 'lift');
    } else assert.equal(w.course.id, 'kelp', 'An independent exploration course remains the crew choice');
  }
});

test('successive salvage expeditions keep the crew history and complete at distinct wrecks', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira');
  w.mission = 'return'; w.cargo.recovered = true; w.time = 100; w.storm = .7;
  action(w, 'a', 'deliver'); const firstDelivery = structuredClone(w.delivery);
  w.surveys.reef = { seconds: 8, active: 0, completedAt: w.time, contributors: [{ id: 'a', name: 'Mira' }] };
  const survey = structuredClone(w.surveys.reef);
  for (const destination of ['west', 'east']) {
    const number = (w.contract?.number || 1) + 1, previousStorm = w.storm;
    assert.equal(act(w, 'a', 'nextSalvage', { destination }).ok, true);
    assert.equal(w.storm, previousStorm, 'Accepting a job does not jump the live sea state');
    assert.equal(w.contract.number, number); assert.equal(validSalvageState(w), true);
    assert.equal(act(w, 'a', 'nextSalvage', { destination: 'reef' }).ok, false, 'A second acceptance cannot replace the active job');
    const cargo = { ...activeSalvage(w).cargo };
    assert.equal(act(w, 'a', 'course', { destination: 'salvage-active' }).ok, true);
    const planned = courseTarget(w, 'a');
    assert.equal(planned.site.y, cargo.y); assert.equal(planned.x, cargo.x);
    assert.match(planned.detail, /m recovery/); assert.doesNotMatch(planned.hint, /survey/);
    assert.ok(divePlan(w, planned.site).descent > 0);
    assert.equal(act(w, 'a', 'course', { destination: null }).ok, true);
    if (w.players.a.mode !== 'helm') action(w, 'a', 'helm');
    action(w, 'a', 'anchor'); sailTo(w, 'a', { x: cargo.x, z: cargo.z + 8 });
    assert.equal(w.mission, 'dive'); action(w, 'a', 'dive'); swimTo(w, 'a', cargo); action(w, 'a', 'attach');
    swimTo(w, 'a', { x: w.ship.x + 7, y: -.5, z: w.ship.z }); action(w, 'a', 'board');
    action(w, 'a', 'winch'); advance(w, 25); assert.equal(w.mission, 'return');
    action(w, 'a', 'helm'); action(w, 'a', 'anchor'); sailTo(w, 'a', BASE); action(w, 'a', 'deliver');
    assert.ok(w.delivery.duration > 0 && w.delivery.duration < w.delivery.time);
    assert.deepEqual(w.surveys.reef, survey);
  }
  assert.equal(w.salvageHistory.length, 2); assert.deepEqual(w.salvageHistory[0].delivery, firstDelivery);
  assert.equal(voyageEntries(w).filter(e => e.id.includes('delivery')).length, 3);
  const log = voyageEntries(w);
  assert.equal(log.filter(e => e.id.includes('accepted')).length, 2, 'Both later job acceptances survive in the log');
  assert.match(log.find(e => e.id === 'salvage-2-delivery').detail, /western survey archive.*to delivery/);
  assert.match(log.find(e => e.id === 'delivery').title, /Expedition 3/);
  assert.match(log.find(e => e.id === 'delivery').detail, /eastern survey archive/);
  assert.ok(log.every((e, i) => i === 0 || e.time >= log[i - 1].time));
  const legacy = structuredClone(w); delete legacy.salvageHistory[1].startedAt;
  assert.equal(validSalvageState(legacy), true);
  assert.equal(voyageEntries(legacy).some(e => e.id === 'salvage-2-accepted'), false, 'Legacy acceptance times are not invented');
  legacy.salvageHistory[1].delivery.duration = -1;
  assert.equal(validSalvageState(legacy), false);
  action(w, 'a', 'dive'); assert.equal(act(w, 'a', 'nextSalvage', { destination: 'reef' }).ok, false, 'Divers must return before the next job');
});

test('crew field notes preserve a place and reject stale or invalid edits', () => {
  const w = createWorld(); addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  act(w, 'a', 'signal', { x: -110, y: 0, z: 405 });
  act(w, 'a', 'savePlace', { owner: 'a', signalId: w.signals.a.id, name: 'First sighting' });
  const place = Object.values(w.places)[0], original = structuredClone(place);
  act(w, 'a', 'course', { destination: place.id });
  const update = { destination: place.id, expectedRevision: 0, name: 'Turtle shallows', note: 'Two turtles beside the kelp.\nApproach from the east.', x: 9999 };
  assert.equal(act(w, 'a', 'updatePlace', update).ok, true);
  assert.equal(place.revision, 1); assert.equal(place.updatedBy, 'Mira');
  assert.deepEqual([place.x, place.y, place.z, place.time, place.savedBy], [original.x, original.y, original.z, original.time, original.savedBy]);
  assert.equal(courseTarget(w, 'b').label, 'Turtle shallows');
  assert.match(voyageText(w), /Approach from the east/);
  assert.equal(act(w, 'b', 'updatePlace', { ...update, note: 'Stale replacement' }).ok, false);
  assert.equal(act(w, 'b', 'updatePlace', { ...update, expectedRevision: 1, note: 'x'.repeat(401) }).ok, false);
  assert.equal(place.revision, 1); assert.equal(validPlaces(w), true);
  assert.equal(act(w, 'b', 'updatePlace', { ...update, expectedRevision: 1, note: 'Also saw a ray.' }).ok, true);
  assert.equal(place.updatedBy, 'Rowan'); assert.equal(place.revision, 2);
  disconnectPlayer(w, 'b'); assert.equal(act(w, 'b', 'updatePlace', { ...update, expectedRevision: 2 }).ok, false);
  assert.equal(validPlaces({ ...w, places: { [place.id]: { ...place, note: 'x'.repeat(401) } } }), false);
});

test('weather planning follows the expedition curve and distinguishes short and long dives', () => {
  const w = createWorld();
  assert.equal(weatherOutlook(w).known, false);
  assert.equal(weatherOutlook(w).future, null, 'An untriggered squall has no fabricated schedule');
  w.stormStart = 0; w.time = 0; w.mission = 'dive';
  assert.equal(stormAfter(w, 25), 0); assert.equal(stormAfter(w, 100), .5); assert.equal(stormAfter(w, 200), .85);
  const near = { x: w.ship.x, y: -25, z: w.ship.z };
  const brief = divePlan(w, near, 30), long = divePlan(w, near, 300);
  assert.equal(brief.surface, 40); assert.equal(brief.returnSea, 'Fair'); assert.equal(long.returnSea, 'Rough');
  const deep = divePlan(w, { ...near, y: -1000 }, 30); assert.equal(deep.surface, 430);
  const expected = stormAfter(w, 120);
  for (let i = 0; i < 2400; i++) tick(w);
  assert.ok(Math.abs(w.storm - expected) < 1e-9, 'The projected squall agrees with two minutes of server simulation');
  w.mission = 'complete'; w.storm = .85;
  assert.ok(Math.abs(stormAfter(w, 45) - .35) < 1e-9); assert.equal(stormAfter(w, 90), 0);
  assert.equal(weatherOutlook(w).future, 'Fair');
  const a = addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  assert.equal(act(w, a.id, 'crewCall', { kind: 'weather', outlook: 'forged' }).ok, true);
  const call = structuredClone(w.calls.a);
  assert.match(call.outlook, /squall easing/); assert.doesNotMatch(call.outlook, /forged/);
  tick(w); assert.deepEqual(w.calls.a, call, 'A weather call retains the conditions at its send time');
  assert.equal(act(w, 'b', 'acknowledgeCall', { owner: 'a', callId: call.id }).ok, true);
});

test('crew-saved places use validated marks, outlive signals, and support return courses', () => {
  const w = createWorld(), a = addPlayer(w, 'a', 'Mira'); addPlayer(w, 'b', 'Rowan');
  const point = { x: a.x + 15, y: 0, z: a.z - 25 };
  assert.equal(act(w, 'a', 'signal', point).ok, true);
  const source = { owner: 'a', signalId: w.signals.a.id, name: 'Quiet anchorage', x: NaN, y: -99999 };
  assert.equal(act(w, 'b', 'savePlace', { ...source, signalId: -1 }).ok, false);
  assert.equal(act(w, 'b', 'savePlace', source).ok, true);
  const place = Object.values(w.places)[0];
  assert.deepEqual([place.x, place.y, place.z], [point.x, point.y, point.z], 'Client coordinates cannot replace the validated mark');
  assert.equal(place.savedBy, 'Rowan'); assert.equal(validPlaces(w), true);
  assert.equal(act(w, 'b', 'savePlace', source).ok, false);
  w.time += 19; tick(w); assert.equal(w.signals.a, undefined);
  assert.equal(act(w, 'a', 'savePlace', source).ok, false);
  assert.equal(act(w, 'a', 'course', { destination: place.id }).ok, true);
  assert.equal(courseTarget(w, 'a').label, 'Quiet anchorage');
  assert.doesNotMatch(courseTarget(w, 'a').hint, /hold X/i);
  assert.ok(voyageEntries(w).some(e => e.title === 'Charted Quiet anchorage'));
  assert.equal(act(w, 'b', 'removePlace', { destination: place.id }).ok, true);
  assert.equal(w.course, null); assert.equal(act(w, 'a', 'course', { destination: place.id }).ok, false);
  assert.equal(validPlaces({ ...w, places: undefined }), true);
  assert.equal(validPlaces({ ...w, places: { [place.id]: { ...place, y: -99999 } } }), false);
  for (let i = 1; i <= PLACE_LIMIT; i++) w.places[`place-${i}`] = { ...place, id: `place-${i}` };
  assert.equal(validPlaces(w), true);
  w.time += 3; w.signalSequence = PLACE_LIMIT;
  assert.equal(act(w, 'a', 'signal', point).ok, true);
  assert.equal(act(w, 'a', 'savePlace', { ...source, signalId: w.signals.a.id }).ok, false);
});

test('independent dive teams survey encountered habitats without changing the crew course', () => {
  const w = createWorld(), a = addPlayer(w, 'a', 'Mira'), b = addPlayer(w, 'b', 'Rowan');
  for (const [p, id] of [[a, 'reef'], [b, 'kelp']]) {
    const site = voyageSites().find(s => s.id === id);
    Object.assign(p, { mode: 'diver', x: site.x, y: site.y, z: site.z });
  }
  assert.equal(w.course, null);
  assert.equal(surveyStatus(w, 'a').site.id, 'reef');
  assert.equal(surveyStatus(w, 'b').site.id, 'kelp');
  tick(w); assert.deepEqual(w.surveys, {}, 'Encountering a site still requires deliberate survey input');
  for (let i = 0; i < 170; i++) {
    setInput(w, 'a', { survey: true }); setInput(w, 'b', { survey: true }); tick(w);
    if (i === 30) act(w, 'a', 'course', { destination: 'deep' });
  }
  assert.equal(w.course.id, 'deep');
  assert.equal(w.surveys.deep, undefined);
  assert.equal(w.surveys.reef.seconds, 8); assert.equal(w.surveys.kelp.seconds, 8);
  assert.deepEqual(w.surveys.reef.contributors, [{ id: 'a', name: 'Mira' }]);
  assert.deepEqual(w.surveys.kelp.contributors, [{ id: 'b', name: 'Rowan' }]);
  assert.equal(voyageEntries(w).filter(e => e.id.startsWith('survey-')).length, 2);
  a.x += 30; assert.equal(surveyStatus(w, 'a').site.id, 'deep', 'Leaving the local site restores plotted guidance');
});

test('voyage history records real actions once and retains names after crew changes', () => {
  const w = createWorld(), p = addPlayer(w, 'a', 'Mira');
  assert.deepEqual(voyageEntries(w), []);
  action(w, 'a', 'helm'); action(w, 'a', 'anchor');
  w.ship.z -= 40; tick(w);
  const departure = structuredClone(w.milestones.departed);
  tick(w); assert.deepEqual(w.milestones.departed, departure);
  w.ship.x = CRATE.x; w.ship.z = CRATE.z; w.ship.speed = 0; w.ship.anchor = true; tick(w);
  action(w, 'a', 'dive'); Object.assign(p, CRATE);
  action(w, 'a', 'attach');
  assert.equal(act(w, 'a', 'attach').ok, false);
  p.y = 0; action(w, 'a', 'board'); action(w, 'a', 'winch');
  w.cargo.y = 1.99; tick(w);
  assert.deepEqual(Object.keys(w.milestones), ['departed', 'wreck', 'attached', 'recovered']);
  p.name = 'New name';
  assert.equal(w.milestones.attached.crew[0], 'Mira');
  assert.equal(validMilestones(w), true);
  w.surveys.reef = { seconds: 8, completedAt: w.time, contributors: [{ id: 'a', name: 'Mira' }] };
  assert.equal(voyageEntries(w).length, 6);
  assert.match(voyageText(w), /Surveyed Coral cathedral/);
  const saved = JSON.parse(JSON.stringify(snapshot(w)));
  assert.deepEqual(voyageEntries(saved), voyageEntries(w));
  saved.milestones.attached.time = w.time + 1;
  assert.equal(validMilestones(saved), false);
  delete saved.milestones;
  delete saved.diveRecords;
  assert.equal(validMilestones(saved), true);
  assert.equal(voyageEntries(saved).length, 1, 'Old saves do not invent milestone history');
});

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
  const streams = await Promise.all([a, b].map(async (p, i) => {
    const res = await fetch(base + path + '/events?token=' + p.token, { signal: AbortSignal.any([controllers[i].signal, AbortSignal.timeout(5000)]) });
    return { reader: res.body.getReader(), decoder: new TextDecoder(), buffer: '' };
  }));
  const read = async stream => {
    while (!stream.buffer.includes('\n\n')) {
      const result = await stream.reader.read(); assert.equal(result.done, false, 'Stream remains open');
      stream.buffer += stream.decoder.decode(result.value, { stream: true });
    }
    const end = stream.buffer.indexOf('\n\n'), event = stream.buffer.slice(0, end); stream.buffer = stream.buffer.slice(end + 2);
    return JSON.parse(event.slice(6));
  };
  await Promise.all(streams.map(read));
  // Deliberately queue a pre-action broadcast, as a busy client would.
  await new Promise(r => setTimeout(r, 150));
  assert.equal((await post(path + '/action', { action: 'helm' }, a.token)).status, 200);
  assert.equal((await post(path + '/action', { action: 'helm' }, b.token)).status, 409);
  const states = await Promise.all(streams.map(async stream => {
    let state; do { state = await read(stream); } while (!state.ship.pilot);
    return state;
  }));
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
