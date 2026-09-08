import { oceanFloor } from '../underwater/OceanDomain.js';

const recipe = { seed: 713, relief: 1, habitatScale: 1 };
export const ARCHIVE_LIFT_SPEED = 2.2;
export const SALVAGE_SITES = [
  ['reef', 'The lost archive', -140, 245],
  ['west', 'The western survey archive', -330, 260],
  ['east', 'The eastern survey archive', 180, 260]
].map(([id, name, x, z]) => ({ id, name, wreck: { x, z }, cargo: { x: x + 9, y: oceanFloor(x + 9, z + 5, recipe) + 1, z: z + 5 } }));

export function activeSalvage(world) { return SALVAGE_SITES.find(s => s.id === world.contract?.site) || SALVAGE_SITES[0]; }
