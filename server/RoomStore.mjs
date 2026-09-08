import { mkdir, readFile, writeFile, rename, copyFile, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { voyageSites, voyageDestinations } from '../src/game/VoyageSites.js';
import { validPlaces } from '../src/game/SavedPlaces.js';
import { validSalvageState } from '../src/game/SalvageVoyages.js';
import { validMilestones } from '../src/game/VoyageLog.js';
import { validCrewLog } from '../src/game/CrewLog.js';
import { validDiveRecords } from '../src/game/DiveRecords.js';
import { validVoyageLight } from '../src/game/VoyageLight.js';
import { validPickup, validPickupRecords } from '../src/game/PickupCourse.js';
import { validInscription } from '../src/game/CrewInscription.js';
import { HULL_PAINTS } from '../src/game/HullPaint.js';
import { validWreckDiscoveries } from '../src/game/WreckDiscoveries.js';
import { validSightings } from '../src/game/CrewSightings.js';
import { validResearch } from '../src/game/ResearchVoyages.js';
import { validExplorationWeather } from '../src/game/ExplorationWeather.js';

export const RETENTION_MS = 30 * 24 * 60 * 60_000;

export class RoomStore {
  constructor(directory) {
    this.file = path.resolve(directory, 'expeditions.json'); this.pending = Promise.resolve(); this.savedAt = null; this.error = null;
  }
  async load() {
    let text;
    try {
      if ((await stat(this.file)).size > 5_000_000) throw new Error('Save file is too large.');
      text = await readFile(this.file, 'utf8');
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const data = JSON.parse(text);
    if (data?.version !== 1 || !Number.isFinite(data.savedAt) || !Array.isArray(data.rooms) || data.rooms.length > 100) throw new Error('Unsupported expedition save format.');
    const codes = new Set(), finite = (o, fields) => o && fields.every(k => Number.isFinite(o[k]));
    for (const room of data.rooms) {
      const w = room?.world;
      if (!room || !/^[\w-]{12}$/.test(room.code) || codes.has(room.code) || !Number.isFinite(room.touched) || !finite(w, ['time', 'seed', 'storm', 'revision']) ||
        !finite(w.ship, ['x', 'y', 'z', 'heading', 'speed', 'yawRate', 'pitch', 'roll']) || !finite(w.cargo, ['x', 'y', 'z']) ||
        !['outbound', 'dive', 'recovery', 'return', 'complete'].includes(w.mission) || !w.players || Array.isArray(w.players) || Object.keys(w.players).length > 4 ||
        !Array.isArray(room.tokens) || room.tokens.length !== Object.keys(w.players).length || !room.tokens.every(pair => Array.isArray(pair) && pair.length === 2 && /^[a-f0-9]{64}$/.test(pair[0]) && Object.hasOwn(w.players, pair[1])) ||
        new Set(room.tokens.map(p => p[0])).size !== room.tokens.length || new Set(room.tokens.map(p => p[1])).size !== room.tokens.length ||
        typeof w.ship.anchor !== 'boolean' || typeof w.cargo.attached !== 'boolean' || typeof w.cargo.recovered !== 'boolean' ||
        (w.stormStart !== null && !Number.isFinite(w.stormStart)) || typeof w.log !== 'string' ||
        !Array.isArray(room.departed) || !room.departed.every(p => Array.isArray(p) && p.length === 2 && Object.hasOwn(w.players, p[0]) && Number.isFinite(p[1]))) throw new Error('Invalid saved expedition.');
      if (w.delivery != null && (!Number.isFinite(w.delivery.time) || w.delivery.time < 0 || w.delivery.time > w.time ||
        typeof w.delivery.receivedFrom !== 'string' || w.delivery.receivedFrom.length > 20 || !Array.isArray(w.delivery.crew) ||
        w.delivery.crew.length < 1 || w.delivery.crew.length > 4 || w.delivery.crew.some(name => typeof name !== 'string' || name.length > 20))) throw new Error('Invalid saved delivery log.');
      if (!validMilestones(w)) throw new Error('Invalid saved voyage milestones.');
      if (!validCrewLog(w)) throw new Error('Invalid saved crew entries.');
      if (!validDiveRecords(w)) throw new Error('Invalid saved dive records.');
      if (!validWreckDiscoveries(w)) throw new Error('Invalid saved wreck discoveries.');
      if (!validSightings(w)) throw new Error('Invalid saved crew sightings.');
      if (!validResearch(w)) throw new Error('Invalid saved research request.');
      if (!validExplorationWeather(w)) throw new Error('Invalid saved exploration weather.');
      if (w.ship.paint !== undefined && !Object.hasOwn(HULL_PAINTS, w.ship.paint)) throw new Error('Invalid saved hull paint.');
      if (!validInscription(w)) throw new Error('Invalid saved crew inscription.');
      if (!validVoyageLight(w)) throw new Error('Invalid saved daylight clock.');
      if (!validPickupRecords(w)) throw new Error('Invalid saved pickup history.');
      if (!validPickup(w)) throw new Error('Invalid saved pickup course.');
      if (!validPlaces(w)) throw new Error('Invalid saved places.');
      if (!validSalvageState(w)) throw new Error('Invalid saved salvage voyage.');
      if (w.delivery?.duration !== undefined && (!Number.isFinite(w.delivery.duration) || w.delivery.duration < 0 || w.delivery.duration > w.time)) throw new Error('Invalid delivery duration.');
      if (w.ship.propellerAngle !== undefined && !Number.isFinite(w.ship.propellerAngle)) throw new Error('Invalid saved propeller phase.');
      if (w.ship.anchorDrop !== undefined && (!Number.isFinite(w.ship.anchorDrop) || w.ship.anchorDrop < 0 || w.ship.anchorDrop > 1)) throw new Error('Invalid saved anchor deployment.');
      codes.add(room.code);
      for (const [id, p] of Object.entries(w.players)) if (id !== p.id || typeof p.name !== 'string' || p.name.length > 20 ||
        !['deck', 'helm', 'winch', 'diver'].includes(p.mode) || !finite(p, ['x', 'y', 'z', 'yaw', 'pitch', 'deckX', 'deckZ', 'deckYaw'])) throw new Error('Invalid saved crew member.');
      const sites = new Set(voyageSites({ seed: w.seed }).map(s => s.id));
      if (w.course != null && (!voyageDestinations(w).some(s => s.id === w.course.id) || typeof w.course.owner !== 'string')) throw new Error('Invalid saved course.');
      if (!w.surveys || Array.isArray(w.surveys) || Object.entries(w.surveys).some(([id, s]) => !sites.has(id) || !s ||
        !Number.isFinite(s.seconds) || s.seconds < 0 || s.seconds > 8 || (s.completedAt !== null && !Number.isFinite(s.completedAt)) ||
        !Array.isArray(s.contributors) || s.contributors.length > 4 || s.contributors.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string' || p.name.length > 20))) throw new Error('Invalid saved survey.');
    }
    this.savedAt = data.savedAt;
    return data.rooms.filter(r => Date.now() - r.touched < RETENTION_MS);
  }
  save(rooms) {
    const savedAt = Date.now();
    // Snapshot now, before another simulation tick can mutate a queued write.
    // Only token digests reach disk; bearer credentials stay in the browser.
    const text = JSON.stringify({ version: 1, savedAt, rooms: [...rooms].filter(([, r]) => Object.keys(r.world.players).length).map(([code, r]) => ({
      code, touched: r.touched, world: { ...r.world, signals: {}, calls: {}, players: Object.fromEntries(Object.entries(r.world.players).map(([id, p]) => [id, { ...p, input: {}, lastInput: undefined }])) },
      tokens: [...r.tokens], departed: [...r.departed] })) });
    const task = this.pending.catch(() => {}).then(async () => {
      const temporary = this.file + '.tmp';
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(temporary, text, { mode: 0o600 });
      const handle = await open(temporary, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
      await copyFile(this.file, this.file + '.bak').catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rename(temporary, this.file);
      this.savedAt = savedAt; this.error = null;
    });
    this.pending = task.catch(error => { this.error = error.message; throw error; });
    return this.pending;
  }
}
