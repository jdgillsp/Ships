import * as THREE from 'three';
import { BASE, WRECK, RECIPE, seaHeight } from './Simulation.js';
import { oceanFloor } from '../underwater/OceanDomain.js';

import { mesh, box, bar, cutter, archive, diver, batchStatic } from './VesselModels.js';
import { VesselShadow } from './VesselShadow.js';
import { DECK_SPAWN } from './Deck.js';
import { trackMotion } from './VesselMaterial.js';
import { U } from '../core/SharedUniforms.js';
import { WakeTrail } from './WakeTrail.js';
import { CABLE_EXIT, LIFTING_EYE, recoveryRigState } from './RecoveryRig.js';
import { CrewMotion } from './CrewMotion.js';
import { CrewRig } from './CrewRig.js';
import { wreckSite } from './WreckSite.js';
import { updateVesselLighting } from './VesselLighting.js';
import { helmRigState, HELM_STATION_Z } from './HelmRig.js';
import { AnchorGear } from './AnchorGear.js';

export class Vessels {
  constructor(app) {
    this.app = app; this.root = new THREE.Group(); this.ship = cutter(); this.root.add(this.ship);
    this.base = new THREE.Group(); this.base.position.set(BASE.x - 22, 0, BASE.z); this.root.add(this.base);
    box(this.base, 16, 1.3, 22, '#334f58', 0, .2, 0); box(this.base, 15.8, .22, 21.8, '#b7ae91', 0, 1, 0);
    box(this.base, 8, 4, 7, '#d1d8c3', -2, 3.1, 3);
    for (const side of [-1, 1]) { const roof = box(this.base, 4.45, .18, 7.7, '#758c86', -2 + side * 2.1, 5.55, 3, 'metal'); roof.rotation.z = -side * .19; for (let z = -.6; z < 6.8; z += .4) { bar(this.base, [-2 + side * .05, 6.01, z], [-2 + side * 4.25, 5.2, z], .025, '#a5b0a1'); } }
    const gable = new THREE.Shape(); gable.moveTo(-4, 0); gable.lineTo(4, 0); gable.lineTo(0, .85); gable.closePath();
    mesh(this.base, new THREE.ExtrudeGeometry(gable, { depth: 7, bevelEnabled: false }), '#b6c0aa', -2, 5.1, -.5);
    for (const x of [-4, 0]) box(this.base, 2.1, 1.3, .1, '#214955', x, 3.6, -.55);
    bar(this.base, [5, 1, 6], [5, 11, 6], .12, '#d6e4d4'); mesh(this.base, new THREE.SphereGeometry(.35), '#f6d17e', 5, 11, 6, 2);
    for (const z of [-8, -4, 0, 4, 8]) box(this.base, .5, 1, 1.8, '#263a40', 8.2, .6, z);
    for (let z = -10.7; z < 11; z += .4) box(this.base, 15.7, .025, .025, '#6a715e', 0, 1.125, z, 'wood');
    for (const x of [-7.3, 7.3]) for (const z of [-9, 9]) { bar(this.base, [x, -1, z], [x, 2.6, z], .16, '#607778'); box(this.base, .5, .1, .5, '#a6ad98', x, 2.65, z, 'metal'); }
    for (const x of [-4, 0]) { box(this.base, 2.25, .12, .24, '#9ba99b', x, 2.91, -.58, 'metal'); box(this.base, .07, 1.3, .13, '#b9c1ad', x, 3.6, -.63); }
    box(this.base, 1.5, 2.65, .14, '#647f7c', 2, 2.5, -.6); box(this.base, .7, .7, .035, '#244955', 2, 3.1, -.685, 'glass');
    for (let x = -5.7; x < 2; x += .38) box(this.base, .025, 3.7, .04, '#a0ae9e', x, 3.1, -.53);
    const solar = box(this.base, 2.7, .09, 3.4, '#304f5d', .15, 5.73, 3, 'glass'); solar.rotation.z = -.19;
    for (const z of [-7.5, -5.7]) { mesh(this.base, new THREE.CylinderGeometry(.5, .5, 1.25, 24), '#607b78', -5, 1.76, z, 0, 'metal'); for (const y of [1.3, 2.2]) { const rim = mesh(this.base, new THREE.TorusGeometry(.5,.025,8,24), '#9aa58f', -5,y,z);rim.rotation.x=Math.PI/2; } }
    this.wreck = wreckSite(); this.root.add(this.wreck);
    this.buoy = new THREE.Group(); this.buoy.position.set(WRECK.x + 17, 0, WRECK.z); this.root.add(this.buoy);
    mesh(this.buoy, new THREE.CylinderGeometry(.65, 1, 1.5, 12), '#f2b744', 0, .4); bar(this.buoy, [0, 1, 0], [0, 4, 0], .06, '#f0cb6d');
    mesh(this.buoy, new THREE.SphereGeometry(.22, 10, 8), '#fff5ab', 0, 4, 0, 3);
    this.mooringFloor = oceanFloor(this.buoy.position.x, this.buoy.position.z, RECIPE);
    this.mooring = bar(this.root, [0, 0, 0], [0, 1, 0], .024, '#939875', 'wood');
    this.mooringWeight = new THREE.Group(); this.mooringWeight.position.set(this.buoy.position.x, this.mooringFloor, this.buoy.position.z); this.root.add(this.mooringWeight);
    box(this.mooringWeight, 1.2, .35, 1.1, '#788374', 0, .13, 0, 'rust');
    const eye = mesh(this.mooringWeight, new THREE.TorusGeometry(.15, .035, 6, 16), '#737e70', 0, .36, 0, 0, 'rust');
    eye.rotation.y = .4; batchStatic(this.mooringWeight);
    this.crate = archive(); this.root.add(this.crate);
    this.cable = bar(this.root, [0, 0, 0], [0, 1, 0], .045, '#ece4c3'); this.cable.visible = false;
    this.anchorGear = new AnchorGear(this.ship, this.root);
    this.crew = Array.from({ length: 4 }, (_, index) => { const g = diver(index); this.root.add(g); return g; });
    this.crewMotion = new CrewMotion(); this.crewRigs = this.crew.map(g => new CrewRig(g));
    this.wake = new WakeTrail();
    batchStatic(this.base); batchStatic(this.buoy);
    app.scene.add(this.root);
    this.waterRoot = this.root.clone(true); this.waterRoot.traverse(o => { if (o.isMesh) trackMotion(o); }); app.underwater.scene.add(this.waterRoot);
    this.originals = []; this.copies = []; this.root.traverse(o => this.originals.push(o)); this.waterRoot.traverse(o => this.copies.push(o));
    this.waterCrew = this.crew.map(g => this.copies[this.originals.indexOf(g)]);
    this.machinery = Object.fromEntries(['drum', 'sheave', 'lever', 'active', 'waiting'].map(key => [key, this.ship.getObjectByName(`Recovery ${key}`)]));
    this.helm = Object.fromEntries(['wheel', 'compass', 'speed'].map(key => [key, this.ship.getObjectByName(`Helm ${key}`)]));
    this.radar = this.ship.getObjectByName('Mast radar');
    this.propeller = this.ship.getObjectByName('Stern propeller'); this.rudder = this.ship.getObjectByName('Stern rudder');
    this.shadow = new VesselShadow(app.renderer, this.root);
  }
  update(w, id, view = 'chase') {
    this.helmCamera = w.players[id]?.mode === 'helm' && view === 'deck';
    const s = w.ship; this.ship.position.set(s.x, s.y, s.z); this.ship.rotation.set(s.pitch, s.heading, s.roll, 'YXZ');
    updateVesselLighting(this.ship);
    this.base.position.y = seaHeight(BASE.x, BASE.z, w.time, w.storm) * .5;
    this.buoy.position.y = seaHeight(this.buoy.position.x, this.buoy.position.z, w.time, w.storm);
    const lineBottom = this.mooringFloor + .48, lineTop = this.buoy.position.y - .35;
    this.mooring.position.set(this.buoy.position.x, (lineBottom + lineTop) / 2, this.buoy.position.z); this.mooring.scale.y = lineTop - lineBottom;
    if (w.cargo.recovered) { const pos = this.ship.localToWorld(new THREE.Vector3(0, 2.8, -2.2)); this.crate.position.copy(pos); this.crate.quaternion.copy(this.ship.quaternion); }
    else this.crate.position.set(w.cargo.x, w.cargo.y, w.cargo.z);
    this.cable.visible = w.cargo.attached && !w.cargo.recovered;
    if (this.cable.visible) { const start = this.ship.localToWorld(new THREE.Vector3(...CABLE_EXIT)), end = this.crate.localToWorld(new THREE.Vector3(...LIFTING_EYE)), delta = end.clone().sub(start); this.cable.position.copy(start.add(end).multiplyScalar(.5)); this.cable.scale.y = delta.length(); this.cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); }
    const rig = recoveryRigState(w);
    this.machinery.drum.rotation.x = rig.drum; this.machinery.sheave.rotation.x = rig.sheave; this.machinery.lever.rotation.x = rig.lever;
    this.machinery.active.visible = rig.active; this.machinery.waiting.visible = rig.waiting;
    const helm = helmRigState(w); for (const key of ['wheel', 'compass', 'speed']) this.helm[key].rotation.z = helm[key];
    this.propeller.rotation.z = helm.propeller; this.rudder.rotation.y = helm.rudder;
    this.anchorGear.update(w, this.ship);
    // Absolute voyage time keeps the scanner in phase across clients, pauses,
    // rejoining and the paired above-water/underwater model copies.
    this.radar.rotation.y = (w.time % 4) * Math.PI / 2;
    const players = Object.values(w.players);
    for (const key of this.crewMotion.states.keys()) if (!w.players[key]) this.crewMotion.states.delete(key);
    this.crew.forEach((g, i) => { const p = players[i]; g.visible = !!p && p.connected && (p.id !== id || (p.mode !== 'diver' && view !== 'deck')); if (!p) return;
      const eye = this.crewRigs[i].apply(this.crewMotion.update(p, w.time), p.mode === 'diver');
      if (p.mode === 'diver') { g.rotation.set(0, p.yaw, 0, 'YXZ'); g.position.set(p.x, p.y, p.z).sub(eye.applyQuaternion(g.quaternion)); }
      else { g.position.copy(this.ship.localToWorld(new THREE.Vector3(p.mode === 'deck' ? (p.deckX ?? DECK_SPAWN.x) : p.mode === 'winch' ? 1.72 : 0, 2.65, p.mode === 'deck' ? (p.deckZ ?? DECK_SPAWN.z) : p.mode === 'helm' ? HELM_STATION_Z : -3.05))); g.rotation.copy(this.ship.rotation); if (p.mode === 'deck') g.rotateY(p.deckYaw ?? 0); else if (p.mode === 'winch') g.rotateY(Math.PI); }
    });
    const trail = this.wake.update(s, w.time);
    U.uShipWakeCount.value = trail.length;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    trail.forEach((p, i) => {
      U.uShipWake.value[i].set(p.x, p.z, p.time, p.strength);
      minX = Math.min(minX, p.x); minZ = Math.min(minZ, p.z); maxX = Math.max(maxX, p.x); maxZ = Math.max(maxZ, p.z);
    });
    if (trail.length) U.uShipWakeBounds.value.set(minX - 14, minZ - 14, maxX + 14, maxZ + 14);
    for (let i = 0; i < this.originals.length; i++) { const a = this.originals[i], b = this.copies[i]; b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); b.visible = a.visible; }
    this.shadow.update(this.ship);
  }
  updateCameraVisibility(camera) {
    // Crew can share a station exit or swim through each other. Suppress a
    // body around the eye so its helmet cannot fill the view. The fixed helm
    // camera needs extra clearance for crew walking between it and the wheel.
    // Use the final camera pose after smoothing, including at the waterline.
    this.crew.forEach((g, i) => {
      if (g.visible) g.visible = !this.crewRigs[i].cameraInside(camera.position, this.helmCamera ? 1 : .18);
      this.waterCrew[i].visible = g.visible;
    });
  }
}
