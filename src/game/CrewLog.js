import { DOMAIN_RADIUS, oceanFloor } from '../underwater/OceanDomain.js';
import { PLACE_LIMIT } from './SavedPlaces.js';

export const CREW_LOG_LIMIT = 64;
export const CREW_LOG_TEXT_LIMIT = 400;

export function writeCrewLog(w, id, data) {
  const p = w.players[id];
  if (!p?.connected) return { ok: false, message: 'Join the crew to write in the ship’s log.' };
  if (typeof data.entryId !== 'string' || !/^[\w-]{12,64}$/.test(data.entryId)) return { ok: false, message: 'Please try adding the entry again.' };
  const existing = (w.crewLog || []).find(e => e.id === data.entryId);
  if (existing) return existing.authorId === id && typeof data.text === 'string' && existing.text === data.text.trim() ? { ok: true } : { ok: false, message: 'This entry has already been recorded.' };
  if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > CREW_LOG_TEXT_LIMIT || /[\x00-\x08\x0b-\x1f]/.test(data.text)) return { ok: false, message: 'Write an entry of 1–400 characters.' };
  if ((w.crewLog || []).length >= CREW_LOG_LIMIT) return { ok: false, message: 'The ship’s log holds 64 crew entries. Your draft has been kept; export the log to keep a copy.' };
  w.crewLog ??= [];
  const position = p.mode === 'diver' ? { x: p.x, y: p.y, z: p.z } : { x: w.ship.x, y: 0, z: w.ship.z };
  w.crewLog.push({ id: data.entryId, authorId: id, author: p.name, text: data.text.trim(), time: w.time, expedition: w.contract?.number || 1, position });
  w.revision++; return { ok: true };
}

export function chartCrewEntry(w, id, data) {
  const p = w.players[id], entry = w.crewLog?.find(e => e.id === data.entryId);
  if (!p?.connected || !entry?.position) return { ok: false, message: 'This log entry has no recorded location.' };
  const existing = Object.values(w.places || {}).find(place => place.sourceLog === entry.id);
  if (existing) return { ok: true, destination: existing.id };
  if (Object.keys(w.places || {}).length >= PLACE_LIMIT) return { ok: false, message: 'The chart is full. Remove a saved place to make room.' };
  w.places ??= {}; w.signalSequence = (w.signalSequence || 0) + 1;
  const key = `place-${w.signalSequence}`;
  w.places[key] = { id: key, name: entry.text.split('\n')[0].slice(0, 40), ...entry.position, time: w.time, savedBy: p.name, note: entry.text, sourceLog: entry.id };
  w.revision++; return { ok: true, destination: key };
}

export function validCrewLog(w) {
  return w.crewLog === undefined || Array.isArray(w.crewLog) && w.crewLog.length <= CREW_LOG_LIMIT && new Set(w.crewLog.map(e => e?.id)).size === w.crewLog.length &&
    w.crewLog.every(e => e && typeof e.id === 'string' && /^[\w-]{12,64}$/.test(e.id) && typeof e.authorId === 'string' && e.authorId.length <= 100 &&
      typeof e.author === 'string' && e.author.length <= 20 && typeof e.text === 'string' && e.text.trim().length > 0 && e.text.length <= CREW_LOG_TEXT_LIMIT &&
      !/[\x00-\x08\x0b-\x1f]/.test(e.text) && Number.isFinite(e.time) && e.time >= 0 && e.time <= w.time && Number.isSafeInteger(e.expedition) && e.expedition >= 1 &&
      (e.position === undefined || e.position && [e.position.x, e.position.y, e.position.z].every(Number.isFinite) && Math.hypot(e.position.x, e.position.z) <= DOMAIN_RADIUS && e.position.y <= 12 && e.position.y >= oceanFloor(e.position.x, e.position.z, { seed: w.seed, relief: 1, habitatScale: 1 }) - 2));
}

export class CrewLogComposer {
  constructor(game, section) {
    this.game = game;
    this.root = document.createElement('form'); this.root.id = 'crew-log-composer';
    this.root.innerHTML = '<label for="crew-log-text">Add a crew entry</label><p>Record a discovery, a decision, or something worth remembering. Entries are shared with the crew and kept with the voyage.</p><textarea id="crew-log-text" maxlength="400" rows="4"></textarea><button id="add-crew-log" type="submit">Add to ship’s log</button><p id="crew-log-status" role="status"></p>';
    section.append(this.root); this.input = this.root.querySelector('textarea'); this.button = this.root.querySelector('button'); this.status = this.root.querySelector('[role=status]');
    this.input.oninput = () => { this.entryId = null; this.update(); };
    this.root.onsubmit = async e => {
      e.preventDefault(); if (this.pending || !this.input.value.trim()) return;
      this.entryId ??= Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); this.pending = true; this.update();
      try {
        await game.net.action('writeCrewLog', { entryId: this.entryId, text: this.input.value });
        this.input.value = ''; this.entryId = null; this.status.textContent = 'Recorded in the shared ship’s log.';
      } catch (error) { this.status.textContent = error.message; }
      finally { this.pending = false; this.update(); }
    };
  }
  update() { this.input.disabled = !!this.pending; this.button.disabled = !!this.pending || !this.game.net.ready || !this.input.value.trim(); }
}
