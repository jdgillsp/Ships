import * as THREE from 'three';
import { DIVER_EYE } from './VesselModels.js';

export class CrewRig {
  constructor(root) {
    this.root = root;
    this.pose = root.getObjectByName('crew-pose');
    this.head = root.getObjectByName('crew-head');
    this.joints = [-1, 1].map(side => Object.fromEntries(['arm', 'elbow', 'leg', 'knee', 'ankle', 'fin'].map(name => [name, root.getObjectByName(`${name}${side}`)])));
    this.eye = new THREE.Vector3();
    this.hose = Array.from({ length: 6 }, (_, i) => root.getObjectByName(`crew-hose-${i}`));
    this.hoseCurve = new THREE.CubicBezierCurve3(new THREE.Vector3(.3, .67, .02), new THREE.Vector3(.38, .75, .1), new THREE.Vector3(), new THREE.Vector3());
    this.hoseStart = new THREE.Vector3(); this.hoseEnd = new THREE.Vector3(); this.hoseDirection = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
    this.bounds = new THREE.Box3(); this.partBounds = new THREE.Box3();
    this.inverse = new THREE.Matrix4(); this.relative = new THREE.Matrix4();
    this.parts = [];
    root.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); this.parts.push(o); } });
  }
  apply(motion, diving) {
    this.pose.rotation.x = motion.bodyPitch; this.pose.position.y = motion.bob;
    this.head.rotation.x = motion.headPitch;
    // A short articulated hose follows the regulator around the neck pivot.
    // Reusing rigid segments also preserves each segment's motion history.
    this.hoseCurve.v2.set(.2, .14, .2).applyQuaternion(this.head.quaternion).add(this.head.position);
    this.hoseCurve.v3.set(0, .14, .235).applyQuaternion(this.head.quaternion).add(this.head.position);
    this.hoseCurve.getPoint(0, this.hoseStart);
    this.hose.forEach((part, i) => {
      this.hoseCurve.getPoint((i + 1) / this.hose.length, this.hoseEnd);
      this.hoseDirection.subVectors(this.hoseEnd, this.hoseStart);
      part.position.copy(this.hoseStart).add(this.hoseEnd).multiplyScalar(.5);
      part.scale.y = this.hoseDirection.length(); part.quaternion.setFromUnitVectors(this.up, this.hoseDirection.normalize());
      this.hoseStart.copy(this.hoseEnd);
    });
    this.joints.forEach((j, i) => {
      for (const [joint, values] of [['arm', 'arms'], ['elbow', 'elbows'], ['leg', 'legs'], ['knee', 'knees'], ['ankle', 'ankles']]) j[joint].rotation.x = motion[values][i];
      j.fin.visible = diving;
    });
    // The network position is the swimmer's eye. Keep it fixed while the body
    // leans into a stroke and the head counter-rotates to follow their aim.
    return this.eye.fromArray(DIVER_EYE).applyQuaternion(this.head.quaternion).add(this.head.position).applyQuaternion(this.pose.quaternion).add(this.pose.position);
  }
  cameraInside(position, padding = .18) {
    this.root.updateWorldMatrix(true, true);
    this.inverse.copy(this.root.matrixWorld).invert(); this.bounds.makeEmpty();
    for (const part of this.parts) {
      if (!part.visible) continue;
      let parent = part.parent, hidden = false;
      while (parent && parent !== this.root) { if (!parent.visible) { hidden = true; break; } parent = parent.parent; }
      if (hidden) continue;
      this.relative.multiplyMatrices(this.inverse, part.matrixWorld);
      this.bounds.union(this.partBounds.copy(part.geometry.boundingBox).applyMatrix4(this.relative));
    }
    return this.bounds.expandByScalar(padding).containsPoint(this.eye.copy(position).applyMatrix4(this.inverse));
  }
}
