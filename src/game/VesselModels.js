import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { material, trackMotion } from './VesselMaterial.js';
import { WORK_LIGHTS, WORK_LIGHT_DIRECTION } from './VesselLighting.js';
import { WINCH_CONTROL, GANTRY_SUPPORTS } from './RecoveryRig.js';
import { BOARDING_LADDER } from './Boarding.js';
import { dialStrokes } from './DialMarkings.js';
import { helmSpeedAngle, HELM_SPEED_MAX } from './HelmRig.js';
import { RADIO_STATION } from './RadioStation.js';

export function mesh(g, geo, color, x = 0, y = 0, z = 0, glow = 0, finish = 'paint') {
  const m = trackMotion(new THREE.Mesh(geo, material(color, glow, finish))); m.position.set(x, y, z); g.add(m); return m;
}
export function box(g, w, h, d, color, x = 0, y = 0, z = 0, finish = 'paint') {
  return mesh(g, new RoundedBoxGeometry(w, h, d, 2, Math.min(.09, w / 5, h / 5, d / 5)), color, x, y, z, 0, finish);
}
export function bar(g, a, b, r, color, finish = 'metal') {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
  const m = mesh(g, new THREE.CylinderGeometry(r, r, delta.length(), 12), color, 0, 0, 0, 0, finish);
  m.position.copy(start.add(end).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return m;
}
function tube(g, points, r, color, finish = 'metal', closed = false, detail = 1) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
  return mesh(g, new THREE.TubeGeometry(curve, points.length * 6 * detail, r, 8 * detail, closed), color, 0, 0, 0, 0, finish);
}
function torus(g, r, thickness, color, x, y, z, finish = 'metal') {
  return mesh(g, new THREE.TorusGeometry(r, thickness, 8, 28), color, x, y, z, 0, finish);
}

// Continuous rings keep the bilge round and the bow fine. The same outline is
// used for the deck, sheer rail and paint bands, so details stay on the hull.
function outline() {
  const s = new THREE.Shape(); s.moveTo(-2.65, -7); s.lineTo(2.65, -7);
  s.bezierCurveTo(3.0, -5, 3.15, 1, 3.0, 3.7);
  s.bezierCurveTo(2.9, 6, 1.15, 8.35, 0, 9);
  s.bezierCurveTo(-1.15, 8.35, -2.9, 6, -3.0, 3.7);
  s.bezierCurveTo(-3.15, 1, -3, -5, -2.65, -7); return s;
}
const sheer = z => .26 * Math.pow(Math.max(0, (z + 2) / 11), 2);
export function hull(g, color, deck = false, finish = 'paint') {
  const shape = outline(), ring = shape.getPoints(20); ring.pop();
  const levels = [[-1.35, .42], [-.9, .7], [-.25, .88], [.4, .95], [1.15, .985], [1.8, 1]];
  const verts = [], idx = [], n = ring.length;
  for (const [y, scale] of levels) for (const p of ring) {
    const broken = finish === 'rust' && y > .4 && Math.abs(p.x) > .5 && p.y < 1 ? (.55 + .22 * Math.sin(p.y * 5 + p.x)) * (y / 1.8) : 0;
    verts.push(p.x * scale, y + sheer(p.y) - broken, p.y * (.96 + scale * .04));
  }
  for (let j = 0; j < levels.length - 1; j++) for (let i = 0; i < n; i++) {
    if (finish === 'rust' && j > 2 && Math.abs(ring[i].x) > 1 && ring[i].y > -4 && ring[i].y < (ring[i].x > 0 ? .2 : -1)) continue;
    const a = j * n + i, b = j * n + (i + 1) % n;
    idx.push(a, a + n, b, b, a + n, b + n);
  }
  const keel = verts.length / 3; verts.push(0, -1.35, 0);
  for (let i = 0; i < n; i++) idx.push(i, (i + 1) % n, keel);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  mesh(g, geo, color, 0, 0, 0, 0, finish);
  if (deck) {
    const floor = new THREE.ShapeGeometry(shape, 20); floor.rotateX(Math.PI / 2);
    for (let i = 0; i < floor.index.count; i += 3) { const b = floor.index.getX(i + 1); floor.index.setX(i + 1, floor.index.getX(i + 2)); floor.index.setX(i + 2, b); }
    floor.computeVertexNormals();
    mesh(g, floor, '#99917a', 0, 1.81, 0, 0, 'wood');
    for (const [y, r, c] of [[1.82, .095, '#263b40'], [.5, .065, '#b8b4a0']]) tube(g, ring.map(p => [p.x * (y < 1 ? .955 : 1), y + sheer(p.y), p.y]), r, c, 'rubber', true);
  }
  return ring;
}

function windowPane(g, width, height, x, y, z, rotation = 0) {
  const frame = new THREE.Group(); frame.position.set(x, y, z); frame.rotation.y = rotation; g.add(frame);
  box(frame, width + .13, height + .13, .13, '#283e44', 0, 0, 0, 'rubber');
  box(frame, width, height, .035, '#244955', 0, 0, .08, 'glass');
  box(frame, width + .2, .055, .2, '#d7d5bf', 0, -height / 2 - .08, .035, 'metal');
  return frame;
}
function cleat(g, x, y, z) {
  box(g, .48, .055, .28, '#748587', x, y, z, 'metal');
  bar(g, [x, y, z], [x, y + .2, z], .075, '#a0adab');
  bar(g, [x - .3, y + .2, z], [x + .3, y + .2, z], .065, '#a0adab');
}
function winch(g) {
  box(g, 1.9, .25, 1.8, '#243a3c', 0, 1.95, -4.3);
  const drum = new THREE.Group(); drum.name = 'Recovery drum'; drum.position.set(0, 2.95, -4.3);
  for (const x of [-.85, .85]) {
    box(g, .18, 1.25, 1.15, '#c8903f', x, 2.55, -4.3);
    const rim = mesh(drum, new THREE.CylinderGeometry(.63, .63, .1, 28), '#9aa6a0', x, 0, 0, 0, 'metal'); rim.rotation.z = Math.PI / 2;
    const face = x + Math.sign(x) * .065;
    bar(drum, [face, -.48, 0], [face, .48, 0], .035, '#c8903f', 'paint');
    bar(drum, [face, 0, -.48], [face, 0, .48], .035, '#c8903f', 'paint');
  }
  bar(drum, [-1.1, 0, 0], [1.1, 0, 0], .35, '#364446');
  for (let x = -.69; x < .7; x += .065) { const coil = torus(drum, .47, .036, '#6a7771', x, 0, 0); coil.rotation.y = Math.PI / 2; }
  box(g, .45, .55, .6, '#476166', 1.22, 2.85, -4.3);
  for (const x of [-2.4, 2.4]) {
    box(g, .5, .3, .8, '#31484b', x, 1.95, -5.5);
    for (const support of GANTRY_SUPPORTS.filter(s => s.start[0] === x))
      bar(g, support.start, support.end, support.radius, support.color, support.finish);
    torus(g, .16, .045, '#a8aca0', x, 2.1, -5.64);
  }
  bar(g, [-2.4, 5.6, -6.5], [2.4, 5.6, -6.5], .17, '#c99c50', 'paint');
  const sheave = new THREE.Group(); sheave.name = 'Recovery sheave'; sheave.position.set(0, 5.35, -6.5);
  const pulley = torus(sheave, .27, .075, '#53696a', 0, 0, 0); pulley.rotation.y = Math.PI / 2;
  for (const x of [-.04, .04]) {
    bar(sheave, [x, -.24, 0], [x, .24, 0], .025, '#9aa6a0');
    bar(sheave, [x, 0, -.24], [x, 0, .24], .025, '#9aa6a0');
  }
  tube(g, [[0, 3.42, -4.3], [0, 5.64, -6.45], [0, 5.6, -6.66], [0, 5.35, -6.82]], .027, '#777d6e');
  // A compact operator console gives the station a visible point of use.
  box(g, .15, .9, .15, '#53696a', 1.72, 2.3, -3.65, 'metal');
  box(g, .62, .2, .55, '#476166', 1.72, 2.83, -3.65);
  const lever = new THREE.Group(); lever.name = 'Recovery lever'; lever.position.set(WINCH_CONTROL.x, WINCH_CONTROL.y, WINCH_CONTROL.z);
  bar(lever, [0, 0, 0], [0, .3, 0], .035, '#9aa6a0');
  mesh(lever, new THREE.SphereGeometry(.075, 12, 8), '#243638', 0, .3, 0, 0, 'rubber');
  const lights = new THREE.Group(); lights.position.set(1.48, 2.97, -3.78);
  const active = mesh(lights, new THREE.SphereGeometry(.06, 12, 8), '#65d5a9', 0, 0, 0, 1.5); active.name = 'Recovery active'; active.visible = false;
  const waiting = mesh(lights, new THREE.SphereGeometry(.06, 12, 8), '#e5b95c', 0, 0, 0, 1.5); waiting.name = 'Recovery waiting'; waiting.visible = false;
  return [batchStatic(drum), batchStatic(sheave), batchStatic(lever), lights];
}

// Merge static parts per finish. More model detail need not mean hundreds of
// extra draw calls in each of the above-water and underwater render passes.
export function batchStatic(group) {
  group.updateMatrixWorld(true); const inverse = group.matrixWorld.clone().invert(), byMaterial = new Map(), meshes = [];
  group.traverse(o => { if (!o.isMesh) return; meshes.push(o); const geo = o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
    const flat = geo.index ? geo.toNonIndexed() : geo; flat.deleteAttribute('uv');
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []); byMaterial.get(o.material).push(flat);
  });
  for (const m of meshes) m.removeFromParent();
  for (const [mat, geos] of byMaterial) { const geo = mergeGeometries(geos); group.add(trackMotion(new THREE.Mesh(geo, mat))); for (const g of geos) g.dispose(); }
  return group;
}

export function cutter() {
  const g = new THREE.Group(); g.name = 'Kestrel expedition cutter'; hull(g, '#34545b', true);
  for (let x = -2.5; x <= 2.5; x += .32) box(g, .012, .012, 10.4, '#655f51', x, 1.825, -1.4, 'wood');
  // Raised foredeck, tapered wheelhouse and wraparound framed glazing.
  box(g, 4.35, .22, 3.1, '#a6a18b', 0, 1.99, 5.5);
  const cabin = box(g, 4.25, 2.5, 4.65, '#c6c7b7', 0, 3.16, 2.4);
  const pos = cabin.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y > 0) { pos.setX(i, pos.getX(i) * (1 - y * .075)); pos.setZ(i, pos.getZ(i) - Math.max(0, pos.getZ(i)) * y * .09); } }
  pos.needsUpdate = true; cabin.geometry.computeVertexNormals();
  box(g, 4.6, .19, 5, '#687f7e', 0, 4.5, 2.25);
  box(g, 4.35, .11, 4.7, '#d2d3c3', 0, 4.62, 2.25);
  for (const x of [-1.27, 0, 1.27]) { const pane = windowPane(g, 1.08, .92, x, 3.72, 4.55); pane.rotation.x = -.1;
    bar(g, [x - .35, 3.32, 4.65], [x + .1, 3.99, 4.65], .018, '#24383b', 'rubber'); }
  for (const side of [-1, 1]) {
    for (const z of [1.3, 2.9]) windowPane(g, 1.25, .86, side * 1.99, 3.7, z, side * Math.PI / 2);
    box(g, .045, .16, 3.5, '#547277', side * 2.1, 2.45, 2.6);
  }
  box(g, 1.02, 2, .1, '#667d7b', .65, 2.93, .03);
  windowPane(g, .65, .7, .65, 3.42, -.04, Math.PI);
  bar(g, [.91, 2.65, -.12], [.91, 2.92, -.12], .028, '#b7bbae');
  windowPane(g, .95, .85, -.95, 3.55, .02, Math.PI);
  box(g, 1.4, .12, .7, '#a5aa99', .65, 1.99, -.45);
  for (const y of [2.35, 2.51, 2.67]) box(g, .8, .045, .07, '#2b4247', -.95, y, -.015);
  deckRadio(g);
  for (const side of [-1, 1]) {
    const points = [[side * 2.64, 2.9, -6.5], [side * 2.9, 2.9, -3], [side * 2.96, 2.95, 2], [side * 2.65, 3.05, 5], [side * 1.45, 3.15, 7.5], [0, 3.25, 8.8]];
    // Leave the ladder opening clear instead of asking divers to pass through
    // a continuous handrail. The opposite rail remains unbroken.
    const edges = [[2.75, 2.9, BOARDING_LADDER.z - .6], [2.82, 2.9, BOARDING_LADDER.z + .6]];
    const rails = side === 1 ? [[points[0], edges[0]], [edges[1], ...points.slice(1)]] : [points];
    for (const rail of rails) { tube(g, rail, .04, '#b8c3bc'); tube(g, rail.map(([x,y,z])=>[x,y-.5,z]), .027, '#a4b1ac'); }
    if (side === 1) for (const [x, y, z] of edges) bar(g, [x, 1.85, z], [x, y, z], .04, '#b8c3bc');
    for (const [x,y,z] of points.slice(0,-1)) bar(g, [x, 1.85 + sheer(z), z], [x,y,z], .04, '#b8c3bc');
    for (const z of [-4, -.6, 3.8]) {
      const f = mesh(g, new THREE.CapsuleGeometry(.23, .7, 6, 14), '#243638', side * 3.1, 1.03, z, 0, 'rubber'); f.rotation.z = side * .13;
      bar(g, [side*2.94,2.9,z], [side*3.1,1.6,z], .023, '#a79f7e', 'wood');
      for (const y of [.75, 1.3]) { const belt = torus(g, .235, .023, '#52615c', side * 3.1, y, z, 'rubber'); belt.rotation.x = Math.PI / 2; }
    }
    for (const z of [-6.1, 5.8]) cleat(g, side * 2.2, 1.92, z);
  }
  bar(g, [0, 4.7, 2], [0, 7.7, 2], .09, '#adb6ac');
  bar(g, [-1.2, 6.7, 2], [1.2, 6.7, 2], .06, '#adb6ac');
  mesh(g, new THREE.CylinderGeometry(.44, .5, .3, 24), '#deddd0', 0, 6.9, 2);
  mesh(g, new THREE.CylinderGeometry(.16, .16, .12, 16), '#adb6ac', 0, 7.075, 2, 0, 'metal');
  const radar = new THREE.Group(); radar.name = 'Mast radar'; radar.position.set(0, 7.16, 2);
  box(radar, 1.5, .13, .32, '#b9c5bc');
  for (const x of [-1.4, 1.4]) bar(g, [x,4.7,1.3], [x,7.3,1.3], .02, '#9daaa2');
  for (const side of [-1,1]) { box(g, .3,.2,.45,'#283f42',side*2.15,4.7,3.6); mesh(g,new THREE.SphereGeometry(.09,12,8),side>0?'#ef6d50':'#65d5a9',side*2.23,4.8,3.6,2); }
  mesh(g,new THREE.SphereGeometry(.12,12,8),'#fff0c7',0,7.8,2,2);
  box(g, .65,.32,.5,'#49605f',0,4.85,4.05);
  mesh(g,new THREE.CircleGeometry(.21,24),'#f2e6c3',0,4.85,4.31,.6,'glass');
  for (const [x, y, z] of WORK_LIGHTS) {
    bar(g, [x, 4.48, -.06], [x, y, z], .035, '#768c86');
    const fixture = new THREE.Group(); fixture.position.set(x, y, z);
    fixture.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...WORK_LIGHT_DIRECTION).normalize());
    box(fixture, .48, .3, .22, '#334c50', 0, 0, 0, 'metal');
    const lens = box(fixture, .4, .22, .025, '#ffdab0', 0, 0, .126, 'lamp');
    lens.material = material('#ffdab0', 4, 'lamp');
    g.add(fixture);
  }
  for (const x of [-1.2,1.2]) box(g, .65,.12,1.25,'#355058',x,4.74,2.2,'glass');
  const machinery = [...winch(g), ...helm(g), ...sternGear(g), batchStatic(radar)];
  box(g, 3.8,.22,1.4,'#657e7c',0,.62,-7.65);
  for (let x=-1.6;x<1.7;x+=.2) box(g,.05,.035,1.2,'#bec4b5',x,.75,-7.65,'metal');
  const ladder = BOARDING_LADDER;
  for (const z of [ladder.z - ladder.width / 2, ladder.z + ladder.width / 2]) {
    tube(g, [[ladder.x + .2, -.5, z], [ladder.x + .2, 2.3, z], [ladder.x + .15, 2.65, z], [ladder.x - .11, 2.85, z], [ladder.x - .33, 2.65, z], [ladder.x - .33, 1.95, z]], .045, '#bdc8bc', 'metal', false, 2);
    box(g, .19, .05, .19, '#7e9793', ladder.x - .33, 1.96, z, 'metal');
  }
  for (let y = -.35; y < 1.8; y += .35) bar(g, [ladder.x + .2, y, ladder.z - ladder.width / 2], [ladder.x + .2, y, ladder.z + ladder.width / 2], .04, '#bdc8bc');
  box(g, .27, .025, .86, '#bca36b', ladder.deckX, 1.97, ladder.z, 'rubber');
  const life=torus(g,.46,.115,'#c6763d',-2.94,2.48,-1,'rubber');life.rotation.y=Math.PI/2;
  for (let i=0;i<3;i++) { const coil=torus(g,.42+i*.065,.035,'#a69a75',-1.6,1.88+i*.01,-4,'wood');coil.rotation.x=Math.PI/2; }
  box(g,1.4,.12,1.6,'#5c7575',-.9,1.9,-1.7);box(g,.3,.08,.1,'#c3c5b3',-.9,2.01,-1.2,'metal');
  return batchStatic(g).add(...machinery);
}

function sternGear(hull) {
  bar(hull,[0,-.7,-5.7],[0,-1.05,-7.65],.075,'#748587');
  bar(hull,[0,-.75,-6.9],[0,-1.06,-7.25],.09,'#34545b','paint');
  const propeller=new THREE.Group();propeller.name='Stern propeller';propeller.position.set(0,-1.05,-7.65);
  const hub=mesh(propeller,new THREE.CapsuleGeometry(.13,.16,6,20),'#a18b60',0,0,0,0,'metal');hub.rotation.x=Math.PI/2;
  for(let i=0;i<3;i++) {
    const blade=new THREE.Group();blade.rotation.z=i*Math.PI*2/3;propeller.add(blade);
    const outline=new THREE.Shape();outline.moveTo(-.065,.08);outline.bezierCurveTo(-.2,.22,-.24,.48,-.1,.57);outline.bezierCurveTo(.05,.64,.2,.43,.14,.28);outline.quadraticCurveTo(.08,.15,.065,.08);outline.closePath();
    const geo=new THREE.ExtrudeGeometry(outline,{depth:.025,bevelEnabled:true,bevelThickness:.008,bevelSize:.009,bevelSegments:2,steps:1,curveSegments:10});
    const m=mesh(blade,geo,'#a18b60',0,0,-.01,0,'metal');m.rotation.y=.4;
  }
  box(hull,.35,.12,.32,'#748587',0,.46,-8.22,'metal');
  bar(hull,[0,.51,-8.22],[0,-1.25,-8.22],.065,'#748587');
  const rudder=new THREE.Group();rudder.name='Stern rudder';rudder.position.set(0,-1.22,-8.22);
  const blade=box(rudder,.095,1.05,.65,'#34545b',0,-.05,-.23,'paint');blade.rotation.x=-.08;
  return [batchStatic(propeller),batchStatic(rudder)];
}

function deckRadio(parent) {
  const g = new THREE.Group(); g.name = 'Deck radio'; g.position.set(RADIO_STATION.x, RADIO_STATION.y, RADIO_STATION.z); parent.add(g);
  for (const x of [-.18, .18]) box(g, .035, .42, .32, '#7c8980', x, 0, .16, 'metal');
  box(g, .48, .52, .16, '#bca875');
  box(g, .41, .43, .025, '#283e40', 0, .015, -.09, 'rubber');
  box(g, .27, .065, .02, '#8caaa0', .035, .14, -.11);
  dialLabel(g, '01', .035, .14, -.127, .045, '#263e40');
  for (let i = 0; i < 7; i++) box(g, .24, .012, .012, '#101f24', .035, .065 - i * .024, -.113, 'rubber');
  for (const x of [-.11, .12]) {
    const knob = mesh(g, new THREE.CylinderGeometry(.037, .037, .036, 16), '#b6bfb3', x, -.15, -.12, 0, 'metal'); knob.rotation.x = Math.PI / 2;
    bar(g, [x, -.15, -.145], [x, -.129, -.145], .004, '#253e40', 'rubber');
  }
  mesh(g, new THREE.SphereGeometry(.014, 8, 6), '#83ba89', -.16, .14, -.113, .15);
  box(g, .085, .24, .07, '#253c3e', -.32, -.01, -.03, 'rubber');
  box(g, .13, .045, .09, '#bcc6bb', -.32, .1, -.015, 'metal');
  bar(g, [-.2, .08, .035], [-.32, .08, .035], .018, '#bcc6bb');
  const cord = [];
  for (let i = 0; i <= 48; i++) { const t = i / 48, a = t * Math.PI * 18; cord.push([-.32 + t * .2 + Math.sin(a) * .014, -.16 - Math.sin(t * Math.PI) * .22, -.03 + Math.cos(a) * .014]); }
  tube(g, cord, .007, '#243a3b', 'rubber');
  bar(g, [.17, .27, .01], [.2, .63, .01], .007, '#303e3e', 'rubber');
}

function helm(parent) {
  const g = new THREE.Group(); g.position.z = .6; parent.add(g);
  box(g, .5, .85, .52, '#667d7b', 0, 2.56, 6.4);
  box(g, 1.14, .65, .68, '#c6c7b7', 0, 3.16, 6.4);
  box(g, 1.04, .5, .035, '#263e44', 0, 3.18, 6.045, 'rubber');
  box(g, 1.3, .12, .82, '#687f7e', 0, 3.51, 6.4);
  bar(g, [0, 3.1, 6.04], [0, 3.1, 5.95], .065, '#adb6ac');
  const wheel = new THREE.Group(); wheel.name = 'Helm wheel'; wheel.position.set(0, 3.1, 5.93);
  mesh(wheel, new THREE.TorusGeometry(.24, .026, 12, 64), '#243638', 0, 0, 0, 0, 'rubber');
  for (let i = 0; i < 3; i++) { const angle = i * Math.PI * 2 / 3; bar(wheel, [0, 0, 0], [Math.sin(angle) * .22, Math.cos(angle) * .22, 0], .015, '#b8c3bc'); }
  mesh(wheel, new THREE.SphereGeometry(.055, 12, 8), '#b8c3bc');
  const needles = [];
  for (const [x, name] of [[-.36, 'compass'], [.36, 'speed']]) {
    torus(g, .115, .015, '#b8c3bc', x, 3.25, 6.01);
    mesh(g, new THREE.CircleGeometry(.108, 24), '#122b32', x, 3.25, 6.025);
    const needle = new THREE.Group(); needle.name = `Helm ${name}`; needle.position.set(x, 3.25, 5.98);
    if (name === 'compass') {
      // Rotate the card with north so the fixed top index reads the actual
      // heading. Radial lettering is upright as each cardinal reaches it.
      for (let i = 0; i < 36; i++) {
        const angle = i * Math.PI / 18, inner = i % 3 ? .094 : .086;
        bar(needle, [-Math.sin(angle) * inner, Math.cos(angle) * inner, 0], [-Math.sin(angle) * .102, Math.cos(angle) * .102, 0], .0016, '#bdc9b8');
      }
      for (const [i, letter] of [...'NESW'].entries()) {
        const angle = i * Math.PI / 2;
        dialLabel(needle, letter, -Math.sin(angle) * .064, Math.cos(angle) * .064, -.003, .027, letter === 'N' ? '#e89070' : '#d7dfc9', angle);
      }
      bar(needle, [0, 0, -.005], [0, .038, -.005], .003, '#d87868');
      bar(needle, [0, 0, -.005], [0, -.03, -.005], .0025, '#b6c1ad');
      for (const side of [-1, 1]) bar(g, [x + side * .014, 3.395, 5.974], [x, 3.375, 5.974], .0035, '#e7ba73');
    } else {
      const face = new THREE.Group(); face.position.set(x, 3.25, 5.995); g.add(face);
      for (let knot = 0; knot <= HELM_SPEED_MAX; knot++) {
        const angle = helmSpeedAngle(knot), inner = knot % 5 ? .095 : .084;
        bar(face, [-Math.sin(angle) * inner, Math.cos(angle) * inner, 0], [-Math.sin(angle) * .102, Math.cos(angle) * .102, 0], knot % 5 ? .0015 : .0025, '#bdc9b8');
        if (knot % 5 === 0) dialLabel(face, String(knot), -Math.sin(angle) * .063, Math.cos(angle) * .063, -.002, .022, '#d7dfc9');
      }
      dialLabel(face, 'KN', 0, -.041, -.002, .017, '#9db7a6');
      bar(needle, [0, -.02, -.009], [0, .081, -.009], .003, '#e7ba73');
    }
    mesh(needle, new THREE.SphereGeometry(.009, 12, 8), '#b8c3bc', 0, 0, -.012);
    needles.push(batchStatic(needle));
  }
  const moving = [batchStatic(wheel), ...needles]; for (const part of moving) part.position.z += .6; return moving;
}

function dialLabel(parent, text, x, y, z, height, color, angle = 0) {
  const label = new THREE.Group(); label.name = `Dial ${text}`; label.position.set(x, y, z); label.rotation.z = angle; parent.add(label);
  for (const [a, b] of dialStrokes(text)) {
    // The helm face is viewed from local -Z, so its writing runs toward -X.
    const line = bar(label, [-a[0] * height, a[1] * height, 0], [-b[0] * height, b[1] * height, 0], height * .055, color);
    line.material = material(color, .06, 'paint');
  }
}

export function archive() {
  const g=new THREE.Group();box(g,2.3,1.7,1.7,'#b48747');
  box(g,2.34,.13,1.74,'#354c50',0,.58);box(g,2.3,.28,1.7,'#ba975b',0,.77);
  for (const x of [-1.1,1.1]) for (const z of [-.8,.8]) {
    box(g,.18,1.84,.18,'#506463',x,0,z,'metal');
    for (const y of [-.8,.8]) box(g,.35,.2,.35,'#7c8a7c',x,y,z,'metal');
  }
  for(const x of [-.75,.75]) { box(g,.17,.32,.12,'#d0c9a5',x,.57,.9,'metal');box(g,.21,.45,.06,'#2b4247',x,.54,.855); }
  for(const z of [-.88,.88]) {bar(g,[-.35,.1,z],[.35,.1,z],.055,'#c2c5a9');for(const x of [-.35,.35])bar(g,[x,.1,z],[x,-.07,z],.045,'#c2c5a9');}
  // A bolted spreader plate carries the lifting eye into the lid.
  box(g,.86,.07,.6,'#506463',0,.93,0,'metal');
  for(const x of [-.31,.31]) for(const z of [-.19,.19]) mesh(g,new THREE.CylinderGeometry(.047,.047,.035,6),'#7c8a7c',x,.98,z,0,'metal');
  torus(g,.24,.06,'#bcc2ab',0,1.15,0);box(g,.9,.4,.035,'#d1c8a1',0,-.4,.88);
  for(let i=0;i<6;i++)box(g,.035+(i%2)*.025,.23,.012,'#384849',-.3+i*.11,-.4,.906);
  return batchStatic(g);
}

export const DIVER_EYE = [0, .26, .255];

// Cross-sections describe a fitted suit without introducing a skinned-mesh
// renderer. Each form still belongs to its existing rigid animation joint.
function suitForm(g, sections, color, x = 0, y = 0, z = 0) {
  const curve = new THREE.CatmullRomCurve3(sections.map(([height, width, depth]) => new THREE.Vector3(width, height, depth)));
  const vertices = [], indices = [], rings = sections.length * 4, sides = 20;
  for (let ring = 0; ring <= rings; ring++) {
    const p = curve.getPoint(ring / rings);
    for (let side = 0; side < sides; side++) { const angle = side / sides * Math.PI * 2; vertices.push(Math.max(.001, p.x) * Math.cos(angle), p.y, Math.max(.001, p.z) * Math.sin(angle)); }
  }
  for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
    const a = ring * sides + side, b = ring * sides + (side + 1) % sides;
    indices.push(a, a + sides, b, b, a + sides, b + sides);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setIndex(indices); geo.computeVertexNormals();
  return mesh(g, geo, color, x, y, z, 0, 'rubber');
}
function suitLimb(g, end, upper, lower, color) {
  const direction = new THREE.Vector3(...end), length = direction.length();
  const m = suitForm(g, [[-.035, .001, .001], [0, upper * .85, upper * .85], [length * .22, upper, upper * .92], [length * .65, lower * 1.12, lower], [length, lower, lower * .88], [length + .025, .001, .001]], color);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); return m;
}
function diveFin(g, color) {
  const fin = new THREE.Group();
  const blade = new THREE.Shape(); blade.moveTo(-.075, .13); blade.quadraticCurveTo(-.1, .33, -.15, .57);
  blade.quadraticCurveTo(0, .62, .15, .57); blade.quadraticCurveTo(.1, .33, .075, .13); blade.closePath();
  const geo = new THREE.ExtrudeGeometry(blade, { depth: .018, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 2, steps: 1, curveSegments: 8 });
  geo.rotateX(Math.PI / 2); mesh(fin, geo, color, 0, -.005, 0, 0, 'rubber');
  for (const side of [-1, 1]) tube(fin, [[side * .075, -.002, .14], [side * .095, -.002, .33], [side * .14, -.002, .56]], .012, '#243a3c', 'rubber');
  batchStatic(fin); g.add(fin); return fin;
}

export function diver(index) {
  const g=new THREE.Group(), pose=new THREE.Group(), color=['#ba944f','#538e88','#a66857','#787990'][index];
  pose.name='crew-pose';g.add(pose);
  const torso=new THREE.Group();pose.add(torso);
  suitForm(torso,[[-.16,.02,.02],[-.08,.21,.14],[.1,.22,.145],[.35,.26,.175],[.54,.29,.16],[.63,.2,.12],[.7,.095,.085],[.74,.02,.02]],'#273f45');
  suitForm(torso,[[.02,.08,.07],[.09,.235,.16],[.32,.28,.193],[.5,.285,.177],[.59,.2,.12],[.62,.08,.06]],color,0,0,.005);
  box(torso,.025,.43,.022,'#22373b',0,.32,.204,'rubber');
  for(const side of [-1,1]) {
    tube(torso,[[side*.18,.13,.145],[side*.19,.37,.175],[side*.2,.54,.135],[side*.19,.62,.04],[side*.16,.57,-.19]],.027,'#344b4e','rubber');
    box(torso,.08,.065,.034,'#879790',side*.19,.36,.207,'metal');
    box(torso,.047,.029,.014,'#22373b',side*.19,.36,.229,'rubber');
    box(torso,.105,.16,.04,'#344b4e',side*.16,.16,.17,'rubber');
  }
  const belt=mesh(torso,new THREE.CylinderGeometry(.236,.23,.07,28,1,true),'#22373b',0,.08,0,0,'rubber');belt.scale.z=.72;
  box(torso,.09,.075,.035,'#879790',0,.08,.18,'metal');
  mesh(torso,new THREE.CapsuleGeometry(.14,.43,6,16),'#a5ad98',0,.35,-.3,0,'metal');
  for(const y of [.17,.52]) {
    mesh(torso,new THREE.CylinderGeometry(.149,.149,.065,24,1,true),'#233a3d',0,y,-.3,0,'rubber');
    box(torso,.035,.078,.07,'#879790',.151,y,-.3,'metal');
  }
  bar(torso,[0,.68,-.3],[0,.77,-.3],.038,'#879790');bar(torso,[-.075,.755,-.3],[.075,.755,-.3],.024,'#233a3d','rubber');
  tube(torso,[[0,.69,-.3],[.32,.72,-.13],[.3,.67,.02]],.023,'#222f33','rubber');
  batchStatic(torso);
  const head=new THREE.Group();head.name='crew-head';head.position.set(0,.68,0);pose.add(head);
  suitForm(head,[[.015,.055,.055],[.055,.105,.115],[.15,.145,.157],[.27,.169,.18],[.37,.148,.158],[.43,.075,.08],[.447,.001,.001]],'#3a4c4a',0,0,.006);
  const strap=mesh(head,new THREE.CylinderGeometry(.173,.173,.035,28,1,true),'#172e36',0,.272,.006,0,'rubber');strap.scale.z=1.075;
  const mask=new THREE.Shape();mask.moveTo(-.16,-.055);mask.quadraticCurveTo(-.19,.07,-.12,.083);mask.lineTo(.12,.083);mask.quadraticCurveTo(.19,.07,.16,-.055);mask.lineTo(.052,-.07);mask.quadraticCurveTo(0,-.022,-.052,-.07);mask.closePath();
  mesh(head,new THREE.ExtrudeGeometry(mask,{depth:.065,bevelEnabled:true,bevelThickness:.012,bevelSize:.012,bevelSegments:3,curveSegments:10}),'#172e36',0,.255,.18,0,'rubber');
  for(const side of [-1,1])box(head,.125,.095,.018,'#60868b',side*.078,DIVER_EYE[1],DIVER_EYE[2]+.007,'glass');
  const regulator=mesh(head,new THREE.CylinderGeometry(.061,.064,.055,20),'#85958d',0,.14,.235,0,'metal');regulator.rotation.x=Math.PI/2;
  const mouth=mesh(head,new THREE.CylinderGeometry(.043,.043,.008,16),'#344b4e',0,.14,.268,0,'rubber');mouth.rotation.x=Math.PI/2;
  batchStatic(head);
  for(let i=0;i<6;i++) { const hose=bar(pose,[0,0,0],[0,1,0],.023,'#222f33','rubber');hose.name=`crew-hose-${i}`; }
  for(const side of [-1,1]) {
    const arm=new THREE.Group();arm.name=`arm${side}`;arm.position.set(side*.32,.58,0);pose.add(arm);
    suitLimb(arm,[side*.09,-.35,.04],.112,.078,'#30474b');
    const elbow=new THREE.Group();elbow.name=`elbow${side}`;elbow.position.set(side*.09,-.35,.04);arm.add(elbow);
    suitLimb(elbow,[-side*.01,-.28,.15],.085,.057,color);
    const glove=mesh(elbow,new THREE.SphereGeometry(1,16,10),'#243a3c',-side*.01,-.31,.16,0,'rubber');glove.scale.set(.062,.09,.049);glove.rotation.x=-.35;
    const thumb=mesh(elbow,new THREE.CapsuleGeometry(.024,.06,4,10),'#243a3c',-side*.058,-.285,.18,0,'rubber');thumb.rotation.z=side*.5;batchStatic(elbow);
    const leg=new THREE.Group();leg.name=`leg${side}`;leg.position.set(side*.145,-.05,0);pose.add(leg);
    suitLimb(leg,[0,-.37,-.03],.12,.085,'#233c42');
    const knee=new THREE.Group();knee.name=`knee${side}`;knee.position.set(0,-.37,-.03);leg.add(knee);
    suitLimb(knee,[0,-.33,.05],.086,.058,'#30474b');
    box(knee,.13,.17,.045,'#233c42',0,-.065,.06,'rubber');
    const ankle=new THREE.Group();ankle.name=`ankle${side}`;ankle.position.set(0,-.36,.05);knee.add(ankle);
    // Bake dimensions so the procedural rubber grain stays in metre units.
    const bootGeometry=new THREE.SphereGeometry(1,18,10).scale(.089,.083,.15);
    mesh(ankle,bootGeometry,'#243a3c',0,.025,.065,0,'rubber');
    box(ankle,.18,.032,.275,'#172e36',0,-.032,.075,'rubber');
    const fin=diveFin(ankle,color);fin.name=`fin${side}`;
  }
  return g;
}
