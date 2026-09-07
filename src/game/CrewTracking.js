export function crewTarget(world, selfId, selectedId) {
  if (selectedId === 'ship' && world.players[selfId]) {
    const p = world.players[selfId], s = world.ship;
    return { key: 'crew', label: 'Kestrel', x: s.x, y: 1, z: s.z, distance: Math.hypot(p.x - s.x, p.y, p.z - s.z), detail: 'Return aboard' };
  }
  const self = world.players[selfId], peer = world.players[selectedId];
  if (!self || !peer?.connected || selectedId === selfId) return null;
  if (![self.x, self.y, self.z, peer.x, peer.y, peer.z].every(Number.isFinite)) return null;
  return { key: 'crew', owner: selectedId, label: peer.name, x: peer.x, y: peer.y + .7, z: peer.z,
    distance: Math.hypot(peer.x - self.x, peer.y - self.y, peer.z - self.z),
    detail: peer.mode === 'diver' ? `${Math.max(0, -peer.y).toFixed(0)} m deep` : ({ deck: 'On deck', helm: 'At helm', winch: 'At winch' }[peer.mode] || 'Aboard') };
}

export class CrewTracking {
  constructor(game) {
    this.game = game; this.id = ''; this.signature = '';
    this.root = document.createElement('div'); this.root.id = 'crew-tracking'; this.root.hidden = true;
    const label = document.createElement('label'); this.label = label; label.htmlFor = 'track-crewmate'; label.textContent = 'Find crewmate';
    this.select = document.createElement('select'); this.select.id = 'track-crewmate';
    this.root.append(label, this.select); game.$('crew-list').before(this.root);
    this.select.onfocus = () => { game.keys.clear(); game.net.input({}); };
    this.select.onchange = () => { this.id = this.select.value; this.select.blur(); this.updateUI(game.state); };
  }
  target(world) { return crewTarget(world, this.game.net.id, this.id); }
  updateUI(world) {
    const peers = Object.values(world.players).filter(p => p.id !== this.game.net.id);
    if (this.id === 'ship' ? !world.course : !peers.some(p => p.id === this.id)) this.id = '';
    this.root.hidden = peers.length === 0 && !world.course;
    this.label.textContent = world.course ? 'Navigation focus' : 'Find crewmate';
    // Do not rebuild a focused native selector on every depth/role update.
    const signature = JSON.stringify([!!world.course, peers.map(p => [p.id, p.name, p.connected])]);
    if (signature !== this.signature) {
      const options = [new Option(world.course ? 'Course guidance' : 'Mission guidance', '')];
      if (world.course) options.push(new Option('Kestrel · return aboard', 'ship'));
      for (const p of peers) { const option = new Option(`${p.name}${p.connected ? '' : ' · reconnecting'}`, p.id); option.disabled = !p.connected; options.push(option); }
      this.select.replaceChildren(...options); this.signature = signature;
    }
    this.select.value = this.id;
    this.game.root.classList.toggle('tracking-crew', !!this.target(world));
  }
}
