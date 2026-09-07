import { HABITATS } from '../underwater/WorldMath.js';
import { connectedHabitat } from '../underwater/OceanDomain.js';
import { explorationStops } from '../underwater/BiomeLayout.js';

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

export function courseTarget(world, id) {
  const p = world.players[id], site = voyageSites({ seed: world.seed }).find(s => s.id === world.course?.id);
  if (!p || !site) return null;
  const from = p.mode === 'diver' ? p : world.ship, horizontal = Math.hypot(site.x - from.x, site.z - from.z);
  const bearing = courseBearing(from, site);
  const y = p.mode === 'diver' ? site.y : 2;
  return { key: 'course', label: site.name, x: site.x, y, z: site.z,
    distance: p.mode === 'diver' ? Math.hypot(horizontal, site.y - p.y) : horizontal,
    detail: `${bearing.toString().padStart(3, '0')}° · ${Math.round(-site.y)} m deep`,
    hint: world.surveys?.[site.id]?.completedAt != null ? (p.mode === 'diver' ? 'Survey logged · O to study wildlife · N to choose another dive site' : 'Survey logged · N to choose another dive site') : p.mode === 'diver' ? (world.surveys ? 'Follow the habitat signal · hold X to survey · O to study wildlife' : 'Follow the habitat signal · O to study wildlife') : horizontal < 30 ? (!world.ship.anchor ? 'B to anchor at the dive site' : 'V to enter the water · follow the habitat signal') : 'Follow the plotted course · steer from the helm', site };
}

export function courseBearing(from, to) {
  return Math.round((Math.atan2(-(to.x - from.x), to.z - from.z) * 180 / Math.PI + 360) % 360) % 360;
}
