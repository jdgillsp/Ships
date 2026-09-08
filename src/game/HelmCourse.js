import { pickupDiver } from './PickupCourse.js';
import * as THREE from 'three';
import { voyageDestinations } from './VoyageSites.js';
import { mesh } from './VesselModels.js';

export function helmCourseState(w) {
  const diver = pickupDiver(w);
  if (!w.course && !diver) return null;
  const site = diver ? { ...diver, name: `${diver.name} · live pickup` } : voyageDestinations(w).find(s => s.id === w.course.id);
  if (!site) return null;
  const dx = site.x - w.ship.x, dz = site.z - w.ship.z, distance = Math.hypot(dx, dz);
  if (distance < 15) return null;
  // From the aft-facing helm, positive dial rotation appears clockwise.
  // A course to ship-right (-X at heading zero) appears on the right rim.
  const angle = w.ship.heading - Math.atan2(dx, dz);
  return { angle: Math.atan2(Math.sin(angle), Math.cos(angle)), distance, label: site.name };
}

export class HelmCourse {
  constructor(ship) {
    this.pointer = new THREE.Group(); this.pointer.name = 'Helm course pointer'; this.pointer.position.set(-.36, 3.25, 6.565); ship.add(this.pointer);
    const triangle = new THREE.Shape(); triangle.moveTo(0, .117); triangle.lineTo(-.013, .143); triangle.lineTo(.013, .143); triangle.closePath();
    // Face the inlaid pointer toward the aft side of the helm.
    const geometry = new THREE.ShapeGeometry(triangle); geometry.rotateY(Math.PI);
    mesh(this.pointer, geometry, '#8ed5b6', 0, 0, 0, .08);
    this.pointer.visible = false;
  }
  update(w) {
    this.state = helmCourseState(w); this.pointer.visible = !!this.state;
    if (this.state) this.pointer.rotation.z = this.state.angle;
  }
}
