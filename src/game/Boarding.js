// The ladder, deck interaction and water entry share one ship-local location.
export const BOARDING_LADDER = { x: 2.95, z: -5, width: .8, deckX: 2.5, entryX: 4.35 };

export function boardingEntry(ship) {
  const { entryX: x, z } = BOARDING_LADDER, c = Math.cos(ship.heading), s = Math.sin(ship.heading);
  return { x: ship.x + c * x + s * z, y: -.8, z: ship.z - s * x + c * z, yaw: ship.heading + Math.PI / 2, pitch: 0 };
}
