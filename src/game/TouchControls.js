export function thumbAxes(dx, dy, radius) {
  const distance = Math.hypot(dx, dy), magnitude = Math.min(1, distance / radius);
  const strength = Math.max(0, (magnitude - .14) / .86), scale = distance ? strength / distance : 0;
  const visual = distance ? Math.min(distance, radius) / distance : 0;
  return { x: dx * scale, forward: -dy * scale, px: dx * visual, py: dy * visual };
}

export class TouchControls {
  constructor(game) {
    this.game = game; this.x = this.forward = 0; this.pointer = null; this.depth = new Map();
    this.media = matchMedia('(pointer:coarse)');
    this.root = document.createElement('div'); this.root.className = 'touch-controls'; this.root.hidden = true;
    this.root.innerHTML = '<div class="touch-movement"><div id="touch-stick" role="group" tabindex="0" aria-label="Movement thumbstick" aria-describedby="touch-stick-help"><span class="touch-stick-knob"></span></div><span id="touch-stick-label">Move</span></div><p id="touch-stick-help">Drag to move · drag the water to look</p><div class="touch-depth" aria-label="Swimming depth"><button data-depth="1" aria-label="Ascend">↑ Up</button><button data-depth="-1" aria-label="Descend">↓ Down</button></div>';
    game.root.append(this.root); this.pad = this.root.querySelector('#touch-stick'); this.knob = this.root.querySelector('.touch-stick-knob');
    this.pad.onpointerdown = e => {
      if (!this.available() || this.pointer !== null || e.button !== 0) return;
      const rect = this.pad.getBoundingClientRect();
      this.origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: (rect.width - 44) / 2 };
      this.pointer = e.pointerId; this.pad.setPointerCapture(e.pointerId); this.move(e); e.preventDefault();
    };
    this.pad.onpointermove = e => { if (this.pointer === e.pointerId) { this.move(e); e.preventDefault(); } };
    const release = e => { if (this.pointer === e.pointerId) this.resetStick(); };
    this.pad.onpointerup = this.pad.onpointercancel = this.pad.onlostpointercapture = release;
    for (const button of this.root.querySelectorAll('[data-depth]')) {
      button.onpointerdown = e => {
        if (!this.available() || this.mode !== 'diver' || e.button !== 0) return;
        button.setPointerCapture(e.pointerId); this.depth.set(e.pointerId, { value: Number(button.dataset.depth), button }); e.preventDefault();
      };
      button.onpointerup = button.onpointercancel = button.onlostpointercapture = e => { this.depth.delete(e.pointerId); this.place(); };
      // Keyboard activation remains available without turning a click into a
      // latched swimming command; Space/Ctrl remain the depth shortcuts.
      button.onkeydown = e => { if (['Space', 'Enter'].includes(e.code) && this.available() && this.mode === 'diver') { this.depth.set('keyboard', { value: Number(button.dataset.depth), button }); e.preventDefault(); } };
      button.onkeyup = e => { if (['Space', 'Enter'].includes(e.code)) { this.depth.delete('keyboard'); this.place(); } };
      button.onblur = () => { this.depth.delete('keyboard'); this.place(); };
    }
    const consoleElement = game.root.querySelector('.ship-console');
    const place = this.place = () => {
      // Status copy may change the footer's height while steering. Keep the
      // controls under the fingers until every held gesture has finished.
      if (this.pointer !== null || this.depth.size) return;
      this.root.style.bottom = `${Math.max(16, innerHeight - consoleElement.getBoundingClientRect().top + 12)}px`;
    };
    this.resize = new ResizeObserver(place); this.resize.observe(consoleElement);
    window.addEventListener('resize', () => { this.reset(); place(); });
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    this.media.addEventListener('change', () => this.reset());
    // A dialog can open while a thumb still owns pointer capture. Cancel it
    // immediately instead of allowing the old drag to resume after Close.
    this.dialogs = new MutationObserver(() => { if (game.dialogOpen()) { this.reset(); game.cancelCameraDrag(); } });
    this.dialogs.observe(game.root, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }
  available() {
    const g = this.game;
    return this.media.matches && g.started && g.net.ready && !g.dialogOpen() && !document.hidden && ['deck', 'helm', 'diver'].includes(g.lastMode);
  }
  move(e) {
    if (!this.available()) { this.reset(); return; }
    const axes = thumbAxes(e.clientX - this.origin.x, e.clientY - this.origin.y, this.origin.radius);
    this.x = axes.x; this.forward = axes.forward; this.knob.style.transform = `translate(${axes.px}px,${axes.py}px)`;
    this.pad.classList.toggle('active', !!(this.x || this.forward));
  }
  resetStick() {
    const pointer = this.pointer; this.pointer = null; this.x = this.forward = 0;
    this.knob.style.transform = ''; this.pad.classList.remove('active');
    if (pointer !== null && this.pad.hasPointerCapture(pointer)) this.pad.releasePointerCapture(pointer);
    this.place?.();
  }
  reset() {
    if (this.pointer === null && !this.x && !this.forward && !this.depth.size) return;
    this.resetStick(); const held = [...this.depth]; this.depth.clear();
    for (const [pointer, { button }] of held) if (typeof pointer === 'number' && button.hasPointerCapture(pointer)) button.releasePointerCapture(pointer);
    this.place();
  }
  update(mode) {
    if (mode !== this.mode) {
      this.reset(); this.mode = mode;
      const label = mode === 'helm' ? 'Throttle · steer' : mode === 'diver' ? 'Swim' : 'Move';
      this.root.querySelector('#touch-stick-label').textContent = label;
      this.pad.setAttribute('aria-label', `${label} thumbstick`);
      this.root.querySelector('.touch-depth').hidden = mode !== 'diver';
      this.root.querySelector('#touch-stick-help').textContent = mode === 'helm' ? 'Up / down: throttle · left / right: steer' : 'Drag water to look';
    }
    const available = this.available(); if (this.root.hidden === available) this.root.hidden = !available;
    if (!available) this.reset();
  }
  get vertical() { return Math.max(-1, Math.min(1, [...this.depth.values()].reduce((sum, held) => sum + held.value, 0))); }
}
