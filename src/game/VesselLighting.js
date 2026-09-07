import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';

export const WORK_LIGHTS = [[-1.55, 4.35, -.2], [1.55, 4.35, -.2]];
export const WORK_LIGHT_DIRECTION = [0, -.78, -.63];
const point = new THREE.Vector3();
const up = new THREE.Vector3();

export function vesselLightLevel(sunHeight, storm) {
  const day = THREE.MathUtils.smoothstep(sunHeight, .06, .38);
  return Math.max(1 - day, THREE.MathUtils.smoothstep(storm, .2, .85) * .85);
}

export function updateVesselLighting(ship) {
  const level = vesselLightLevel(U.uSunDir.value.y, U.uStormFactor.value);
  U.uVesselLightLevel.value = level;
  for (let i = 0; i < WORK_LIGHTS.length; i++) {
    ship.localToWorld(point.fromArray(WORK_LIGHTS[i]));
    U[`uVesselWorkLight${i}`].value.copy(point);
  }
  U.uVesselWorkDirection.value.fromArray(WORK_LIGHT_DIRECTION).transformDirection(ship.matrixWorld);
  up.set(0, 1, 0).transformDirection(ship.matrixWorld);
  U.uVesselDeckPlane.value.set(up.x, up.y, up.z, -up.dot(ship.position) - 1.72);
}
