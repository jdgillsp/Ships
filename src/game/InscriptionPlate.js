import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import fontData from 'three/examples/fonts/helvetiker_regular.typeface.json';
import { box, mesh } from './VesselModels.js';
import { DEFAULT_INSCRIPTION } from './CrewInscription.js';

const font = new FontLoader().parse(fontData);
export class InscriptionPlate {
  constructor(ship) {
    this.root = new THREE.Group(); this.root.name = 'Crew inscription plate';
    this.root.position.set(0, 4.18, -.19); this.root.rotation.y = Math.PI; ship.add(this.root);
    box(this.root, 3.15, .34, .065, '#a39364', 0, 0, 0, 'metal');
    for (const x of [-1.48, 1.48]) mesh(this.root, new THREE.SphereGeometry(.025, 8, 6), '#4d5147', x, 0, .04, 0, 'metal');
    this.letters = mesh(this.root, new THREE.BufferGeometry(), '#283e3d', 0, 0, .039);
    this.letters.name = 'Crew inscription lettering'; this.update(DEFAULT_INSCRIPTION);
  }
  update(text) {
    if (text === this.text) return; this.text = text;
    const geometry = new THREE.ShapeGeometry(font.generateShapes(text, .15), 3);
    geometry.computeBoundingBox(); const bounds = geometry.boundingBox, scale = Math.min(1, 2.82 / (bounds.max.x - bounds.min.x));
    geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -(bounds.min.y + bounds.max.y) / 2, 0); geometry.scale(scale, scale, 1);
    const old = this.letters.geometry; this.letters.geometry = geometry;
    if (this.waterLetters) this.waterLetters.geometry = geometry;
    old.dispose();
  }
}
