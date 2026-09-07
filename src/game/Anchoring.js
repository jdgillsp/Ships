export const ANCHOR_SECONDS = 4;
export const WINDLASS_POSITION = [0, 2.46, 8.08];
export const anchorDeployment = ship => ship.anchorDrop ?? (ship.anchor ? 1 : 0);

export function anchorStatus(ship) {
  const moving = Math.abs(anchorDeployment(ship) - Number(ship.anchor)) > 1e-6;
  if (moving) return ship.anchor ? { moving, state: 'Lowering…', description: 'Lowering anchor' } : { moving, state: 'Raising…', description: 'Raising anchor' };
  if (!ship.anchor) return { moving, state: 'Raised', description: 'Anchor raised' };
  return Math.abs(ship.speed) > .25 ? { moving, state: 'Setting…', description: 'Anchor setting' } : { moving, state: 'Holding', description: 'Anchor set' };
}

export function advanceAnchor(ship, dt) {
  const from = anchorDeployment(ship), target = ship.anchor ? 1 : 0;
  ship.anchorDrop = target > from ? Math.min(target, from + dt / ANCHOR_SECONDS) : Math.max(target, from - dt / ANCHOR_SECONDS);
}
