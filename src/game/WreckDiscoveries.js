import { SALVAGE_SITES } from './SalvageSites.js';

export const wreckName = id => ({ reef: 'Reef survey wreck', west: 'Western survey wreck', east: 'Eastern survey wreck' })[id];

// Close underwater arrival records a visit, not a claim of visual identification.
export function discoverWrecks(w) {
  for (const site of SALVAGE_SITES) {
    if (w.wreckDiscoveries?.[site.id]) continue;
    const crew = Object.values(w.players).filter(p => p.connected && p.mode === 'diver' && p.y < -3 &&
      Math.hypot(p.x - site.cargo.x, p.y - site.cargo.y, p.z - site.cargo.z) <= 12);
    if (!crew.length) continue;
    w.wreckDiscoveries ??= {};
    w.wreckDiscoveries[site.id] = { time: w.time, expedition: w.contract?.number || 1, crew: crew.map(p => p.name) };
    w.log = `${crew.map(p => p.name).join(' & ')} explored ${wreckName(site.id).toLowerCase()}. The wreck is kept on the crew chart.`;
    w.revision++;
  }
}

export function validWreckDiscoveries(w) {
  const records = w.wreckDiscoveries;
  return records === undefined || (!!records && typeof records === 'object' && !Array.isArray(records) &&
    Object.entries(records).every(([id, r]) => SALVAGE_SITES.some(s => s.id === id) && r &&
      Number.isFinite(r.time) && r.time >= 0 && r.time <= w.time && Number.isSafeInteger(r.expedition) && r.expedition >= 1 &&
      Array.isArray(r.crew) && r.crew.length > 0 && r.crew.length <= 4 && r.crew.every(n => typeof n === 'string' && n.length <= 20)));
}

export function discoveredWrecks(w) {
  return SALVAGE_SITES.filter(s => w.wreckDiscoveries?.[s.id]).map(s => ({ id: `wreck-${s.id}`, wreckId: s.id,
    biome: 'wreck', name: wreckName(s.id), ...s.cargo,
    description: 'A wreck your crew has explored. Return to investigate the hull and surrounding seabed. Salvage assignments are accepted separately at Pelican Station.' }));
}
