import * as THREE from 'three';
import { HELM_BOUNDS } from './HelmRig.js';
import { GANTRY_SUPPORTS } from './RecoveryRig.js';

// Broad, ship-local camera blockers avoid hundreds of mesh raycasts per frame.
// Railings remain transparent to the camera so they cannot repeatedly zoom it.
const blockers = [
  [[HELM_BOUNDS.minX, 1.8, HELM_BOUNDS.minZ], [HELM_BOUNDS.maxX, 3.55, HELM_BOUNDS.maxZ]],
  [[-2.15, 1.8, -.15], [2.15, 4.45, 4.75]],
  [[-2.31, 4.4, -.25], [2.31, 4.76, 4.8]],
  [[-1.3, 1.8, -5.2], [1.3, 3.65, -3.4]],
  [[-2.6, 5.38, -6.72], [2.6, 5.85, -6.28]]
];
const cargoBlocker = [[-1.25, 1.8, -3.1], [1.25, 3.8, -1.3]];
const pillars = [-1, 1].map(side => [new THREE.Vector3(side * 2.4, 2, -5.5), new THREE.Vector3(side * 2.4, 5.6, -6.5)]);
const sightlineBlockers = blockers.slice(0, -1), loadedSightlineBlockers = [...sightlineBlockers, cargoBlocker];
const crossbeam = [new THREE.Vector3(-2.4, 5.6, -6.5), new THREE.Vector3(2.4, 5.6, -6.5)];
const eyeSupports = GANTRY_SUPPORTS.map(({ start, end, radius }) => ({ start: new THREE.Vector3(...start), axis: new THREE.Vector3(...end).sub(new THREE.Vector3(...start)), radius }));

export function clearDeckEye(desired) {
  const eye = desired.clone();
  if (eye.z > -3.3 || eye.z < -7.1 || Math.abs(eye.x) < 1.7 || Math.abs(eye.x) > 3.1) return eye;
  // Keep a near brace out of the eye as the camera follows ship motion. The
  // small displacement preserves the player's deck position and walking aim.
  for (let pass = 0; pass < 3; pass++) for (const { start, axis, radius } of eyeSupports) {
    const nearest = start.clone().addScaledVector(axis, THREE.MathUtils.clamp(eye.clone().sub(start).dot(axis) / axis.lengthSq(), 0, 1));
    const offset = eye.clone().sub(nearest), clearance = radius + .32;
    if (offset.lengthSq() >= clearance * clearance) continue;
    if (offset.lengthSq() < 1e-10) offset.set(Math.sign(start.x), 0, 0);
    eye.copy(nearest).addScaledVector(offset.normalize(), clearance);
  }
  return eye;
}

function capsuleEntry(origin, direction, start, end, radius) {
  const axis = end.clone().sub(start), offset = origin.clone().sub(start);
  const aa = axis.lengthSq(), ad = axis.dot(direction), ao = axis.dot(offset), od = offset.dot(direction), oo = offset.lengthSq();
  if (offset.clone().addScaledVector(axis, -Math.max(0, Math.min(1, ao / aa))).lengthSq() <= radius * radius) return 0;
  const a = aa - ad * ad, b = aa * od - ao * ad, c = aa * oo - ao * ao - radius * radius * aa, discriminant = b * b - a * c;
  let nearest = Infinity;
  if (a > 1e-8 && discriminant >= 0) { const t = (-b - Math.sqrt(discriminant)) / a, y = ao + t * ad; if (t >= 0 && y >= 0 && y <= aa) nearest = t; }
  for (const center of [start, end]) {
    const q = origin.clone().sub(center), projection = direction.dot(q), h = projection * projection - q.lengthSq() + radius * radius;
    if (h >= 0) { const t = -projection - Math.sqrt(h); if (t >= 0) nearest = Math.min(nearest, t); }
  }
  return nearest;
}

export function deckSightlineBlocked(origin, target, cargo = false) {
  const delta = target.clone().sub(origin), length = delta.length();
  if (length < .2) return false;
  // Use solid equipment, without the follow camera's safety padding. Thin
  // railings and the ladder should not make distant signals blink on and off.
  for (const [min, max] of cargo ? loadedSightlineBlockers : sightlineBlockers) {
    let enter = 0, leave = 1;
    for (let axis = 0; axis < 3; axis++) {
      const start = origin.getComponent(axis), step = delta.getComponent(axis);
      if (Math.abs(step) < 1e-8) { if (start < min[axis] || start > max[axis]) { enter = 2; break; } }
      else { const a = (min[axis] - start) / step, b = (max[axis] - start) / step; enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b)); }
    }
    if (enter <= leave && leave >= 0 && enter * length < length - .15) return true;
  }
  const direction = delta.multiplyScalar(1 / length);
  for (const [start, end] of pillars) if (capsuleEntry(origin, direction, start, end, .14) < length - .15) return true;
  return capsuleEntry(origin, direction, ...crossbeam, .17) < length - .15;
}

export function clearDeckCamera(target, desired, cargo = false) {
  const delta = desired.clone().sub(target), length = delta.length(); if (length < 1e-6) return desired.clone();
  let fraction = 1;
  for (const [min, max] of cargo ? [...blockers, cargoBlocker] : blockers) {
    let enter = 0, leave = 1;
    for (let axis = 0; axis < 3; axis++) {
      const start = target.getComponent(axis), step = delta.getComponent(axis), lo = min[axis] - .12, hi = max[axis] + .12;
      if (Math.abs(step) < 1e-8) { if (start < lo || start > hi) { enter = 2; break; } }
      else { const a = (lo - start) / step, b = (hi - start) / step; enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b)); }
    }
    if (enter <= leave && leave >= 0 && enter < fraction) fraction = Math.max(0, enter - .08 / length);
  }
  const direction = delta.clone().multiplyScalar(1 / length);
  for (const [start, end] of pillars) fraction = Math.min(fraction, Math.max(0, (capsuleEntry(target, direction, start, end, .26) - .08) / length));
  return target.clone().addScaledVector(delta, fraction);
}

export function deckFollowTarget(player, cargo = false) {
  const target = new THREE.Vector3(player.deckX, 3.15, player.deckZ);
  // A walkable position can lie within a camera blocker's safety padding.
  // Move the pivot out of that padding instead of collapsing the view to zero.
  for (const [min, max] of cargo ? [...blockers, cargoBlocker] : blockers) {
    if (![0, 1, 2].every(i => target.getComponent(i) >= min[i] - .12 && target.getComponent(i) <= max[i] + .12)) continue;
    let best = Infinity, axis = 0, value = 0;
    for (let i = 0; i < 3; i++) for (const edge of [min[i] - .15, max[i] + .15]) { const gap = Math.abs(target.getComponent(i) - edge); if (gap < best) { best = gap; axis = i; value = edge; } }
    target.setComponent(axis, value);
  }
  for (const [start, end] of pillars) {
    const axis = end.clone().sub(start), nearest = start.clone().addScaledVector(axis, THREE.MathUtils.clamp(target.clone().sub(start).dot(axis) / axis.lengthSq(), 0, 1));
    const offset = target.clone().sub(nearest);
    if (offset.lengthSq() < .29 * .29) { if (offset.lengthSq() < 1e-8) offset.set(Math.sign(player.deckX) || 1, 0, 0); target.copy(nearest).addScaledVector(offset.normalize(), .29); }
  }
  return target;
}

export function deckFollowPose(player, orbit, pitch, distance, cargo = false) {
  const target = deckFollowTarget(player, cargo);
  let fallback;
  // Lift over the cabin before resorting to a close camera. Small azimuth
  // offsets let the view clear the roof overhang on the narrow side decks.
  for (let lift = 0; lift <= 9; lift++) for (const offset of [0, -.18, .18]) {
    const elevation = Math.min(1.48, pitch + lift * .14), angle = orbit + offset;
    const desired = target.clone().add(new THREE.Vector3(-Math.sin(angle) * distance * Math.cos(elevation), 1.3 + Math.sin(elevation) * distance, -Math.cos(angle) * distance * Math.cos(elevation)));
    const position = clearDeckCamera(target, desired, cargo);
    if (!fallback || position.distanceToSquared(target) > fallback.distanceToSquared(target)) fallback = position;
    if (position.distanceToSquared(desired) < .001) return { target, position };
  }
  return { target, position: fallback };
}
