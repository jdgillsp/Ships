import * as THREE from 'three';
import { objectiveFor, objectiveDistance } from './Guidance.js';

export class ObjectiveMarker {
  constructor(root, id = 'objective-marker') {
    this.element = document.createElement('div'); this.element.id = id; this.element.className = `world-marker${id === 'objective-marker' ? '' : ' crew-signal'}`; this.element.hidden = true;
    this.element.innerHTML = '<span class="objective-symbol">◇</span><span class="objective-label"></span><span class="objective-distance"></span>';
    root.append(this.element);
    this.symbol = this.element.querySelector('.objective-symbol'); this.label = this.element.querySelector('.objective-label'); this.distance = this.element.querySelector('.objective-distance');
    this.point = new THREE.Vector3(); this.local = new THREE.Vector3(); this.consoleHeight = 240; this.occluders = [];
  }
  update(world, id, camera, visible, target = objectiveFor(world, id), obscured = false) {
    this.bounds = null;
    this.element.hidden = !visible || !target;
    if (!visible || !target) { this.detailTarget = null; this.detailVisible = false; return; }
    this.point.set(target.x, target.y, target.z);
    const metres = Number.isFinite(target.distance) ? target.distance : objectiveDistance(world, id, target);
    this.local.copy(this.point).applyMatrix4(camera.matrixWorldInverse);
    const tan = Math.tan(camera.fov * Math.PI / 360), depth = Math.max(.1, Math.abs(this.local.z));
    // At the signal itself there is no useful bearing. Tiny eye-position
    // differences must not flip a completed arrival into a "behind you" arrow.
    const nearEye = this.local.length() < 1;
    let dx = nearEye ? 0 : this.local.x / (depth * tan * camera.aspect), dy = nearEye ? 0 : -this.local.y / (depth * tan);
    const behind = !nearEye && this.local.z >= 0;
    const detailTarget = `${target.key || 'signal'}:${target.id ?? target.owner ?? target.label}`;
    const retaining = this.detailTarget === detailTarget && this.detailVisible;
    // Once read, a label needs a little clearance before hiding; ship motion
    // and small aiming corrections should not flash its text at the boundary.
    this.detailVisible = metres < (retaining ? 22 : 20) || (!behind && Math.abs(dx) < (retaining ? .28 : .22) && Math.abs(dy) < (retaining ? .31 : .25));
    this.detailTarget = detailTarget;
    this.element.classList.toggle('marker-detail', this.detailVisible);
    if (behind && Math.abs(dx) < .05) dx = .05;
    const width = innerWidth, height = innerHeight;
    const left = Math.min(100, width * .22), right = width - left;
    const top = 140, bottom = Math.max(top + 60, height - this.consoleHeight - 85);
    let x = width * (.5 + dx * .5), y = height * (.5 + dy * .5);
    let offscreen = behind || x < left || x > right || y < top || y > bottom;
    if (offscreen) {
      // Intersect a ray with the safe viewport rectangle. Projecting a target
      // behind the camera directly would reverse the direction arrow.
      const cx = width / 2, cy = (top + bottom) / 2;
      if (behind) { dx *= width; dy *= height; }
      else { dx = x - cx; dy = y - cy; }
      const scale = Math.min((right - cx) / Math.max(.001, Math.abs(dx)), (bottom - cy) / Math.max(.001, Math.abs(dy)));
      x = cx + dx * scale; y = cy + dy * scale;
    }
    const clear = (x, y) => !this.occluders.some(r => x + 90 > r.left && x - 90 < r.right && y + 40 > r.top && y - 40 < r.bottom);
    if (!clear(x, y)) {
      // A narrow screen can require moving along both axes to clear the chart
      // and mission panel. Testing one edge at a time misses that free corner.
      const xs = [x, left, right, ...this.occluders.flatMap(r => [r.left - 100, r.right + 100])];
      const ys = [y, top, bottom, ...this.occluders.flatMap(r => [r.bottom + 50, r.top - 50])];
      const candidates = xs.flatMap(cx => ys.map(cy => [cx, cy]))
        .filter(([cx, cy]) => cx >= left && cx <= right && cy >= top && cy <= bottom && clear(cx, cy))
        .sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
      if (candidates.length) { const [cx, cy] = candidates[0]; dx = x - cx; dy = y - cy; x = cx; y = cy; offscreen = true; }
    }
    this.element.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
    // Edge arrows remain useful bearings even when the target lies behind the
    // cabin. Only a pin projected onto the obstructing equipment fades away.
    const hiddenByDeck = !!obscured && !offscreen;
    this.element.classList.toggle('marker-obscured', hiddenByDeck);
    this.element.setAttribute('aria-hidden', String(hiddenByDeck));
    if (!hiddenByDeck) this.bounds = { left: x - 90, right: x + 90, top: y - 40, bottom: y + 40 };
    this.element.classList.toggle('offscreen', offscreen);
    this.element.classList.toggle('crew-location', target.key === 'crew');
    this.element.classList.toggle('course-location', target.key === 'course');
    this.symbol.textContent = offscreen ? '➤' : '◇';
    this.symbol.style.transform = offscreen ? `rotate(${Math.atan2(dy, dx)}rad)` : '';
    this.label.textContent = target.label;
    this.distance.textContent = `${Math.round(metres)} m${target.detail ? ` · ${target.detail}` : ''}${behind ? ' · behind you' : ''}`;
  }
}
