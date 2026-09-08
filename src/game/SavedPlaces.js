import { DOMAIN_RADIUS, oceanFloor } from '../underwater/OceanDomain.js';

export const PLACE_LIMIT = 24;
export const PLACE_NOTE_LIMIT = 400;

export function updatePlace(world, id, data) {
  const player = world.players[id], place = Object.hasOwn(world.places || {}, data.destination) ? world.places[data.destination] : null;
  if (!player?.connected || !place) return { ok: false, message: 'Choose a saved place to update.' };
  if (data.expectedRevision !== (place.revision || 0)) return { ok: false, message: 'A crewmate updated this place. Your draft is kept; reload the crew notes before saving.' };
  const name = typeof data.name === 'string' ? data.name.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 40) : '';
  if (!name || typeof data.note !== 'string' || data.note.length > PLACE_NOTE_LIMIT) return { ok: false, message: `Enter a place name and a note of up to ${PLACE_NOTE_LIMIT} characters.` };
  const note = data.note.replace(/[\x00-\x08\x0b-\x1f]/g, '').trim();
  Object.assign(place, { name, note, revision: (place.revision || 0) + 1, updatedBy: player.name, updatedAt: world.time });
  world.log = `${player.name} updated the crew notes for ${name}.`; world.revision++;
  return { ok: true, place: { ...place } };
}

export function savePlace(world, id, data) {
  const player = world.players[id], signal = world.signals?.[data.owner];
  if (!player?.connected) return { ok: false, message: 'Join the crew before saving a place.' };
  if (!signal || signal.id !== data.signalId || signal.expires <= world.time) return { ok: false, message: 'That mark has expired. Mark the location again to save it.' };
  const name = typeof data.name === 'string' ? data.name.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 40) : '';
  if (!name) return { ok: false, message: 'Give this place a name.' };
  world.places ??= {};
  const key = `place-${signal.id}`;
  if (world.places[key]) return { ok: false, message: 'This mark is already saved in the crew chart.' };
  if (Object.keys(world.places).length >= PLACE_LIMIT) return { ok: false, message: `The chart holds ${PLACE_LIMIT} saved places. Remove an old place to make room.` };
  world.places[key] = { id: key, name, x: signal.x, y: signal.y, z: signal.z, time: world.time, savedBy: player.name };
  world.log = `${player.name} saved ${name} in the crew chart.`; world.revision++;
  return { ok: true };
}

export function removePlace(world, id, data) {
  if (!world.players[id]?.connected || !Object.hasOwn(world.places || {}, data.destination)) return { ok: false, message: 'Choose a saved place to remove.' };
  const place = world.places[data.destination]; delete world.places[data.destination];
  if (world.course?.id === place.id) world.course = null;
  world.log = `${world.players[id].name} removed ${place.name} from the crew chart.`; world.revision++;
  return { ok: true };
}

export function validPlaces(world) {
  if (world.places === undefined) return true;
  if (!world.places || typeof world.places !== 'object' || Array.isArray(world.places) || Object.keys(world.places).length > PLACE_LIMIT) return false;
  return Object.entries(world.places).every(([id, p]) => /^place-[1-9]\d*$/.test(id) && p && p.id === id &&
    typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 40 && typeof p.savedBy === 'string' && p.savedBy.length <= 20 &&
    (p.note === undefined || typeof p.note === 'string' && p.note.length <= PLACE_NOTE_LIMIT) &&
    (p.sourceSighting === undefined || typeof p.sourceSighting === 'string' && Object.hasOwn(world.sightings || {}, p.sourceSighting)) &&
    (p.revision === undefined || Number.isSafeInteger(p.revision) && p.revision >= 0) &&
    (p.updatedBy === undefined || typeof p.updatedBy === 'string' && p.updatedBy.length <= 20) &&
    (p.updatedAt === undefined || Number.isFinite(p.updatedAt) && p.updatedAt >= p.time && p.updatedAt <= world.time) &&
    [p.x, p.y, p.z, p.time].every(Number.isFinite) && p.time >= 0 && p.time <= world.time &&
    Math.hypot(p.x, p.z) <= DOMAIN_RADIUS && p.y <= 12 && p.y >= oceanFloor(p.x, p.z, { seed: world.seed, relief: 1, habitatScale: 1 }) - 2);
}
