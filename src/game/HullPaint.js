export const HULL_PAINTS = Object.freeze({ teal: { name: 'Harbor teal', color: '#34545b' }, blue: { name: 'Ocean blue', color: '#304d78' }, red: { name: 'Oxide red', color: '#814b40' } });
export function paintReason(w, id) {
  const p = w.players[id], base = w.locations?.base || { x: -140, z: 440 };
  if (!p?.connected || p.mode === 'diver') return 'Come aboard to choose Kestrel’s hull paint.';
  return Math.hypot(w.ship.x - base.x, w.ship.z - base.z) >= 24 || Math.abs(w.ship.speed) >= 1.5 || !w.ship.anchor ? 'Anchor beside Pelican Station to change the hull paint.' : '';
}
export function paintHull(w, id, paint) {
  const reason = paintReason(w, id);
  if (reason || !Object.hasOwn(HULL_PAINTS, paint)) return { ok: false, message: reason || 'Choose a hull paint from the harbor palette.' };
  w.ship.paint = paint; w.log = `${w.players[id].name} chose ${HULL_PAINTS[paint].name.toLowerCase()} for Kestrel’s hull.`; w.revision++;
  return { ok: true };
}
export class HullPaintControls {
  constructor(game, activities) {
    this.game = game; this.root = document.createElement('section'); this.root.id = 'hull-paint';
    this.root.innerHTML = '<h3>Kestrel’s hull paint</h3><p>A harbor change for the whole crew, kept with your ship.</p><label for="hull-paint-choice">Hull color</label><select id="hull-paint-choice"></select><button id="apply-hull-paint">Apply hull paint</button><p id="hull-paint-status" role="status"></p>';
    activities.$('activities-crew').before(this.root); this.select = this.root.querySelector('select'); this.button = this.root.querySelector('button'); this.status = this.root.querySelector('[role=status]');
    this.select.replaceChildren(...Object.entries(HULL_PAINTS).map(([id, paint]) => new Option(paint.name, id)));
    this.button.onclick = async () => {
      if (this.pending) return; this.pending = true; this.error = ''; this.update(game.state);
      try { await game.net.action('paintHull', { paint: this.select.value }); }
      catch (e) { this.error = e.message; }
      finally { this.pending = false; this.update(game.state); }
    };
  }
  update(w) {
    const base = w.locations?.base || { x: -140, z: 440 };
    this.root.hidden = Math.hypot(w.ship.x - base.x, w.ship.z - base.z) >= 24;
    const current = w.ship.paint || 'teal';
    if (this.current !== current) { this.current = current; this.select.value = current; }
    const reason = paintReason(w, this.game.net.id);
    this.select.disabled = !!this.pending; this.button.disabled = !!this.pending || !this.game.net.ready || !!reason;
    this.status.textContent = this.error || reason || `Current paint: ${HULL_PAINTS[current].name}.`;
  }
}
