import { oceanFloor, clamp, DOMAIN_RADIUS } from '../underwater/OceanDomain.js';
import { navigationHeight } from '../ocean/NavigationSea.js';
import { DECK_SPAWN, walkDeck } from './Deck.js';
import { HELM_STATION_Z } from './HelmRig.js';
import { boardingEntry } from './Boarding.js';
import { voyageDestinations } from './VoyageSites.js';
import { savePlace, removePlace, updatePlace } from './SavedPlaces.js';
import { advanceSurvey, isSurveying } from './Survey.js';
import { discoverWrecks } from './WreckDiscoveries.js';
import { sendCrewCall, acknowledgeCrewCall, canCall } from './CrewCalls.js';
import { advanceAnchor } from './Anchoring.js';
import { recordMilestone } from './VoyageLog.js';
import { stormAfter } from './WeatherOutlook.js';
import { beginSalvage, activeSalvage } from './SalvageVoyages.js';
import { writeCrewLog, chartCrewEntry } from './CrewLog.js';
import { ARCHIVE_LIFT_SPEED } from './SalvageSites.js';
import { startDive, measureDive, finishDive } from './DiveRecords.js';
import { startPickup, cancelPickup, updatePickup, finishPickup } from './PickupCourse.js';
import { recordResearchWeather } from './ResearchExperience.js';
import { inscribeShip } from './CrewInscription.js';
import { paintHull } from './HullPaint.js';
import { shareSighting, chartSighting } from './CrewSightings.js';
import { acceptResearch, finishResearch } from './ResearchVoyages.js';

export const STEP = 1 / 20;
export const BASE = { x: -140, z: 440 };
export const WRECK = { x: -140, z: 245 };
export const RECIPE = { seed: 713, worldSeed: 713, relief: 1, habitatScale: 1 };
export const CRATE = { x: -131, y: oceanFloor(-131, 250, RECIPE) + 1, z: 250 };
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

// A CPU wave field gives every server tick the same buoyancy regardless of GPU,
// rendering quality or client frame rate. The FFT adds cosmetic small waves.
export const seaHeight = navigationHeight;

export function createWorld() {
  return { time: 0, daylightStart: 0, seed: 713, revision: 0, storm: 0, stormStart: null, locations: { base: BASE, wreck: WRECK },
    ship: { ...BASE, y: 0, heading: Math.PI, speed: 0, yawRate: 0, propellerAngle: 0, anchorDrop: 1, pitch: 0, roll: 0, anchor: true, pilot: null },
    mission: 'outbound', delivery: null, milestones: {}, places: {}, cargo: { ...CRATE, attached: false, recovered: false },
    players: {}, winch: null, signals: {}, signalSequence: 0, calls: {}, callSequence: 0, ackSequence: 0, course: null, surveys: {}, log: 'Welcome aboard Kestrel. Release the anchor and sail south to the survey buoy.' };
}

export function addPlayer(world, id, name = 'Crew') {
  if (world.players[id]) { world.players[id].connected = true; world.players[id].lastInput = world.time; world.players[id].input = {}; return world.players[id]; }
  if (Object.keys(world.players).length >= 4) throw new Error('This expedition already has four crew members.');
  const p = { id, name: String(name).replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 20) || 'Crew',
    connected: true, mode: 'deck', x: world.ship.x, y: 3, z: world.ship.z,
    yaw: world.ship.heading, pitch: 0, deckX: DECK_SPAWN.x * (Object.keys(world.players).length % 2 ? -1 : 1),
    deckZ: DECK_SPAWN.z - Math.floor(Object.keys(world.players).length / 2), deckYaw: 0,
    input: {}, lastInput: world.time, disconnectedAt: null };
  world.players[id] = p;
  return p;
}

export function disconnectPlayer(world, id) {
  const p = world.players[id]; if (!p) return;
  p.connected = false; p.disconnectedAt = world.time; p.input = {}; updatePickup(world);
  for (const call of Object.values(world.calls || {})) if (call.returning) call.returning = call.returning.filter(member => member !== id);
  if (world.calls) { delete world.calls[id]; for (const call of Object.values(world.calls)) if (call.acknowledgedBy === id) call.acknowledgedBy = null; }
  if (world.ship.pilot === id) world.ship.pilot = null;
  if (world.winch === id) world.winch = null;
  if (p.mode !== 'diver') p.mode = 'deck';
  // A departing solo captain leaves a stable recovery platform for reconnects.
  if (!Object.values(world.players).some(p => p.connected)) world.ship.anchor = true;
}

export function setInput(world, id, input) {
  const p = world.players[id]; if (!p?.connected) return;
  // Inputs can cross an action response while the client is interpolating the
  // previous station. Do not turn old walking into swimming (or vice versa).
  if (input.mode !== undefined && input.mode !== p.mode) return;
  const finite = (v, lo, hi, fallback = 0) => Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  p.input = { forward: finite(input.forward, -1, 1), turn: finite(input.turn, -1, 1),
    strafe: finite(input.strafe, -1, 1), vertical: finite(input.vertical, -1, 1),
    yaw: finite(input.yaw, -Math.PI * 100, Math.PI * 100, p.yaw), pitch: finite(input.pitch, -1.4, 1.4, p.pitch),
    walkYaw: finite(input.walkYaw, -Math.PI * 100, Math.PI * 100, p.deckYaw ?? 0), survey: input.survey === true };
  p.lastInput = world.time;
}

export function availableActions(w, id) {
  const p = w.players[id]; if (!p?.connected) return [];
  const actions = [];
  if (p.mode !== 'diver') {
    if (!w.ship.pilot || w.ship.pilot === id) actions.push(p.mode === 'helm' ? 'leaveHelm' : 'helm');
    actions.push('anchor');
    if (Math.abs(w.ship.speed) < 2) actions.push('dive');
    if (w.cargo.attached && !w.cargo.recovered && (!w.winch || w.winch === id)) actions.push(p.mode === 'winch' ? 'leaveWinch' : 'winch');
    if (w.cargo.recovered && distance(w.ship, BASE) < 24 && Math.abs(w.ship.speed) < 1.5 && w.mission !== 'complete') actions.push('deliver');
  } else {
    if (distance(p, w.ship) < 13 && p.y > -3 && Math.abs(w.ship.speed) < 2) actions.push('board');
    if (!w.cargo.attached && Math.hypot(p.x - w.cargo.x, p.y - w.cargo.y, p.z - w.cargo.z) < 5
      && distance(w.ship, w.cargo) < 32 && w.ship.anchor) actions.push('attach');
    actions.push('rescue');
  }
  return actions;
}

export function markLocation(w, id, point) {
  const p = w.players[id];
  if (!p?.connected) return { ok: false, message: 'Join the crew before marking a location.' };
  if (![point?.x, point?.y, point?.z].every(Number.isFinite) || Math.hypot(point.x, point.z) > DOMAIN_RADIUS ||
      Math.hypot(point.x - p.x, point.y - p.y, point.z - p.z) > 600 || point.y > 12 || point.y < oceanFloor(point.x, point.z, RECIPE) - 2) return { ok: false, message: 'Mark a location within 600 m, on the water or seabed.' };
  if (w.time - (p.lastSignal ?? -Infinity) < 2) return { ok: false, message: 'Wait a moment before marking again.' };
  p.lastSignal = w.time;
  const close = (target, range) => Math.hypot(point.x - target.x, point.y - (target.y ?? 0), point.z - target.z) < range;
  const surface = point.y > -3;
  const wreck = activeSalvage(w).wreck;
  const label = close(w.cargo, 8) ? 'Archive' : surface && close({ x: wreck.x + 17, y: 2, z: wreck.z }, 12) ? 'Survey buoy' :
    surface && close(w.ship, 14) ? 'Kestrel' : surface && close({ x: BASE.x - 22, y: 2, z: BASE.z }, 26) ? 'Pelican Station' : point.y < -2 ? 'Dive marker' : 'Sea marker';
  w.signals ??= {}; w.signalSequence = (w.signalSequence ?? 0) + 1;
  w.signals[id] = { id: w.signalSequence, owner: id, x: point.x, y: point.y, z: point.z, label, time: w.time, expires: w.time + 18 };
  w.revision++;
  return { ok: true };
}

export function act(w, id, action, data = {}) {
  if (action === 'pickupCourse') return startPickup(w, id, data.diver);
  if (action === 'cancelPickup') return cancelPickup(w, id);
  if (action === 'acceptResearch') return acceptResearch(w, id, data.destination);
  if (action === 'fileResearch') return finishResearch(w, id);
  if (action === 'setAsideResearch') return finishResearch(w, id, false);
  if (action === 'shareSighting') return shareSighting(w, id, data.type);
  if (action === 'chartSighting') return chartSighting(w, id, data.type);
  if (action === 'inscribeShip') return inscribeShip(w, id, data.text, data.expectedRevision);
  if (action === 'paintHull') return paintHull(w, id, data.paint);
  if (action === 'writeCrewLog') return writeCrewLog(w, id, data);
  if (action === 'chartCrewEntry') return chartCrewEntry(w, id, data);
  if (action === 'nextSalvage') return beginSalvage(w, id, data.destination);
  if (action === 'savePlace') return savePlace(w, id, data);
  if (action === 'removePlace') return removePlace(w, id, data);
  if (action === 'updatePlace') return updatePlace(w, id, data);
  if (action === 'crewCall') return sendCrewCall(w, id, data.kind);
  if (action === 'acknowledgeCall') return acknowledgeCrewCall(w, id, data.owner, data.callId);
  if (action === 'signal') return markLocation(w, id, data);
  if (action === 'course') {
    const player = w.players[id], site = voyageDestinations(w).find(s => s.id === data.destination);
    if (!player?.connected || (data.destination !== null && !site)) return { ok: false, message: 'Choose a destination from the voyage chart.' };
    w.pickup = null;
    w.course = site ? { id: site.id, owner: id } : null;
    w.log = site ? `${player.name} plotted a course to ${site.name}.` : `${player.name} restored mission guidance.`;
    w.revision++; return { ok: true };
  }
  if (!availableActions(w, id).includes(action)) return { ok: false, message: 'Move closer or wait for the station to become available.' };
  const p = w.players[id], s = w.ship;
  const release = () => { if (s.pilot === id) s.pilot = null; if (w.winch === id) w.winch = null; p.input = {}; };
  switch (action) {
    case 'helm': release(); p.mode = 'helm'; s.pilot = id; break;
    case 'leaveHelm': case 'leaveWinch': release(); p.mode = 'deck'; p.deckX = action === 'leaveHelm' ? 0 : 1.9; p.deckZ = action === 'leaveHelm' ? 5.5 : -3.1; p.deckYaw = 0; break;
    case 'anchor': s.anchor = !s.anchor; w.log = s.anchor ? 'Anchor deployed. The cutter will hold position.' : 'Anchor raised. The helm is ready.'; break;
    case 'dive': release(); p.mode = 'diver'; Object.assign(p, boardingEntry(s)); startDive(w, p); break;
    case 'board': case 'rescue': finishPickup(w, p, action === 'rescue'); finishDive(w, p, action === 'rescue'); release(); p.mode = 'deck'; p.deckX = DECK_SPAWN.x; p.deckZ = action === 'board' ? -5.5 : DECK_SPAWN.z; p.deckYaw = 0; w.log = action === 'rescue' ? `${p.name} returned aboard using the safety beacon.` : `${p.name} is back aboard.`; break;
    case 'attach':
      w.cargo.attached = true; w.mission = 'recovery';
      // The assigned archive course has served its purpose. Restore the moving
      // boarding target for divers and recovery guidance for the deck crew.
      if (w.course?.id === 'salvage-active') w.course = null;
      recordMilestone(w, 'attached', [p]); w.log = 'Lifting cable secured. Return aboard and operate the winch.'; break;
    case 'winch': release(); w.winch = id; p.mode = 'winch'; break;
    case 'deliver':
      w.mission = 'complete'; s.anchor = true;
      w.explorationWeather = { time: w.time, storm: w.storm };
      w.delivery = { time: w.time, receivedFrom: p.name, crew: Object.values(w.players).filter(member => member.connected).map(member => member.name) };
      if (w.contract) w.delivery.duration = w.time - w.contract.startedAt;
      w.log = 'Expedition complete. The archive crate is safely back at Pelican Station.'; break;
  }
  w.revision++;
  return { ok: true };
}

export function tick(w, dt = STEP) {
  w.daylightStart ??= w.time;
  w.time += dt;
  for (const [id, call] of Object.entries(w.calls || {})) if (call.expires <= w.time || !canCall(w, id, call.kind)) delete w.calls[id];
  for (const [id, signal] of Object.entries(w.signals || {})) if (signal.expires <= w.time || !w.players[id]) delete w.signals[id];
  const s = w.ship;
  // Older saved voyages begin their open-sea weather clock from the last
  // observed state, preserving continuity on their first resumed tick.
  if (w.mission === 'complete' && !w.explorationWeather) w.explorationWeather = { time: Math.max(0, w.time - dt), storm: w.storm };
  w.storm = stormAfter(w);
  recordResearchWeather(w);
  updatePickup(w);
  for (const p of Object.values(w.players)) if (w.time - p.lastInput > .65) p.input = {};
  const input = w.players[s.pilot]?.input || {};
  const targetSpeed = s.anchor ? 0 : (input.forward || 0) * ((input.forward || 0) < 0 ? 3 : 10);
  const previousSpeed = s.speed;
  s.speed = damp(s.speed, targetSpeed, s.anchor ? 3 : .48, dt);
  // Keep an unwrapped phase so snapshot interpolation never spins backwards
  // across a revolution. It also preserves the shaft orientation on rejoin.
  s.propellerAngle = (s.propellerAngle ?? 0) + (previousSpeed + s.speed) * .5 * dt * 2.2;
  advanceAnchor(s, dt);
  // With +Z forward, screen-right is -X: positive rudder decreases yaw.
  s.yawRate = damp(s.yawRate, s.anchor ? 0 : -(input.turn || 0) * (.12 + Math.abs(s.speed) * .025), 2, dt);
  s.heading += s.yawRate * dt;
  if (!s.anchor) {
    s.x += (Math.sin(s.heading) * s.speed + w.storm * .2) * dt;
    s.z += (Math.cos(s.heading) * s.speed + w.storm * .1) * dt;
  }
  // Conservative hull bounds stop the cutter against the floating dock.
  // Station interactions do not need to trust a client's collision geometry.
  const dockX = BASE.x - 22, dockZ = BASE.z;
  const hullX = Math.abs(Math.sin(s.heading)) * 9 + Math.abs(Math.cos(s.heading)) * 3.2;
  const hullZ = Math.abs(Math.cos(s.heading)) * 9 + Math.abs(Math.sin(s.heading)) * 3.2;
  const overlapX = 8.5 + hullX - Math.abs(s.x - dockX), overlapZ = 11.5 + hullZ - Math.abs(s.z - dockZ);
  if (overlapX > 0 && overlapZ > 0) {
    if (overlapX < overlapZ) s.x += Math.sign(s.x - dockX || 1) * overlapX;
    else s.z += Math.sign(s.z - dockZ || 1) * overlapZ;
    s.speed *= -.15;
  }
  const radius = Math.hypot(s.x, s.z);
  if (w.mission === 'outbound' && !s.anchor && s.pilot && distance(s, BASE) > 35) recordMilestone(w, 'departed', Object.values(w.players).filter(p => p.connected));
  if (radius > DOMAIN_RADIUS - 30) { s.x *= (DOMAIN_RADIUS - 30) / radius; s.z *= (DOMAIN_RADIUS - 30) / radius; s.speed = 0; s.anchor = true; }
  const h = seaHeight(s.x, s.z, w.time, w.storm), dx = Math.sin(s.heading) * 7, dz = Math.cos(s.heading) * 7;
  s.y = damp(s.y, h, 4, dt);
  s.pitch = damp(s.pitch, -Math.atan2(seaHeight(s.x + dx, s.z + dz, w.time, w.storm) - seaHeight(s.x - dx, s.z - dz, w.time, w.storm), 14), 2, dt);
  s.roll = damp(s.roll, Math.atan2(seaHeight(s.x + dz * .4, s.z - dx * .4, w.time, w.storm) - seaHeight(s.x - dz * .4, s.z + dx * .4, w.time, w.storm), 5.6) - s.yawRate * s.speed * .025, 2, dt);
  if (w.mission === 'outbound' && distance(s, activeSalvage(w).wreck) < 32) {
    w.mission = 'dive'; w.stormStart = w.time;
    recordMilestone(w, 'wreck', Object.values(w.players).filter(p => p.connected));
    w.log = 'Wreck located. Anchor by the buoy, dive, and attach the crate. Weather is approaching from the west.';
  }
  for (const p of Object.values(w.players)) {
    if (p.mode !== 'diver') {
      if (p.mode === 'deck') walkDeck(p, p.input, dt, w.cargo.recovered);
      const x = p.mode === 'deck' ? p.deckX : 0, z = p.mode === 'deck' ? p.deckZ : (p.mode === 'helm' ? HELM_STATION_Z : -3.1);
      p.x = s.x + Math.cos(s.heading) * x + Math.sin(s.heading) * z;
      p.z = s.z - Math.sin(s.heading) * x + Math.cos(s.heading) * z;
      p.y = s.y + 3; continue;
    }
    const i = p.input; p.yaw = i.yaw ?? p.yaw; p.pitch = i.pitch ?? p.pitch;
    const f = i.forward || 0, strafe = i.strafe || 0, v = i.vertical || 0;
    const norm = Math.max(1, Math.hypot(f, strafe, v));
    p.x += (Math.sin(p.yaw) * Math.cos(p.pitch) * f - Math.cos(p.yaw) * strafe) * dt * 5 / norm;
    p.z += (Math.cos(p.yaw) * Math.cos(p.pitch) * f + Math.sin(p.yaw) * strafe) * dt * 5 / norm;
    p.y += (Math.sin(p.pitch) * f + v) * dt * 5 / norm;
    const r = Math.hypot(p.x, p.z); if (r > DOMAIN_RADIUS) { p.x *= DOMAIN_RADIUS / r; p.z *= DOMAIN_RADIUS / r; }
    p.y = clamp(p.y, oceanFloor(p.x, p.z, RECIPE) + 1.6, seaHeight(p.x, p.z, w.time, w.storm) + .1);
    measureDive(p);
  }
  if (w.cargo.attached && !w.cargo.recovered && w.winch && s.anchor && distance(s, w.cargo) < 34) {
    w.cargo.y = Math.min(2, w.cargo.y + dt * ARCHIVE_LIFT_SPEED);
    if (w.cargo.y >= 2) {
      w.cargo.recovered = true; w.mission = 'return';
      recordMilestone(w, 'recovered', [w.players[w.winch]]);
      w.log = 'Crate secured on deck. Recover the divers, raise anchor, and return north to Pelican Station.';
      const p = w.players[w.winch]; if (p) p.mode = 'deck'; w.winch = null; w.revision++;
    }
  }
  if (w.cargo.recovered) { w.cargo.x = s.x; w.cargo.y = s.y + 2.5; w.cargo.z = s.z; }
  advanceSurvey(w, dt);
  discoverWrecks(w);
}

export function snapshot(w) {
  return { ...w, players: Object.fromEntries(Object.entries(w.players).map(([id, p]) => [id, { ...p, surveying: isSurveying(w, id), input: undefined, lastInput: undefined }])) };
}
