import { pickupTarget } from './PickupCourse.js';
import { HABITATS } from '../underwater/WorldMath.js';
import { connectedHabitat } from '../underwater/OceanDomain.js';
import { explorationStops } from '../underwater/BiomeLayout.js';
import { activeSalvage } from './SalvageSites.js';
import { discoveredWrecks } from './WreckDiscoveries.js';

let cachedKey, cachedSites;
export function voyageSites(recipe = { seed: 713 }) {
  const key = JSON.stringify([recipe.seed, recipe.relief ?? 1, recipe.habitatScale ?? 1]);
  if (key === cachedKey) return cachedSites;
  const main = HABITATS.map(h => {
    const site = connectedHabitat(h, recipe.seed, recipe);
    return { id: h.id, biome: h.id, name: h.name, description: h.description, eye: site.eye };
  });
  cachedSites = [...main, ...explorationStops(recipe)].map(s => ({ id: s.id, biome: s.biome, name: s.name,
    description: s.description, x: s.eye[0], y: s.eye[1], z: s.eye[2] }));
  cachedKey = key; return cachedSites;
}

export function voyageDestinations(world) {
  const salvage = activeSalvage(world);
  return [...voyageSites({ seed: world.seed }), { id: 'salvage-active', biome: 'salvage', name: salvage.name,
    ...salvage.cargo, description: 'Assigned survey archive. Anchor Kestrel within cable range, dive to attach the archive, then recover it with the winch.' },
    { id: 'pelican-station', biome: 'harbor', name: 'Pelican Station', ...(world.locations?.base || { x: -140, z: 440 }), y: 0,
      description: 'Kestrel’s home station. Return with your crew, deliver recovered archives, or anchor here before choosing another expedition.' },
    ...discoveredWrecks(world),
    ...Object.values(world.places || {}).map(p => ({ ...p, biome: 'saved', description: `Saved by ${p.savedBy}.${p.note ? ` ${p.note}` : ' A place your crew chose to keep.'}` }))];
}

export function courseTarget(world, id) {
  const pickup = pickupTarget(world, id); if (pickup) return pickup;
  const p = world.players[id], site = voyageDestinations(world).find(s => s.id === world.course?.id);
  if (!p || !site) return null;
  const from = p.mode === 'diver' ? p : world.ship, horizontal = Math.hypot(site.x - from.x, site.z - from.z);
  const bearing = courseBearing(from, site);
  const y = p.mode === 'diver' ? site.y : 2;
  if (site.biome === 'harbor') {
    const diver = p.mode === 'diver', target = diver ? { x: world.ship.x, y: 0, z: world.ship.z } : { x: site.x, y: 2, z: site.z };
    return { key: 'course', label: diver ? 'Kestrel · homeward crew' : site.name, ...target, site,
      distance: diver ? Math.hypot(target.x - p.x, p.y, target.z - p.z) : horizontal,
      detail: diver ? 'Board Kestrel for the homeward sail' : `${bearing.toString().padStart(3, '0')}° · Home station`,
      hint: diver ? 'Ascend and return alongside Kestrel’s boarding ladder' : horizontal < 24 ? 'At Pelican Station · slow and anchor beside the station' :
        Object.values(world.players).some(other => other.connected && other.mode === 'diver') ? 'Recover the dive team before sailing home' : 'Follow the homeward course to Pelican Station' };
  }
  if (site.biome === 'salvage') return { key: 'course', label: site.name, x: site.x, y, z: site.z,
    distance: p.mode === 'diver' ? Math.hypot(horizontal, site.y - p.y) : horizontal,
    detail: `${bearing.toString().padStart(3, '0')}° · ${Math.round(-site.y)} m recovery`, site,
    hint: world.cargo.recovered ? 'Archive recovered · N to resume mission guidance' : world.cargo.attached ? 'Cable attached · return aboard for recovery · N to resume mission guidance' :
      p.mode === 'diver' ? 'Find the archive · attach the cable within 5 m' : horizontal < 32 ? 'B to anchor · V to dive and attach the archive' : 'Follow the plotted course to the assigned archive' };
  if (site.biome === 'wreck') return { key: 'course', label: site.name, x: site.x, y, z: site.z, site,
    distance: p.mode === 'diver' ? Math.hypot(horizontal, site.y - p.y) : horizontal,
    detail: `${bearing.toString().padStart(3, '0')}° · Explored wreck`,
    hint: p.mode === 'diver' ? 'Explore the wreck · use the crew log to keep your findings' : horizontal < 30 ? 'At the wreck · B to anchor · V to dive' : 'Follow the plotted course to the explored wreck' };
  return { key: 'course', label: site.name, x: site.x, y, z: site.z,
    distance: p.mode === 'diver' ? Math.hypot(horizontal, site.y - p.y) : horizontal,
    detail: `${bearing.toString().padStart(3, '0')}° · ${Math.max(0, Math.round(-site.y))} m deep`,
    hint: site.biome === 'saved' ? (p.mode === 'diver' ? 'Explore your saved place · O to study wildlife' : horizontal < 30 ? 'At your saved place · B to anchor · V to dive' : 'Follow the plotted course to your saved place') : world.surveys?.[site.id]?.completedAt != null ? (p.mode === 'diver' ? 'Survey logged · O to study wildlife · N to choose another dive site' : 'Survey logged · N to choose another dive site') : p.mode === 'diver' ? (world.surveys ? 'Follow the habitat signal · hold X to survey · O to study wildlife' : 'Follow the habitat signal · O to study wildlife') : horizontal < 30 ? (!world.ship.anchor ? 'B to anchor at the dive site' : 'V to enter the water · follow the habitat signal') : 'Follow the plotted course · steer from the helm', site };
}

export function courseBearing(from, to) {
  return Math.round((Math.atan2(-(to.x - from.x), to.z - from.z) * 180 / Math.PI + 360) % 360) % 360;
}
