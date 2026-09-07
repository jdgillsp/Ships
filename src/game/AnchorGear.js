import * as THREE from 'three';
import { mesh, box, bar, batchStatic } from './VesselModels.js';
import { oceanFloor } from '../underwater/OceanDomain.js';
import { anchorDeployment, WINDLASS_POSITION } from './Anchoring.js';

const EXIT = [0, 2.35, 9.28], EYE = [0, .64, 0];

export class AnchorGear {
  constructor(ship, root) {
    const mount = this.mount = new THREE.Group(); mount.name = 'Bow windlass mount'; ship.add(mount);
    box(mount, .9, .32, .75, '#547277', 0, 1.97, 8.05, 'paint');
    box(mount, 1.05, .14, .9, '#547277', 0, 2.16, 8.05, 'paint');
    for (const x of [-.37, .37]) box(mount, .12, .38, .38, '#748587', x, 2.39, 8.08, 'metal');
    bar(mount, [-.57, 2.46, 8.08], [.57, 2.46, 8.08], .07, '#a0aaa0');
    box(mount, .36, .26, .52, '#34545b', -.58, 2.31, 8.02, 'paint');
    for (const x of [-.13, .13]) bar(mount, [x, 2.22, 8.25], [x, 2.24, 9.35], .045, '#87998e');
    bar(mount, [-.2, 2.23, 9.28], [.2, 2.23, 9.28], .09, '#6d7d76');
    // Alternating near-deck links give the working line a chain silhouette
    // without carrying thousands of individually drawn links to the seabed.
    for (let i = 0; i < 13; i++) {
      const shape = new THREE.TorusGeometry(.063, .016, 6, 12); shape.scale(1, 1.35, 1); shape.rotateX(Math.PI / 2);
      const link = mesh(mount, shape, '#777f75', 0, 2.68 - i * .025, 8.12 + i * .09, 0, 'metal');
      link.rotation.z = i % 2 ? Math.PI / 2 : 0;
    }
    for (let i = 0; i < 7; i++) {
      const angle = Math.min(Math.PI / 2, i * .36), y = 2.46 + .22 * Math.cos(angle) - Math.max(0, i - 4.4) * .085, z = 8.08 - .22 * Math.sin(angle);
      const shape = new THREE.TorusGeometry(.063, .016, 6, 12); shape.scale(1, 1.35, 1); shape.rotateX(Math.PI / 2);
      const link = mesh(mount, shape, '#777f75', 0, y, z, 0, 'metal');
      link.rotation.set(-angle, 0, i % 2 ? Math.PI / 2 : 0, 'XZY');
    }
    mesh(mount, new THREE.CylinderGeometry(.14, .14, .024, 20), '#273e3e', 0, 2.24, 7.86, 0, 'rubber');
    batchStatic(mount);
    this.gypsy = new THREE.Group(); this.gypsy.name = 'Anchor gypsy'; this.gypsy.position.fromArray(WINDLASS_POSITION); ship.add(this.gypsy);
    const drum = mesh(this.gypsy, new THREE.CylinderGeometry(.2, .2, .36, 20), '#6b7c74', 0, 0, 0, 0, 'metal'); drum.rotation.z = Math.PI / 2;
    for (const x of [-.2, .2]) { const flange = mesh(this.gypsy, new THREE.CylinderGeometry(.25, .25, .045, 20), '#8b9789', x, 0, 0, 0, 'metal'); flange.rotation.z = Math.PI / 2; }
    for (let i = 0; i < 8; i++) bar(this.gypsy, [.228, 0, 0], [.228, .19 * Math.cos(i * Math.PI / 4), .19 * Math.sin(i * Math.PI / 4)], .016, '#afb4a1');
    batchStatic(this.gypsy);
    const anchor = this.anchor = new THREE.Group(); anchor.name = 'Bow anchor'; root.add(anchor);
    bar(anchor, [0, -.32, 0], [0, .52, 0], .065, '#7f8a7c');
    mesh(anchor, new THREE.TorusGeometry(.095, .028, 8, 20), '#a5ad9a', ...EYE, 0, 'metal');
    bar(anchor, [-.38, -.31, 0], [.38, -.31, 0], .075, '#6b7a6d');
    for (const side of [-1, 1]) {
      bar(anchor, [0, -.37, 0], [side * .43, -.49, .02], .065, '#7f8a7c');
      const fluke = new THREE.Shape(); fluke.moveTo(side * .27, -.48); fluke.lineTo(side * .5, -.52); fluke.lineTo(side * .6, -.02); fluke.lineTo(side * .32, -.18); fluke.closePath();
      mesh(anchor, new THREE.ExtrudeGeometry(fluke, { depth: .13, bevelEnabled: true, bevelThickness: .015, bevelSize: .015, bevelSegments: 2, steps: 1 }), '#8d9683', 0, 0, -.065, 0, 'metal');
    }
    batchStatic(anchor);
    this.line = bar(root, [0, 0, 0], [0, 1, 0], .023, '#7f897a'); this.line.name = 'Anchor rode';
    this.start = new THREE.Vector3(); this.end = new THREE.Vector3(); this.delta = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); this.level = new THREE.Quaternion();
  }
  update(w, ship) {
    const drop = anchorDeployment(w.ship);
    this.start.fromArray(EXIT); ship.localToWorld(this.start);
    // The deployed anchor follows the seabed, not the ship's heave and roll.
    const x = w.ship.x + Math.sin(w.ship.heading) * EXIT[2], z = w.ship.z + Math.cos(w.ship.heading) * EXIT[2];
    if (drop > 0 && (this.floorSeed !== w.seed || this.floorX === undefined || Math.hypot(x - this.floorX, z - this.floorZ) > .1)) {
      this.floorSeed = w.seed; this.floorX = x; this.floorZ = z;
      this.floorY = oceanFloor(x, z, { seed: w.seed, worldSeed: w.seed, relief: 1, habitatScale: 1 });
    }
    const stowed = this.end.set(0, 1.05, EXIT[2]); ship.localToWorld(stowed);
    this.anchor.position.copy(stowed).lerp(this.delta.set(x, (this.floorY ?? 0) + .56, z), drop);
    this.level.setFromAxisAngle(this.up, w.ship.heading); this.anchor.quaternion.copy(ship.quaternion).slerp(this.level, drop);
    this.end.fromArray(EYE); this.anchor.localToWorld(this.end); this.delta.copy(this.end).sub(this.start);
    this.line.position.copy(this.start).add(this.end).multiplyScalar(.5); this.line.scale.y = this.delta.length(); this.line.quaternion.setFromUnitVectors(this.up, this.delta.normalize());
    this.gypsy.rotation.x = -drop * 24;
  }
}
