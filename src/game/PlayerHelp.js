const key = 'abyssal:learned-controls';
const hints = {
  deck: 'WASD walk · Q/E or drag to look · C changes view · F uses equipment.',
  helm: 'W/S ahead or astern · A/D steer · Q/E looks in first person · C changes view · H leaves the helm.',
  diver: 'WASD swim · Space rises / Ctrl descends · Q/E or drag to look · F interacts.',
  winch: 'The winch lifts while anchored within cable range · Q/E or drag to look · R leaves the winch.'
};
const touchHints = {
  deck: 'Left thumbstick walks · Drag the scene to look · Tap the nearby action to use equipment.',
  helm: 'Thumbstick up/down for ahead/astern, left/right to steer · Drag to look · Activities changes duties.',
  diver: 'Left thumbstick swims · Up/Down changes depth · Drag to look · Tap the nearby action to interact.',
  winch: 'The winch lifts while anchored within cable range · Drag to look · Activities lets you leave the winch.'
};

export class PlayerHelp {
  constructor(game, footer) {
    this.game = game;
    try { this.learned = JSON.parse(localStorage.getItem(key)) || {}; } catch { this.learned = {}; }
    if (typeof this.learned !== 'object' || Array.isArray(this.learned)) this.learned = {};
    this.root = document.createElement('div'); this.root.id = 'first-use-help'; this.root.hidden = true;
    this.copy = document.createElement('span'); this.copy.id = 'first-use-copy';
    const dismiss = document.createElement('button'); dismiss.textContent = 'Got it'; dismiss.onclick = () => this.dismiss();
    this.root.append(this.copy, dismiss); footer.append(this.root);
    this.button = document.createElement('button'); this.button.id = 'play-help'; this.button.textContent = 'Help [?]';
    this.button.setAttribute('aria-controls', this.root.id); this.button.onclick = () => { this.update(game.state); this.manual = this.root.hidden; if (!this.manual) this.dismiss(); else this.update(game.state); };
    footer.append(this.button);
  }
  dismiss() {
    if (this.mode) this.learned[this.mode] = true;
    try { localStorage.setItem(key, JSON.stringify(this.learned)); } catch {}
    this.manual = false; this.root.hidden = true; this.game.hud.wake();
    this.button.setAttribute('aria-expanded', 'false');
  }
  update(w) {
    const g = this.game, p = w?.players[g.net.id]; if (!p) return;
    const position = p.mode === 'deck' ? [p.deckX, p.deckZ, 0] : p.mode === 'diver' ? [p.x, p.z, p.y] : [w.ship.x, w.ship.z, w.cargo.y];
    if (this.mode !== p.mode) { this.mode = p.mode; this.start = position; this.since = performance.now(); this.manual = false; this.practiced = false; }
    const moved = position.every(Number.isFinite) && Math.hypot(...position.map((n, i) => n - this.start[i])) > .7;
    const movementInput = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'ControlRight'].some(key => g.keys.has(key)) || g.touch?.forward || g.touch?.x || g.touch?.depth.size;
    if (moved && (movementInput || this.mode === 'winch')) this.practiced = true;
    if (!this.manual && !this.learned[this.mode] && this.practiced && performance.now() - this.since > 5000) this.dismiss();
    const touch = g.touch?.media.matches;
    this.button.textContent = touch ? 'Help' : 'Help [?]';
    const copy = (touch ? touchHints : hints)[this.mode];
    this.copy.textContent = !touch && g.view !== 'deck' && this.mode !== 'diver' ? copy.replace('Q/E or drag to look', 'Drag to look') : copy;
    this.root.hidden = !g.started || g.lookout || g.naturalist.open || (!this.manual && !!this.learned[this.mode]);
    // Modal dialogs make the HUD inert; preserve its geometry through dismissal.
    this.button.hidden = !g.started;
    this.button.setAttribute('aria-expanded', String(!this.root.hidden));
  }
}
