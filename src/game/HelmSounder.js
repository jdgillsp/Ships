import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, bar, mesh, dialLabel, batchStatic } from './VesselModels.js';
import { shipSeabedDepth } from './DepthSounder.js';

const SEGMENTS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
const POSITIONS = { a: [0, .035, true], b: [.021, .0175, false], c: [.021, -.0175, false], d: [0, -.035, true], e: [-.021, -.0175, false], f: [-.021, .0175, false], g: [0, 0, true] };
const DIGIT_GEOMETRY = SEGMENTS.map(keys => {
  const parts = [...keys].map(key => {
    const [x, y, horizontal] = POSITIONS[key];
    return new THREE.BoxGeometry(horizontal ? .034 : .004, horizontal ? .004 : .027, .003).translate(-x, y, 0);
  });
  const geometry = mergeGeometries(parts); parts.forEach(g => g.dispose()); return geometry;
});
export function helmDepthDigits(w) { return String(Math.min(9999, Math.round(shipSeabedDepth(w)))).padStart(4, ' '); }

export class HelmSounder {
  constructor(ship) {
    this.root = new THREE.Group(); this.root.name = 'Helm depth sounder'; this.root.position.set(0, 3.43, 6.575); ship.add(this.root);
    const fixed = new THREE.Group(); this.root.add(fixed);
    box(fixed, .35, .145, .018, '#0e2427', 0, 0, .01, 'glass');
    dialLabel(fixed, 'DEPTH', 0, .054, -.005, .014, '#b4c9a5');
    this.digits = Array.from({ length: 4 }, (_, i) => {
      const digit = mesh(this.root, DIGIT_GEOMETRY[0], '#c1d7b1', .105 - i * .057, 0, -.004, .06);
      digit.name = `Sounder digit ${i}`; return digit;
    });
    // Engraved M is read from the aft-facing side of the helm.
    const points = [[-.126, -.021], [-.126, .004], [-.135, -.007], [-.144, .004], [-.144, -.021]];
    for (let i = 1; i < points.length; i++) bar(fixed, [...points[i - 1], -.006], [...points[i], -.006], .0015, '#b4c9a5');
    batchStatic(fixed);
  }
  update(w) {
    const text = helmDepthDigits(w); if (text === this.text) return; this.text = text;
    this.digits.forEach((digit, i) => {
      digit.visible = text[i] !== ' ';
      digit.geometry = DIGIT_GEOMETRY[Number(text[i])];
      if (this.waterDigits) this.waterDigits[i].geometry = digit.geometry;
    });
  }
}
