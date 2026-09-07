// Ship-local coordinates keep crew attached to a moving, turning cutter.
import { HELM_BOUNDS } from './HelmRig.js';
export const DECK_SPAWN = { x: 2.5, z: -1.7 };
export const deckWidth = z => 2.73 * Math.sqrt(Math.min(1, Math.max(0, (8.6 - z) / 4.1)));
export function onWalkableDeck(x, z, cargo = false) {
  if (z < -6.55 || z > 7.5 || Math.abs(x) > deckWidth(z)) return false;
  if (Math.abs(x) < 2.36 && z > -.3 && z < 4.92) return false;
  if (Math.abs(x) < 1.52 && z > -5.28 && z < -3.35) return false;
  if (x > HELM_BOUNDS.minX - .22 && x < HELM_BOUNDS.maxX + .22 && z > HELM_BOUNDS.minZ - .22 && z < HELM_BOUNDS.maxZ + .22) return false;
  if (cargo && Math.abs(x) < 1.4 && z > -3.3 && z < -1.1) return false;
  return true;
}
export function walkDeck(player, input, dt, cargo = false) {
  let x = player.deckX ?? DECK_SPAWN.x, z = player.deckZ ?? DECK_SPAWN.z;
  if (!onWalkableDeck(x, z, cargo)) { x = DECK_SPAWN.x; z = DECK_SPAWN.z; }
  const yaw = input.walkYaw ?? player.deckYaw ?? 0;
  const f = input.forward || 0, r = input.strafe || 0, speed = 2.5 / Math.max(1, Math.hypot(f, r));
  const dx = (Math.sin(yaw) * f - Math.cos(yaw) * r) * speed * dt;
  const dz = (Math.cos(yaw) * f + Math.sin(yaw) * r) * speed * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .1));
  for (let i = 0; i < steps; i++) {
    if (onWalkableDeck(x + dx / steps, z, cargo)) x += dx / steps;
    if (onWalkableDeck(x, z + dz / steps, cargo)) z += dz / steps;
  }
  player.deckX = x; player.deckZ = z; player.deckYaw = yaw;
}
