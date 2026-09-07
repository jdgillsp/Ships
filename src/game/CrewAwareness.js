import * as THREE from 'three';
import { sightlineClear } from '../underwater/FieldNotes.js';

export class CrewAwareness {
  constructor(game) {
    this.game = game; this.lastUpdate = -Infinity; this.target = null; this.since = 0;
    this.point = new THREE.Vector3(); this.projected = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.ray = new THREE.Raycaster();
    this.button = document.createElement('button'); this.button.id = 'crew-in-view'; this.button.hidden = true;
    this.button.innerHTML = '<span class="crew-in-view-name"></span><span class="crew-in-view-role"></span><span class="crew-in-view-action">Show position</span>';
    game.root.append(this.button);
    window.addEventListener('resize', () => { this.clear(); this.lastUpdate = -Infinity; });
    this.button.onclick = () => {
      const peer = game.state?.players[this.target]; if (!peer?.connected) return;
      game.crewTracking.id = game.crewTracking.id === peer.id ? '' : peer.id;
      game.crewTracking.updateUI(game.state); this.label(peer);
    };
  }
  clear() { this.target = null; this.since = 0; this.button.hidden = true; }
  label(peer) {
    const tracking = this.game.crewTracking.id === peer.id;
    const role = peer.mode === 'diver' ? (peer.surveying ? 'Surveying' : 'Diving') : { deck: 'On deck', helm: 'At the helm', winch: 'At the winch' }[peer.mode] || 'Aboard';
    this.button.querySelector('.crew-in-view-name').textContent = peer.name;
    this.button.querySelector('.crew-in-view-role').textContent = role;
    this.button.querySelector('.crew-in-view-action').textContent = tracking ? 'Stop tracking' : 'Show position';
    this.button.setAttribute('aria-label', `${tracking ? 'Stop tracking' : 'Show position of'} ${peer.name}, ${role.toLowerCase()}`);
    this.button.setAttribute('aria-pressed', String(tracking));
  }
  update(world, now) {
    const g = this.game;
    if (!g.started || !g.net.ready || g.dialogOpen() || document.hidden || g.lookout || g.naturalist.open || !g.root.classList.contains('quiet-play')) { this.clear(); return; }
    if (now - this.lastUpdate < 120) return;
    this.lastUpdate = now;
    const camera = g.app.camera, peers = Object.values(world.players), candidates = [];
    const blockers = [g.models.ship, g.models.base, g.models.crate, g.models.wreck];
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i], model = g.models.crew[i];
      if (peer.id === g.net.id || !peer.connected || !model?.visible) continue;
      // Use the posed head rather than the network's unpitched deck position.
      const head = g.models.crewRigs[i].head; head.updateWorldMatrix(true, false);
      this.point.set(0, .22, 0).applyMatrix4(head.matrixWorld);
      const distance = this.point.distanceTo(camera.position);
      if (distance < .8 || distance > 14) continue;
      this.projected.copy(this.point).project(camera);
      const score = Math.hypot(this.projected.x, this.projected.y);
      if (this.projected.z < -1 || this.projected.z > 1 || score > .24) continue;
      this.direction.copy(this.point).sub(camera.position).normalize(); this.ray.set(camera.position, this.direction); this.ray.far = distance - .25;
      // A crewmate in the narrow passage can hide another just as the cabin
      // does. Keep the label attached to the person the player can see.
      const crewBlockers = g.models.crew.filter((model, index) => index !== i && model.visible && peers[index]?.connected && peers[index].id !== g.net.id);
      if (this.ray.intersectObjects(crewBlockers, true).length) continue;
      if (this.ray.intersectObjects(blockers, true).length) continue;
      if (sightlineClear(camera.position, this.point, (x, z) => g.app.underwater.floor(x, z), g.app.underwater.fauna.motion.rocks.rocks)) candidates.push({ peer, score, x: this.projected.x, y: this.projected.y });
    }
    candidates.sort((a, b) => a.score - b.score);
    const candidate = candidates[0];
    if (!candidate) { this.clear(); return; }
    if (this.target !== candidate.peer.id) { this.target = candidate.peer.id; this.since = now; this.button.hidden = true; }
    if (now - this.since < 300) return;
    const x = (candidate.x + 1) * innerWidth / 2, y = (1 - candidate.y) * innerHeight / 2 + 36;
    const footer = g.root.querySelector('.ship-console').getBoundingClientRect();
    if (y + 70 > footer.top || x < 110 || x > innerWidth - 110) { this.button.hidden = true; return; }
    this.button.style.left = `${x}px`; this.button.style.top = `${y}px`;
    this.label(candidate.peer); this.button.hidden = false;
  }
}
