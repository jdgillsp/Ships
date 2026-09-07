import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { smooth } from '../underwater/OceanDomain.js';
import { collectWildlife } from '../underwater/WildlifeSamples.js';
import { FIELD_NOTES, projectWildlife, sightlineClear, wildlifeState, readJournal, recordObservation } from '../underwater/FieldNotes.js';
import { photograph, readPhoto, savePhoto, appendPhoto } from '../underwater/JournalPhotos.js';
import { secondaryTouchActivation } from './TouchActivation.js';

export class StudyHold {
  constructor() { this.reset(); }
  reset() { this.id = null; this.elapsed = 0; this.last = null; }
  update(id, now) {
    if (!id) { this.reset(); return 0; }
    const dt = this.last === null ? 0 : now - this.last;
    if (id !== this.id || dt > 1500 || dt < 0) this.elapsed = 0;
    else this.elapsed += Math.min(dt, 400);
    this.id = id; this.last = now;
    return Math.min(1, this.elapsed / 1200);
  }
}

export class ObservationLens {
  constructor() { this.reset(); }
  reset() { this.target = this.value = 1; }
  set(value) { if (Number.isFinite(value)) this.target = Math.max(1, Math.min(3, value)); }
  update(dt) {
    this.value += (this.target - this.value) * (1 - Math.exp(-Math.max(0, dt) * 14));
    if (Math.abs(this.value - this.target) < .001) this.value = this.target;
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(68) / 2) / this.value));
  }
}

export class CrewNaturalist {
  constructor(game) {
    this.game = game; this.open = false; this.hold = new StudyHold(); this.lastUpdate = 0;
    this.lens = new ObservationLens();
    this.forward = new THREE.Vector3(); this.right = new THREE.Vector3(); this.up = new THREE.Vector3();
    this.ray = new THREE.Raycaster(); this.point = new THREE.Vector3();
    try { this.storage = localStorage; } catch { this.storage = null; }
    this.entries = readJournal(this.storage);
    this.photos = new Map(); this.pendingPhoto = null; this.capturePhoto = null; this.photoAt = -Infinity;
    const afterRender = game.app.afterRender;
    game.app.afterRender = () => { afterRender?.(); this.finishPhoto(); };
    this.button = document.createElement('button'); this.button.id = 'observe-wildlife'; this.button.hidden = true;
    this.button.textContent = 'Observe [O]'; this.button.setAttribute('aria-expanded', 'false'); this.button.setAttribute('aria-controls', 'crew-naturalist');
    this.button.title = 'Keep an animal in view to record it. Click another animal to select it; J opens your journal.';
    game.$('binoculars').after(this.button); this.button.onclick = () => this.toggle();
    this.panel = document.createElement('aside'); this.panel.id = 'crew-naturalist'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Wildlife observation');
    this.panel.innerHTML = `<div class="naturalist-heading"><span class="eyebrow">KESTREL / FIELD STUDY</span><button id="close-naturalist" aria-label="Close observation">×</button></div>
      <h2 id="study-name">Look into the water</h2><p id="study-status"></p>
      <progress id="study-progress" max="1" value="0" aria-label="Observation progress"></progress>
      <div class="study-optics"><span>Lens</span><button id="study-zoom-out" aria-label="Zoom out">−</button><button id="study-zoom-reset" aria-label="Reset observation zoom">1.0×</button><button id="study-zoom-in" aria-label="Zoom in">+</button><small>Scroll to zoom</small></div>
      <div class="naturalist-foot"><button id="photograph-wildlife" aria-keyshortcuts="P" disabled>Photograph</button><button id="open-crew-journal">Field journal [J]</button></div><p id="photo-status" role="status"></p>
      <button id="toggle-study-notes" aria-expanded="false" aria-controls="study-notes">Field notes</button><div id="study-notes" hidden><p id="study-note"></p><span id="study-record"></span></div>`;
    game.root.append(this.panel);
    this.$ = id => this.panel.querySelector(`#${id}`);
    this.$('close-naturalist').onclick = () => { this.toggle(false); this.button.focus(); };
    this.$('open-crew-journal').onclick = () => this.showJournal();
    this.$('photograph-wildlife').onclick = () => this.requestPhoto();
    this.$('toggle-study-notes').onclick = () => {
      const notes = this.$('study-notes'); notes.hidden = !notes.hidden;
      this.$('toggle-study-notes').setAttribute('aria-expanded', String(!notes.hidden));
    };
    this.$('study-zoom-in').onclick = () => this.zoomBy(.5);
    this.$('study-zoom-out').onclick = () => this.zoomBy(-.5);
    this.$('study-zoom-reset').onclick = () => this.zoomBy(1 - this.lens.target);
    for (const button of [this.button, ...this.panel.querySelectorAll('button')]) secondaryTouchActivation(button);
    this.marker = document.createElement('div'); this.marker.id = 'study-marker'; this.marker.hidden = true; this.marker.setAttribute('aria-hidden', 'true'); game.root.append(this.marker);
    this.journal = document.createElement('dialog'); this.journal.id = 'crew-journal'; this.journal.setAttribute('aria-labelledby', 'crew-journal-title');
    this.journal.innerHTML = '<header class="journal-heading"><div class="naturalist-heading"><div><p class="journal-eyebrow">KESTREL / NATURALIST NOTES</p><h2 id="crew-journal-title">Field journal</h2></div><button id="close-crew-journal">Close</button></div><label class="journal-jump" for="journal-sighting" hidden>Jump to<select id="journal-sighting"></select></label></header><p id="crew-journal-intro"></p><div id="crew-journal-entries"></div><p class="journal-footer">Your sightings and photographs stay in this browser, including in free exploration. Save a photo to keep a copy.</p>';
    game.root.append(this.journal); this.journal.querySelector('#close-crew-journal').onclick = () => this.journal.close();
    this.journalSelect = this.journal.querySelector('#journal-sighting');
    this.journalSelect.onchange = () => {
      const entry = this.journal.querySelector(`#journal-entry-${this.journalSelect.value}`);
      if (!entry) return;
      // Measure the header after responsive layout so a jump never leaves the
      // chosen notes underneath the sticky controls.
      this.journal.style.scrollPaddingTop = `${this.journal.querySelector('.journal-heading').offsetHeight + 12}px`;
      entry.focus({ preventScroll: true }); entry.scrollIntoView({ block: 'start' });
    };
    const journalButton = document.createElement('button'); journalButton.id = 'delivery-journal'; journalButton.textContent = 'View field journal';
    journalButton.onclick = () => { game.delivery.close(); this.showJournal(); }; game.$('continue-sailing').after(journalButton);
    game.app.canvas.addEventListener('pointerdown', e => { this.pointerDown = this.open && e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
    game.app.canvas.addEventListener('pointerup', e => {
      const down = this.pointerDown; this.pointerDown = null;
      if (!this.open || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = game.app.canvas.getBoundingClientRect();
      this.aim = { x: (e.clientX - r.left) / r.width * 2 - 1, y: 1 - (e.clientY - r.top) / r.height * 2 };
      this.hold.reset();
    });
  }
  toggle(on = !this.open) {
    const g = this.game;
    on = !!on && g.started && g.state?.players[g.net.id]?.mode === 'diver' && !g.dialogOpen() && g.$('mission-complete').hidden;
    this.open = on; this.panel.hidden = !on; this.marker.hidden = true; this.hold.reset(); this.aim = null;
    this.lens.reset();
    this.$('study-notes').hidden = true;
    this.$('toggle-study-notes').setAttribute('aria-expanded', 'false');
    this.pendingPhoto = this.capturePhoto = null; this.$('photo-status').textContent = '';
    this.$('photograph-wildlife').disabled = true;
    g.root.classList.toggle('studying-wildlife', on); this.button.setAttribute('aria-expanded', String(on));
    this.button.textContent = on ? 'End study [O]' : 'Observe [O]';
  }
  updateUI(world) {
    const diver = world.players[this.game.net.id]?.mode === 'diver';
    this.button.hidden = !diver; this.game.$('binoculars').hidden = diver;
    if (this.open && (!diver || !this.game.$('mission-complete').hidden)) this.toggle(false);
  }
  zoomBy(amount) {
    if (this.open && !this.game.dialogOpen()) this.lens.set(this.lens.target + amount);
  }
  update(now) {
    if (!this.open) return;
    const g = this.game;
    if (g.dialogOpen() || document.hidden || !g.net.ready) { this.hold.reset(); this.marker.hidden = true; this.pendingPhoto = this.capturePhoto = null; this.$('photograph-wildlife').disabled = true; return; }
    if (now - this.lastUpdate < 140) return;
    this.lastUpdate = now;
    this.$('study-zoom-reset').textContent = `${this.lens.value.toFixed(1)}×`;
    this.$('study-zoom-out').disabled = this.lens.target <= 1;
    this.$('study-zoom-in').disabled = this.lens.target >= 3;
    const world = g.app.underwater, camera = g.app.camera, p = camera.position;
    camera.getWorldDirection(this.forward); this.right.crossVectors(this.forward, camera.up).normalize(); this.up.crossVectors(this.right, this.forward).normalize();
    const view = { x: p.x, y: p.y, z: p.z, fx: this.forward.x, fy: this.forward.y, fz: this.forward.z,
      rx: this.right.x, ry: this.right.y, rz: this.right.z, ux: this.up.x, uy: this.up.y, uz: this.up.z,
      tan: Math.tan(camera.fov * Math.PI / 360), aspect: camera.aspect, range: Math.min(95, 55 * world.settings.clarity),
      daylight: (1 - U.uDiveNight.value) * (1 - smooth(90, 220, -p.y)), lamp: U.uLamp.value, glow: world.settings.glow };
    const panels = [...g.root.querySelectorAll('#crew-naturalist,.nav-panel,.ship-console,.game-top,#touch-stick,.touch-depth')]
      .filter(e => !e.hidden && getComputedStyle(e).visibility !== 'hidden').map(e => e.getBoundingClientRect());
    const aim = this.aim;
    const projected = collectWildlife(world).map(s => projectWildlife(s, view, aim || undefined)).filter(c => c && FIELD_NOTES[c.sample.type]).sort((a, b) => a.score - b.score);
    const visible = c => {
      const x = (c.x + 1) * innerWidth / 2, y = (1 - c.y) * innerHeight / 2;
      if (panels.some(r => x > r.left && x < r.right && y > r.top && y < r.bottom)) return false;
      if (!sightlineClear(view, c.sample, (x, z) => world.floor(x, z), world.fauna.motion.rocks.rocks)) return false;
      // Expedition equipment can hide an animal even when the terrain ray is clear.
      this.point.set(c.sample.x, c.sample.y, c.sample.z).sub(p).normalize(); this.ray.set(p, this.point); this.ray.far = Math.max(0, c.distance - .2);
      return !this.ray.intersectObjects([g.models.ship, g.models.wreck, g.models.crate, g.models.base], true).length;
    };
    const candidate = projected.find(c => c.sample.id === this.hold.id && visible(c)) || projected.slice(0, 40).find(c =>
      (aim ? Math.hypot(c.x - aim.x, c.y - aim.y) < Math.max(.07, c.apparent * .5) : Math.hypot(c.x, c.y) < .7) && visible(c));
    this.aim = null;
    this.candidate = candidate || null;
    this.marker.hidden = !candidate;
    const progress = this.hold.update(candidate?.sample.id, now); this.$('study-progress').value = progress;
    this.$('photograph-wildlife').disabled = !candidate || progress < 1 || now - this.photoAt < 800;
    this.$('photograph-wildlife').textContent = candidate && this.photoFor(candidate.sample.type) ? 'Retake photo' : 'Photograph';
    this.$('photograph-wildlife').title = progress < 1 ? 'Keep an animal in view until it is identified.' : 'Press P or click to save this view in your field journal. Photograph again to replace it.';
    if (this.pendingPhoto) {
      if (candidate?.sample.id === this.pendingPhoto.id && progress === 1) this.capturePhoto = { type: candidate.sample.type, candidate };
      else this.$('photo-status').textContent = 'The animal left view. Aim at it again to photograph it.';
      this.pendingPhoto = null;
    }
    if (!candidate) {
      this.$('study-name').textContent = 'Look into the water'; this.$('study-status').textContent = 'Look toward an animal, or click one to study it.';
      this.$('study-note').textContent = 'Swim nearer the reef or seabed, then slow down and look around. O or Esc returns to mission guidance.';
      this.$('study-record').textContent = `${this.entries.length} groups recorded`; return;
    }
    const s = candidate.sample, [name, group, note] = FIELD_NOTES[s.type];
    this.marker.style.left = `${(candidate.x + 1) * 50}%`; this.marker.style.top = `${(1 - candidate.y) * 50}%`;
    this.$('study-name').textContent = name; this.$('study-status').textContent = `${wildlifeState(s)} · ${candidate.distance.toFixed(1)} m away`;
    this.$('study-note').textContent = note;
    if (progress === 1) recordObservation(this.entries, s, world.seed, Math.max(0, -s.y), this.storage);
    const recorded = this.entries.some(e => e.type === s.type);
    this.$('study-record').textContent = `${group} · ${recorded ? 'Recorded' : 'Observing…'}`;
    this.marker.classList.toggle('recorded', recorded);
  }
  showJournal() {
    const g = this.game; if (!g.started || g.dialogOpen()) return;
    g.setLookout(false); g.keys.clear(); g.net.input({}); this.hold.reset(); this.marker.hidden = true;
    const list = this.journal.querySelector('#crew-journal-entries'); list.replaceChildren();
    const prompt = new Option('Choose a recorded animal', ''); prompt.disabled = true;
    this.journalSelect.replaceChildren(prompt, ...this.entries.map(entry => new Option(FIELD_NOTES[entry.type][0], entry.type)));
    this.journalSelect.value = ''; this.journal.querySelector('.journal-jump').hidden = this.entries.length < 2;
    this.journal.querySelector('#crew-journal-intro').textContent = this.entries.length ? `${this.entries.length} animal ${this.entries.length === 1 ? 'group' : 'groups'} observed. Keep diving to discover more.` : 'Your sightings begin here. Enter the water, choose Observe, and keep an animal in view for a moment.';
    for (const entry of this.entries) {
      const [name, group, note] = FIELD_NOTES[entry.type], item = document.createElement('article');
      item.id = `journal-entry-${entry.type}`; item.tabIndex = -1;
      const h = document.createElement('h3'); h.id = `journal-title-${entry.type}`; h.textContent = name; item.setAttribute('aria-labelledby', h.id);
      const meta = document.createElement('p'); meta.className = 'journal-meta'; meta.textContent = `${group} · First seen at ${entry.depth} m`;
      const detail = document.createElement('p'); detail.textContent = note; item.append(h, meta, detail); list.append(item);
      appendPhoto(item, entry.type, this.photoFor(entry.type));
    }
    this.journal.showModal(); this.journal.scrollTop = 0;
  }

  requestPhoto() {
    if (!this.open || this.$('photograph-wildlife').disabled || !this.candidate || this.game.dialogOpen() || performance.now() - this.photoAt < 800) return;
    this.pendingPhoto = { id: this.candidate.sample.id }; this.lastUpdate = 0;
    this.$('photograph-wildlife').disabled = true;
  }

  finishPhoto() {
    const capture = this.capturePhoto; this.capturePhoto = null;
    if (!capture || !this.open || this.game.dialogOpen() || document.hidden) return;
    this.photoAt = performance.now();
    this.$('photograph-wildlife').disabled = true;
    const value = photograph(this.game.app.canvas, capture.candidate);
    if (!value) { this.$('photo-status').textContent = 'Could not capture this view. Your existing photo is kept.'; return; }
    this.photos.set(capture.type, value);
    const saved = savePhoto(this.storage, capture.type, value);
    this.$('photo-status').textContent = saved ? 'Photo saved to your field journal.' : 'Photo kept for this visit. Browser storage is full or unavailable.';
  }

  photoFor(type) {
    if (!this.photos.has(type)) this.photos.set(type, readPhoto(this.storage, type));
    return this.photos.get(type);
  }
}
