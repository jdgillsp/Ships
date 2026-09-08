import * as THREE from 'three';
import { secondaryTouchActivation } from './TouchActivation.js';
import { ObjectiveMarker } from './ObjectiveMarker.js';
import { seaHeight } from './Simulation.js';
import { objectiveFor } from './Guidance.js';
import { courseTarget } from './VoyageSites.js';
import { deckSightlineBlocked } from './DeckCamera.js';

export class CrewSignals {
  constructor(game) {
    this.game = game;
    this.markers = Array.from({ length: 4 }, (_, i) => new ObjectiveMarker(game.root, `crew-signal-${i}`));
    this.raycaster = new THREE.Raycaster(); this.center = new THREE.Vector2();
    this.deckInverse = new THREE.Matrix4(); this.deckEye = new THREE.Vector3(); this.deckTarget = new THREE.Vector3();
    this.button = document.createElement('button'); this.button.id = 'mark-location'; this.button.textContent = 'Mark view [G]';
    this.button.title = 'Mark a place for the crew. Open the voyage chart with N to save it for another visit.';
    game.root.querySelector('.view-controls').append(this.button); this.button.onclick = () => this.send();
    secondaryTouchActivation(this.button);
    this.notice = document.createElement('p'); this.notice.id = 'crew-signal-note'; this.notice.setAttribute('aria-live', 'polite'); this.notice.hidden = true;
    game.$('crew-list').after(this.notice);
    const chart = game.$('sea-chart'); chart.title = 'Click the chart to mark a location for your crew.';
    chart.addEventListener('click', event => {
      const view = game.chartView; if (!view || game.dialogOpen()) return;
      const rect = chart.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * 280, y = (event.clientY - rect.top) / rect.height * 250;
      this.send({ x: view.center.x - (x - 140) * view.extent / 112, y: 0, z: view.center.z - (y - 125) * view.extent / 112 });
    });
  }
  aimPoint() {
    this.aimObstructed = false;
    const g = this.game, w = g.frameWorld || g.state, p = w?.players[g.net.id]; if (!p) return null;
    this.raycaster.setFromCamera(this.center, g.app.camera); this.raycaster.far = 600;
    const models = g.models;
    const objects = [models.buoy, models.base, models.crate, ...(models.wrecks || [models.wreck]), ...models.crew.filter(o => o.visible)];
    if (p.mode === 'diver') objects.push(models.ship);
    const hit = this.raycaster.intersectObjects(objects, true)[0];
    // The cutter is a useful target for a diver, but aboard it is foreground
    // equipment. Check its actual meshes only when marking, not every frame.
    const blocker = p.mode !== 'diver' ? this.raycaster.intersectObject(models.ship, true)[0] : null;
    const ray = this.raycaster.ray, submerged = g.app.camera.position.y < -.4;
    const height = point => submerged ? g.app.underwater.floor(point.x, point.z) : seaHeight(point.x, point.z, w.time, w.storm);
    const point = new THREE.Vector3(), limit = Math.min(600, hit?.distance ?? 600, blocker?.distance ?? 600);
    let previous = 0;
    while (previous < limit) {
      const t = Math.min(previous + 2, limit);
      ray.at(t, point);
      const below = point.y <= height(point), surface = submerged && point.y >= 0;
      if (below || surface) {
        let lo = previous, hi = t;
        for (let n = 0; n < 8; n++) { const mid = (lo + hi) / 2; ray.at(mid, point); if (surface ? point.y >= 0 : point.y <= height(point)) hi = mid; else lo = mid; }
        ray.at((lo + hi) / 2, point); return { x: point.x, y: point.y, z: point.z };
      }
      previous = t;
    }
    if (blocker && blocker.distance <= (hit?.distance ?? 600)) { this.aimObstructed = true; return null; }
    return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null;
  }
  async send(point = this.aimPoint()) {
    const g = this.game; if (!g.started || g.dialogOpen() || this.pending) return;
    if (!point) { g.message = this.aimObstructed ? 'Deck equipment blocks the view. Move for a clear sightline.' : 'Aim at the buoy, water or seabed, or click the chart to mark a location.'; g.messageUntil = performance.now() + 4500; return; }
    this.pending = true;
    try { await g.net.action('signal', point); g.message = ''; }
    catch (error) { g.message = error.message; g.messageUntil = performance.now() + 4500; }
    finally { this.pending = false; }
  }
  active(w) { return Object.values(w.signals || {}).filter(s => s.expires > w.time).sort((a, b) => b.id - a.id); }
  updateUI(w) {
    const own = w.signals?.[this.game.net.id], wait = own && w.time - own.time < 2;
    this.button.disabled = !this.game.net.ready || !!wait;
    this.button.textContent = wait ? 'Marked for crew' : 'Mark view [G]';
    const latest = this.active(w)[0]; this.notice.hidden = !latest;
    if (latest) this.notice.textContent = `${w.players[latest.owner]?.name || 'Crew'} marked ${latest.label.toLowerCase()} · N to save this place`;
  }
  update(w, visible) {
    const g = this.game, primary = g.objectiveMarker, active = [];
    // One shared pin represents closely grouped callouts, so four crew marking
    // the same buoy do not stack four labels over it.
    for (const s of this.active(w)) if (!active.some(p => Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) < 8)) active.push(s);
    const aboard = w.players[g.net.id]?.mode !== 'diver', quiet = g.root.classList.contains('quiet-play');
    const buddy = g.crewTracking.target(w), objective = buddy || courseTarget(w, g.net.id) || objectiveFor(w, g.net.id, { quiet });
    const covered = !buddy && objective && active.some(p => Math.hypot(p.x - objective.x, p.y - objective.y, p.z - objective.z) < 8);
    if (visible && aboard && quiet) {
      g.models.ship.updateWorldMatrix(true, false);
      this.deckInverse.copy(g.models.ship.matrixWorld).invert();
      this.deckEye.copy(g.app.camera.position).applyMatrix4(this.deckInverse);
    }
    const obscured = target => visible && aboard && quiet && target && target.key !== 'crew' &&
      deckSightlineBlocked(this.deckEye, this.deckTarget.set(target.x, target.y, target.z).applyMatrix4(this.deckInverse), w.cargo.recovered);
    const identifiedBuddy = buddy?.owner && g.crewAwareness?.target === buddy.owner && !g.crewAwareness.button.hidden;
    primary.update(w, g.net.id, g.app.camera, visible && !covered && !identifiedBuddy, objective, obscured(objective));
    const occluders = [...primary.occluders];
    if (visible && objective && !covered && primary.bounds) occluders.push(primary.bounds);
    this.markers.forEach((m, i) => {
      const s = active[i]; m.consoleHeight = primary.consoleHeight; m.occluders = occluders.slice();
      m.update(w, g.net.id, g.app.camera, visible && !!s, s ? { ...s, label: `${w.players[s.owner]?.name || 'Crew'} · ${s.label}` } : null, obscured(s));
      if (visible && s && m.bounds) occluders.push(m.bounds);
    });
  }
}
