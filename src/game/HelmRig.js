export const HELM_VIEW = { x: 0, y: 3.6, z: 5.1, pitch: -.3 };
export const HELM_STATION_Z = 5.9;
export const HELM_BOUNDS = { minX: -.65, maxX: .65, minZ: 6.52, maxZ: 7.4 };
export const HELM_SPEED_MAX = 20;
export function helmSpeedAngle(knots) { return -2.2 + Math.min(1, Math.abs(knots) / HELM_SPEED_MAX) * 4.4; }
export function helmFieldOfView(aspect) {
  // Keep both instruments inside a portrait viewport without changing the
  // familiar desktop view or moving the eye through the wheel.
  const width = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return Math.min(100, Math.max(65, 2 * Math.atan(Math.tan(24 * Math.PI / 180) / width) * 180 / Math.PI));
}

export function helmRigState(world) {
  const s = world.ship, rudder = Math.max(-1, Math.min(1, -(s.yawRate || 0) / (.12 + Math.abs(s.speed) * .025)));
  return { wheel: rudder * .9, rudder: rudder * .55, propeller: s.propellerAngle ?? 0, compass: s.heading,
    speed: helmSpeedAngle(s.speed * 1.944) };
}
