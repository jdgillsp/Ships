import { oceanFloor } from '../underwater/OceanDomain.js';

export function shipSeabedDepth(world) {
  return Math.max(0, world.ship.y - oceanFloor(world.ship.x, world.ship.z, { seed: world.seed, relief: 1, habitatScale: 1 }));
}

export function seabedReading(world, id) {
  const p = world.players[id];
  if (!p) return null;
  const diver = p.mode === 'diver', position = diver ? p : world.ship;
  const floor = oceanFloor(position.x, position.z, { seed: world.seed, relief: 1, habitatScale: 1 });
  const metres = Math.max(0, position.y - floor);
  return { metres, floor, label: diver ? 'Above seabed' : 'Seabed depth',
    text: diver ? `${metres.toFixed(1)} m above the seabed` : `Seabed ${metres.toFixed(1)} m below Kestrel` };
}
