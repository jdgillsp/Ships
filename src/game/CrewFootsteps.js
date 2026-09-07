const stride = .85;

// Measure walking in deck coordinates: riding a moving cutter is not a step.
// Each listener derives cues from shared poses, without extra network events.
export class CrewFootsteps {
  constructor() { this.states = new Map(); }
  reset() { this.states.clear(); }
  update(world, listenerId, right) {
    const listener = world.players[listenerId], cues = [];
    for (const id of this.states.keys()) if (!world.players[id]?.connected) this.states.delete(id);
    for (const p of Object.values(world.players)) {
      if (!p.connected || p.mode !== 'deck') { this.states.delete(p.id); continue; }
      const previous = this.states.get(p.id), state = { x: p.deckX, z: p.deckZ, time: world.time, walked: previous?.walked ?? 0 };
      this.states.set(p.id, state);
      if (!previous) continue;
      const dt = world.time - previous.time, moved = Math.hypot(state.x - previous.x, state.z - previous.z);
      if (dt === 0) continue;
      if (dt < 0 || dt > 1 || !Number.isFinite(moved) || moved > dt * 6) { state.walked = 0; continue; }
      state.walked += moved;
      if (state.walked < stride) continue;
      state.walked %= stride;
      if (!listener?.connected || listener.mode === 'diver') continue;
      const dx = p.x - listener.x, dz = p.z - listener.z, range = Math.hypot(dx, dz);
      if (range > 12) continue;
      const own = p.id === listenerId;
      cues.push({ id: p.id, strength: own ? .07 : .07 / (1 + (range / 3) ** 2),
        pan: own ? 0 : Math.max(-.85, Math.min(.85, (dx * right.x + dz * right.z) / Math.max(1, range))) });
    }
    return cues;
  }
}
