import * as THREE from 'three';
import { mesh, box, bar, hull, batchStatic } from './VesselModels.js';
import { WRECK, RECIPE } from './Simulation.js';
import { oceanFloor } from '../underwater/OceanDomain.js';

const iron = '#77674c', edge = '#9a8d68', dark = '#414d45', crust = '#7e8968';
function pipe(g, points, radius = .06, color = iron) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(g, new THREE.TubeGeometry(curve, points.length * 5, radius, 8), color, 0, 0, 0, 0, 'rust');
}
function ring(g, radius, thickness, x, y, z, color = iron) {
  return mesh(g, new THREE.TorusGeometry(radius, thickness, 6, 20), color, x, y, z, 0, 'rust');
}

export function wreckSite() {
  const site = new THREE.Group(); site.name = 'Research wreck site'; site.position.set(WRECK.x, 0, WRECK.z);
  const ship = new THREE.Group(); ship.name = 'Broken research hull';
  ship.position.y = oceanFloor(WRECK.x, WRECK.z, RECIPE) + .3; ship.rotation.set(.08, .6, .2); site.add(ship);
  hull(ship, '#695e48', false, 'rust');
  // Exposed ribs and longitudinals reveal the shape behind the torn plating.
  for (const z of [-6, -4.5, -3, -1.5, 0, 5.6, 6.8]) {
    const width = z > 5 ? 2.1 : 2.65;
    pipe(ship, [[-width, 1.35, z], [-width * .9, .05, z], [-1, -.85, z], [0, -1.05, z], [1, -.85, z], [width * .9, .05, z], [width, z < 0 ? .7 : 1.5, z]], .085);
  }
  for (const x of [-1.8, 0, 1.8]) bar(ship, [x, -.35, -6.5], [x, -.35, 6], .075, iron, 'rust');
  for (const z of [-5.5, -2.8, -.4]) bar(ship, [-2.7, .65, z], [2.7, .65, z], .065, edge, 'rust');
  // The wheelhouse survives as an open frame: broken window bays, a sloping
  // roof and the old helm remain readable when a diver looks inside.
  box(ship, 3.8, .16, 4.1, iron, 0, .75, 3, 'rust');
  for (const x of [-1.8, 1.8]) {
    box(ship, .1, .75, 4.1, iron, x, 1.18, 3, 'rust');
    for (const z of [1, 2.8, 5]) bar(ship, [x, 1.5, z], [x + .15, 3.05 - z * .04, z], .075, edge, 'rust');
    bar(ship, [x, 1.58, 1], [x, 1.58, 5], .065, edge, 'rust');
  }
  for (const x of [-1.8, -.6, .6, 1.8]) bar(ship, [x, 1.55, 5], [x, 2.85, 5], .075, iron, 'rust');
  box(ship, 3.8, .7, .12, iron, 0, 1.15, 5, 'rust');
  for (const x of [-1.05, 1.05]) { const roof = box(ship, 1.85, .1, 4.6, iron, x, 2.94 + x * .09, 3.05, 'rust'); roof.rotation.set(.07, .015, x < 0 ? -.07 : .17); }
  box(ship, 1.25, .4, .65, dark, -.1, 1.3, 4.3, 'rust');
  const wheel = ring(ship, .33, .038, -.1, 1.8, 4.25, edge); wheel.rotation.x = -.35;
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; bar(ship, [-.1, 1.8, 4.25], [-.1 + Math.cos(a) * .32, 1.8 + Math.sin(a) * .3, 4.25 - Math.sin(a) * .1], .017, edge, 'rust'); }
  // A compact engine and a snapped propeller shaft occupy the open aft hold.
  box(ship, 1.15, .72, 2.15, dark, 0, .18, -3.8, 'rust');
  for (const z of [-4.5, -4, -3.5, -3]) {
    const head = box(ship, 1.35, .3, .35, iron, 0, .67, z, 'rust'); head.rotation.z = .08;
    pipe(ship, [[.65, .65, z], [.95, .55, z], [.95, .1, z]], .065, dark);
  }
  bar(ship, [0, -.05, -4.9], [0, -.25, -7.6], .13, dark, 'rust');
  const flywheel = ring(ship, .53, .11, 0, .2, -4.95, iron); flywheel.rotation.x = .06;
  // Bent rails and a fallen mast break the silhouette without sealing the
  // open hold or placing a roof over the archive's lifting path.
  pipe(ship, [[-2.8, 1.7, -6.4], [-2.95, 2.45, -5], [-2.75, 2.25, -3.8]], .055, edge);
  pipe(ship, [[2.7, 1.6, 4.4], [2.25, 2.55, 6], [.75, 2.7, 8], [0, 2.2, 8.6]], .055, edge);
  for (const [x, z] of [[-2.8, -6], [-2.8, -4.3], [2.3, 6.2], [1.2, 7.7]]) bar(ship, [x, 1.35, z], [x, 2.5, z], .045, iron, 'rust');
  ship.updateWorldMatrix(true, false);
  const mastFoot = ship.localToWorld(new THREE.Vector3(5.8, .1, -3.8));
  mastFoot.y = oceanFloor(mastFoot.x, mastFoot.z, RECIPE) + .105; ship.worldToLocal(mastFoot);
  pipe(ship, [[.1, 2.9, 2.7], [1, 3.25, 1.5], [3.1, 1.9, -.5], mastFoot.toArray()], .105, iron);
  bar(ship, [2, 2.1, -1.4], [4.2, 2.15, .6], .055, edge, 'rust');
  pipe(ship, [[-.1, 2.8, 3], [1.4, 1.3, 1.2], [3.5, .1, -1]], .018, dark);
  for (const x of [-.4, .4]) bar(ship, [x, .6, -.4], [x, 2.75, 1.25], .038, edge, 'rust');
  for (let i = 0; i < 7; i++) { const t = i / 6; bar(ship, [-.4, .6 + t * 2.15, -.4 + t * 1.65], [.4, .6 + t * 2.15, -.4 + t * 1.65], .033, edge, 'rust'); }
  // Sparse calcareous growth sits on structural surfaces, not in mid-water.
  for (let i = 0; i < 42; i++) {
    const side = i % 2 ? -1 : 1, z = 1.2 + (i % 11) * .33, y = 1.55 + Math.floor(i / 11) * .04;
    const b = mesh(ship, new THREE.ConeGeometry(.045 + (i % 3) * .018, .09, 6, 1, true), crust, side * 1.8, y, z, 0, 'rust'); b.rotation.z = side * -.8;
  }
  // Debris follows the sand contours and stays away from the archive,
  // leaving the existing approach and recovery cable unobstructed.
  for (const [x, z, angle, size] of [[-7, -3, .4, 2.3], [-5, -7, 1.2, 1.4], [6, -6, -.5, 1.7], [-7, 4, .1, 1.3]]) {
    const patch = new THREE.Group(), wx = WRECK.x + x, wz = WRECK.z + z;
    patch.position.set(x, oceanFloor(wx, wz, RECIPE), z); patch.rotateY(angle); site.add(patch);
    box(patch, size, .06, size * 1.5, iron, 0, 0, 0, 'rust');
    for (const xx of [-.35, .35]) box(patch, .07, .1, size * 1.4, edge, xx * size, .07, 0, 'rust');
    patch.updateWorldMatrix(true, true);
    // Conform each vertex rather than approximating a curved sand ripple with
    // one tangent plane, which can leave the corners visibly floating.
    patch.traverse(o => { if (!o.isMesh) return; const positions = o.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) { v.fromBufferAttribute(positions, i); const height = v.y + o.position.y + .025; o.localToWorld(v); v.y = oceanFloor(v.x, v.z, RECIPE) + height; o.worldToLocal(v); positions.setXYZ(i, v.x, v.y, v.z); }
      positions.needsUpdate = true; o.geometry.computeVertexNormals();
    });
  }
  return batchStatic(site);
}
