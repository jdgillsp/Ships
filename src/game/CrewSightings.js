import { FIELD_NOTES } from '../underwater/FieldNotes.js';
import { DOMAIN_RADIUS, oceanFloor } from '../underwater/OceanDomain.js';
import { PLACE_LIMIT } from './SavedPlaces.js';

// Animals are rendered on clients. These are explicitly crew reports; the
// server owns the reporter, time and observer position, not animal identity.
export function shareSighting(w, id, type) {
  const p = w.players[id];
  if (!p?.connected || p.mode !== 'diver') return { ok: false, message: 'Share a sighting while diving with the crew.' };
  if (!Object.hasOwn(FIELD_NOTES, type)) return { ok: false, message: 'Identify an animal before sharing a sighting.' };
  if (w.sightings?.[type]) return { ok: true };
  w.sightings ??= {};
  w.sightings[type] = { observer: p.name, time: w.time, expedition: w.contract?.number || 1, position: { x: p.x, y: p.y, z: p.z } };
  w.log = `${p.name} shared a ${FIELD_NOTES[type][0].toLowerCase()} sighting with the crew.`; w.revision++;
  return { ok: true };
}

export function validSightings(w) {
  return w.sightings === undefined || (!!w.sightings && typeof w.sightings === 'object' && !Array.isArray(w.sightings) &&
    Object.entries(w.sightings).every(([type, r]) => Object.hasOwn(FIELD_NOTES, type) && r && typeof r.observer === 'string' && r.observer.length <= 20 &&
      Number.isFinite(r.time) && r.time >= 0 && r.time <= w.time && Number.isSafeInteger(r.expedition) && r.expedition >= 1 &&
      r.position && [r.position.x, r.position.y, r.position.z].every(Number.isFinite) && Math.hypot(r.position.x, r.position.z) <= DOMAIN_RADIUS &&
      r.position.y <= 12 && r.position.y >= oceanFloor(r.position.x, r.position.z, { seed: w.seed, relief: 1, habitatScale: 1 }) - 2));
}

export function chartSighting(w, id, type) {
  const p = w.players[id], report = Object.hasOwn(w.sightings || {}, type) ? w.sightings[type] : null;
  if (!p?.connected || !report || !Object.hasOwn(FIELD_NOTES, type)) return { ok: false, message: 'Choose a shared crew sighting.' };
  const existing = Object.values(w.places || {}).find(place => place.sourceSighting === type);
  if (existing) return { ok: true, destination: existing.id };
  if (Object.keys(w.places || {}).length >= PLACE_LIMIT) return { ok: false, message: 'The chart is full. Remove a saved place to make room.' };
  w.places ??= {}; w.signalSequence = (w.signalSequence || 0) + 1;
  const key = `place-${w.signalSequence}`, name = FIELD_NOTES[type][0];
  w.places[key] = { id: key, name: `${name} sighting`.slice(0, 40), ...report.position, time: w.time, savedBy: p.name, sourceSighting: type,
    note: `${name} reported by ${report.observer} on expedition ${report.expedition}. This marks the observer’s position; wildlife moves through the ocean.` };
  w.revision++; return { ok: true, destination: key };
}
