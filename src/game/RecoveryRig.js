import { CRATE, distance } from './Simulation.js';

export const WINCH_VIEW = { x: 2.4, y: 3.6, z: -1, yaw: Math.atan2(-2.4, -3.3), pitch: Math.atan2(-.65, Math.hypot(2.4, 3.3)) };
export const WINCH_CONTROL = { x: 1.72, y: 2.95, z: -3.55 };
export const CABLE_EXIT = [0, 5.35, -6.82];
export const LIFTING_EYE = [0, 1.39, 0];
// Geometry and camera clearance share the working frame's three supports.
export const GANTRY_SUPPORTS = [-2.4, 2.4].flatMap(x => [
  { start: [x, 2, -5.5], end: [x, 5.6, -6.5], radius: .14, color: '#c99c50', finish: 'paint' },
  { start: [x, 2.1, -3.9], end: [x, 4.4, -6.15], radius: .095, color: '#788c8b', finish: 'metal' },
  { start: [x, 2.1, -3.9], end: [x, 3.4, -5.1], radius: .14, color: '#3b5357', finish: 'metal' }
]);

// Use authoritative haul distance, not local elapsed time: spectators, paused
// lifts and reconnecting crew must all see the same drum and sheave positions.
export function recoveryRigState(w) {
  const start = w.cargo.initialY ?? CRATE.y;
  const lifted = w.cargo.recovered ? 2 - start : w.cargo.attached ? Math.max(0, w.cargo.y - start) : 0;
  const lifting = w.cargo.attached && !w.cargo.recovered && !!w.winch && w.ship.anchor && distance(w.ship, w.cargo) < 34;
  return { drum: -lifted / .47, sheave: -lifted / .27, lever: lifting ? -.45 : 0,
    active: lifting || w.cargo.recovered, waiting: w.cargo.attached && !w.cargo.recovered && !lifting };
}
