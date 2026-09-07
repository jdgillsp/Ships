import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { Connection } from './Connection.js';
import { Vessels } from './Vessels.js';
import { availableActions, BASE, WRECK, CRATE, distance } from './Simulation.js';
import { DECK_SPAWN } from './Deck.js';
import { ObjectiveMarker } from './ObjectiveMarker.js';
import { objectiveFor, objectiveDistance, recoveryStatus, missionGuidance } from './Guidance.js';
import { ExpeditionSound } from './ExpeditionSound.js';
import { CrewSignals } from './CrewSignals.js';
import { GameSettings } from './GameSettings.js';
import { WINCH_VIEW } from './RecoveryRig.js';
import { HELM_VIEW, helmFieldOfView } from './HelmRig.js';
import { CrewTracking } from './CrewTracking.js';
import { CrewNaturalist } from './CrewNaturalist.js';
import { DiveLight } from './DiveLight.js';
import { VoyageChart } from './VoyageChart.js';
import { SurveyConsole } from './SurveyConsole.js';
import { DiverBubbles } from './DiverBubbles.js';
import { DiveSplash } from './DiveSplash.js';
import { SavedExpeditions, rememberExpedition } from './SavedExpeditions.js';
import { CrewActivities, crewActivityLabel } from './CrewActivities.js';
import { CrewRadio } from './CrewCalls.js';
import { deckFollowPose, deckFollowTarget, clearDeckCamera, clearDeckEye } from './DeckCamera.js';
import { courseTarget } from './VoyageSites.js';
import { PlayHUD } from './PlayHUD.js';
import { nearbyDeckStation } from './DeckInteraction.js';
import { DeliveryLog } from './DeliveryLog.js';
import { TouchControls } from './TouchControls.js';
import { CrewInvite } from './CrewInvite.js';
import { CrewAwareness } from './CrewAwareness.js';
import { anchorStatus } from './Anchoring.js';
import { suggestedCrewName, rememberCrewName } from './CrewName.js';
import { secondaryTouchActivation } from './TouchActivation.js';
import { installDialogTabLoop } from './DialogFocus.js';
import './game.css';
import '../underwater/journal-photos.css';

const titles = { outbound: ['The lost archive', 'Sail south to the yellow survey buoy.'], dive: ['Below the buoy', 'Anchor within 32 m of the wreck. Dive and find the orange archive crate.'], recovery: ['Bring it into the light', 'Return aboard and operate the winch while anchored.'], return: ['A course for home', 'Recover your crew and sail north to Pelican Station.'], complete: ['Welcome home, Kestrel', 'Archive recovered. Every expedition leaves a story.'] };
const labels = { helm: 'Take helm [H]', leaveHelm: 'Leave helm [H]', anchor: 'Deploy anchor', dive: 'Enter water [V]', board: 'Climb aboard', attach: 'Attach lifting cable', winch: 'Operate winch [R]', leaveWinch: 'Stop winch [R]', deliver: 'Deliver archive', rescue: 'Return by safety beacon' };
const actionKeys = { KeyH: ['leaveHelm', 'helm'], KeyB: ['anchor'], KeyV: ['dive'], KeyR: ['winch', 'leaveWinch'] };

export class Game {
  constructor(app) {
    this.app = app; this.keys = new Set(); this.yaw = Math.PI; this.pitch = 0; this.orbit = 0; this.orbitPitch = .3; this.view = 'chase'; this.lastMode = null; this.status = 'Ready to depart'; this.lastSend = 0; this.lastUI = 0; this.started = false;
    app.cine.freeze = true; app.cine.free = false; app.director.enabled = false;
    app.director.clearEvents(); app.paused = false;
    U.uNavigationSea.value.set(1, 0, 0);
    Object.assign(app.post.settings, { dof: false, motionBlur: false, grain: .008, chromatic: .04, vignette: .18, bloomStrength: .09, saturation: 1.12, exposureCompensation: -.35 });
    document.body.classList.add('game-mode');
    app.underwater.scenery.clearings = [{ ...WRECK, radius: 18 }];
    app.underwater.scenery.pack(app.camera.position);
    this.models = new Vessels(app);
    this.bubbles = new DiverBubbles(app);
    this.splash = new DiveSplash(app);
    this.sound = new ExpeditionSound(app);
    this.net = new Connection(s => {
      if (this.state?.players[this.net?.id]?.mode === 'diver' && s.players[this.net?.id]?.mode === 'deck') this.boardingUntil = performance.now() + 1400;
      // The join snapshot contains history, not a newly occurring crew event.
      if (!this.state) { this.lastLog = s.log; this.completed = s.mission === 'complete'; }
      this.state = s;
    }, status => { this.status = status; });
    this.net.actionGuard = action => action === 'dive' && performance.now() < (this.boardingUntil || 0) ? 'Back aboard. Take a moment before entering the water again.' : null;
    this.buildUI(); this.bindInput();
    this.objectiveMarker = new ObjectiveMarker(this.root);
    this.signals = new CrewSignals(this);
    this.crewTracking = new CrewTracking(this);
    this.naturalist = new CrewNaturalist(this);
    this.diveLight = new DiveLight(this);
    this.voyage = new VoyageChart(this);
    this.survey = new SurveyConsole(this);
    this.settings = new GameSettings(this);
    installDialogTabLoop(this.root);
    this.deckView = this.settings.values.views.deck;
    this.savedExpeditions = new SavedExpeditions(this);
    this.activities = new CrewActivities(this);
    this.radio = new CrewRadio(this);
    this.hud = new PlayHUD(this);
    this.delivery = new DeliveryLog(this);
    this.crewInvite = new CrewInvite(this);
    this.crewAwareness = new CrewAwareness(this);
    this.touch = new TouchControls(this);
    app.beforeUpdate = (scaled, dt) => this.update(dt);
    app.afterUpdate = (scaled, dt) => this.afterUpdate(dt);
    app.camera.position.set(BASE.x + 25, 15, BASE.z - 30); app.camera.lookAt(BASE.x, 2, BASE.z);
    app.weather.set({ sunElevation: .55, sunAzimuth: 2.1, cloudCoverage: .35, windSpeed: 5, swellHs: .7, storm: 0, rain: 0 }, true);
    app.weather.update(0);
    this.models.update({ time: 0, storm: 0, ship: { ...BASE, y: 0, heading: Math.PI, pitch: 0, roll: 0, speed: 0 }, cargo: { ...CRATE }, players: {} }, '');
    window.addEventListener('pagehide', () => this.net.close());
  }
  buildUI() {
    this.root = document.createElement('div'); this.root.id = 'game';
    this.root.innerHTML = `
      <header class="game-top"><a class="game-brand" href="?mode=explore">ABYSSAL <span>EXPEDITIONS</span></a><div class="game-top-actions"><span id="crew-count">PRIVATE CREW · 1–4</span><button id="invite">Invite crew</button><button id="sound">Sound off</button><a href="?mode=explore">Free exploration ↗</a></div></header>
      <section class="mission-panel"><p class="eyebrow">KESTREL / SALVAGE 001</p><h1 id="mission-title">The lost archive</h1><p id="mission-detail">A small ship. A shared ocean. Something worth bringing home.</p><div class="mission-steps" aria-label="Mission progress"><span>SAIL</span><i></i><span>DIVE</span><i></i><span>RECOVER</span><i></i><span>RETURN</span></div></section>
      <aside class="nav-panel"><div class="chart-heading"><span>PELAGIC CHART</span><span id="bearing">S · 180°</span></div><canvas id="sea-chart" width="280" height="250" aria-label="Chart showing the cutter, base, wreck and crew"></canvas><div class="chart-key"><span>⌂ BASE</span><span>◇ WRECK</span><span>▲ KESTREL</span></div><p id="range">Survey buoy · 195 m</p><div id="crew-list"></div></aside>
      <div id="game-message" role="status" aria-live="polite"></div>
      <footer class="ship-console"><div class="instrument-row"><div><span id="station">ON DECK</span><strong id="speed">0.0 <small>kn</small></strong><span id="helm-feedback" hidden></span></div><div><span id="sea-label">SEA STATE</span><strong id="sea-state">Fair</strong></div><div><span id="anchor-label">ANCHOR</span><strong id="anchor-state">Holding</strong></div><button id="camera-view">View: chase</button></div><div id="game-actions"></div><div class="context-row"><span id="pilot-hint"></span></div><p id="controls">W / S throttle · A / D steer · Drag to look · F interact · B anchor · V dive</p><p id="connection-status">Ready to depart</p></footer>
      <section class="launch-screen"><div class="launch-card"><p class="eyebrow">A COOPERATIVE OCEAN EXPEDITION</p><h2>The lost<br><em>archive.</em></h2><p>A research vessel went down over the reef. Its archive is still below. Take Kestrel out, recover the crate, and bring your crew home before the sea closes in.</p><div class="briefing"><span>01 / Sail to the buoy</span><span>02 / Anchor & dive</span><span>03 / Winch up the archive</span><span>04 / Return to station</span></div><label for="crew-name">Your name or callsign</label><input id="crew-name" maxlength="20" autocomplete="nickname"><button id="start-expedition" class="primary">${this.app.params.has('room') ? 'Join the crew' : 'Begin expedition'} <span>→</span></button><p id="launch-status" role="status">Play solo, or invite up to three friends once aboard.</p><a href="?mode=explore">Explore the ocean freely ↗</a></div></section>
      <dialog id="mission-complete" hidden aria-labelledby="delivery-title"><p class="eyebrow">PELICAN STATION / VOYAGE LOG</p><h2 id="delivery-title">Archive delivered</h2><p>The archive is safe ashore.</p><strong id="mission-time"></strong><p id="delivery-crew"></p><p id="delivery-sender"></p><p class="delivery-next">Keep sailing with your crew or chart another dive.</p><button id="continue-sailing">Back aboard</button><a href="?mode=expedition">New expedition ↗</a></dialog>
      <dialog id="invite-dialog"></dialog>`;
    document.body.append(this.root);
    this.$ = id => this.root.querySelector(`#${id}`);
    this.$('crew-name').value = suggestedCrewName();
    const optics = document.createElement('div'); optics.id = 'lookout-overlay'; optics.hidden = true;
    optics.innerHTML = '<div class="lookout-readout"><span>KESTREL / FIELD OPTICS</span><strong id="lookout-bearing"></strong><div class="lookout-zoom-controls" role="group" aria-label="Binocular magnification"><button id="lookout-zoom-out" aria-label="Zoom binoculars out">−</button><output id="lookout-zoom" aria-label="Current binocular magnification" aria-live="off">3.0×</output><button id="lookout-zoom-in" aria-label="Zoom binoculars in">+</button></div></div><div class="lookout-reticle" aria-hidden="true"></div>';
    this.root.append(optics);
    this.$('lookout-zoom-out').onclick = () => this.zoomLookout(-.5);
    this.$('lookout-zoom-in').onclick = () => this.zoomLookout(.5);
    const viewControls = document.createElement('div'); viewControls.className = 'view-controls';
    this.$('camera-view').before(viewControls); viewControls.append(this.$('camera-view'));
    const binoculars = document.createElement('button'); binoculars.id = 'binoculars'; binoculars.textContent = 'Binoculars [L]'; binoculars.setAttribute('aria-pressed', 'false'); viewControls.append(binoculars);
    binoculars.onclick = () => this.setLookout(!this.lookout);
    for (const button of [binoculars, this.$('lookout-zoom-out'), this.$('lookout-zoom-in')]) secondaryTouchActivation(button);
    const recovery = document.createElement('div'); recovery.id = 'salvage-progress'; recovery.hidden = true;
    recovery.innerHTML = '<div class="salvage-heading"><span id="salvage-status"></span><span id="salvage-percent"></span></div><progress id="salvage-meter" max="1" value="0" aria-label="Archive recovery"></progress>';
    this.root.querySelector('.mission-panel').append(recovery);
    // Keep controls mounted while availability changes. Replacing the action
    // row between pointer-down and pointer-up can swallow a real user's click.
    this.actionButtons = new Map(Object.keys(labels).map(action => {
      const button = document.createElement('button'); button.dataset.action = action; button.textContent = labels[action]; button.hidden = true;
      if (action === 'rescue') button.className = 'quiet'; this.$('game-actions').append(button); return [action, button];
    }));
    const reconnect = document.createElement('div'); reconnect.id = 'connection-recovery'; reconnect.hidden = true;
    reconnect.innerHTML = '<button id="retry-connection">Retry connection</button><a href="?mode=expedition">Start a new expedition ↗</a>';
    this.$('connection-status').after(reconnect);
    this.$('retry-connection').onclick = async () => {
      this.$('retry-connection').disabled = true;
      try { await this.net.join(this.net.room, this.state?.players[this.net.id]?.name || 'Crew'); }
      catch (error) { this.status = error.message; }
      finally { this.$('retry-connection').disabled = false; }
    };
    this.$('start-expedition').onclick = () => this.start();
    this.$('crew-name').addEventListener('keydown', e => { if (e.key === 'Enter') this.start(); });
    this.$('camera-view').onclick = () => {
      const role = this.state?.players[this.net.id]?.mode; if (!['deck', 'helm', 'winch'].includes(role)) return;
      this.view = this.view === 'chase' ? 'deck' : 'chase';
      if (role === 'deck') this.deckView = this.view;
      this.settings.values.views[role] = this.view; this.settings.save(); this.resetCamera();
    };
    this.$('sound').onclick = () => this.toggleSound();
    this.$('game-actions').addEventListener('click', e => { const action = e.target.closest('[data-action]')?.dataset.action; if (action) this.action(action); });
  }
  inviteURL(address = location.href) { const u = new URL(address); u.search = ''; u.hash = ''; u.searchParams.set('mode', 'expedition'); u.searchParams.set('room', this.net.room); return u.href; }
  dialogOpen() { return this.$('invite-dialog').open || !!this.settings?.dialog.open || !!this.naturalist?.journal.open || !!this.voyage?.dialog.open || !!this.activities?.dialog.open || !!this.radio?.dialog.open || !!this.delivery?.dialog.open; }
  async start(resume) {
    const button = this.$('start-expedition'); if (button.disabled) return; button.disabled = true;
    this.$('launch-status').textContent = 'Preparing your expedition…';
    try {
      const room = await this.net.join(resume?.room || this.app.params.get('room'), resume?.name || this.$('crew-name').value, resume?.token);
      rememberCrewName(this.net.state.players[this.net.id].name);
      rememberExpedition(this.net);
      const u = new URL(location.href); u.searchParams.set('room', room); u.searchParams.set('mode', 'expedition'); history.replaceState(null, '', u);
      this.started = true; this.root.querySelector('.launch-screen').remove();
    } catch (error) { this.$('launch-status').textContent = error.message; button.disabled = false; }
  }
  bindInput() {
    this.zoom = 27; this.walkZoom = 7.5; this.deckView = 'deck'; this.deckPitch = 0; this.lookout = false; this.magnification = 3;
    // Pointer actions return to swimming/walking. Keyboard activation retains
    // focus so Tab, Space and Enter can operate the console conventionally.
    this.root.addEventListener('click', e => {
      if (e.detail > 0 && this.started && !this.dialogOpen() && document.activeElement?.matches('button')) document.activeElement.blur();
    });
    window.addEventListener('keydown', e => {
      if (!this.started || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || e.metaKey || e.altKey || this.dialogOpen()) return;
      if (e.target.closest('button') && ['Space', 'Enter'].includes(e.code)) return;
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyX', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ControlLeft', 'ControlRight'].includes(e.code)) { this.keys.add(e.code); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyF') { const action = this.contextAction(); if (action) this.action(action); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyC') this.$('camera-view').click();
      if (!e.repeat && e.code === 'KeyL') { this.setLookout(!this.lookout); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyG') { this.signals.send(); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyO') { this.naturalist.toggle(); e.preventDefault(); }
      if (!e.repeat && !e.ctrlKey && e.code === 'KeyP' && this.naturalist.open) { this.naturalist.requestPhoto(); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyJ') { this.naturalist.showJournal(); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyT') { this.diveLight.cycle(); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyN') { this.voyage.show(); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyK') { this.hud.toggleGlance(); e.preventDefault(); }
      if (!e.repeat && e.key === '?') { this.hud.help.button.click(); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyI') { this.settings.toggleInterface(); e.preventDefault(); }
      if (!e.repeat && e.code === 'KeyZ') { this.radio.show(); e.preventDefault(); }
      if (!e.repeat && e.code === 'Escape') { this.setLookout(false); this.naturalist.toggle(false); if (this.hud.open) this.hud.toggle(); }
      if (!e.repeat && e.code === 'Home') { this.resetCamera(); e.preventDefault(); }
      if (!e.repeat && actionKeys[e.code]) { const action = actionKeys[e.code].find(a => availableActions(this.state, this.net.id).includes(a)); if (action) this.action(action); }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.setLookout(false); });
    document.addEventListener('visibilitychange', () => { this.keys.clear(); if (document.hidden) { this.net.input({}); this.setLookout(false); this.cancelCameraDrag?.(); } });
    const canvas = this.app.canvas; let drag = null;
    canvas.addEventListener('pointerdown', e => {
      if (!this.started || this.dialogOpen() || drag || (e.button !== 0 && e.button !== 2)) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId);
    });
    const endDrag = e => { if (drag?.id === e.pointerId) drag = null; };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    this.cancelCameraDrag = () => { const id = drag?.id; drag = null; if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); };
    window.addEventListener('blur', this.cancelCameraDrag);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('dblclick', () => this.resetCamera());
    canvas.addEventListener('wheel', e => {
      const mode = this.state?.players[this.net.id]?.mode;
      if (!this.started || this.dialogOpen()) return;
      if (mode === 'diver') {
        if (!this.naturalist.open) return;
        this.naturalist.zoomBy(-e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1) * .003);
      } else if (this.lookout) this.zoomLookout(-e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1) * .004);
      else if (mode === 'deck' && this.view === 'chase') this.walkZoom = THREE.MathUtils.clamp(this.walkZoom + e.deltaY * .012, 3, 15);
      else this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * .025, 14, 60);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      if (this.dialogOpen() || document.hidden) { drag = null; return; }
      const dx = (e.clientX - drag.x) * this.settings.values.sensitivity, dy = (e.clientY - drag.y) * this.settings.values.sensitivity * (this.settings.values.invertY ? -1 : 1);
      drag.x = e.clientX; drag.y = e.clientY;
      if (this.state?.players[this.net.id]?.mode === 'diver') { const sensitivity = .004 / (this.naturalist.open ? this.naturalist.lens.value : 1); this.yaw -= dx * sensitivity; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sensitivity, -1.4, 1.4); }
      else if (this.view === 'deck' || this.lookout) { const sensitivity = .004 / (this.lookout ? this.magnification : 1); this.orbit -= dx * sensitivity; this.deckPitch = THREE.MathUtils.clamp(this.deckPitch - dy * sensitivity, -1.2, 1.2); }
      else { this.orbit -= dx * .004; this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * .003, .05, 1.1); }
    });
  }
  setLookout(on) {
    const p = this.state?.players[this.net.id];
    on = !!on && this.started && p?.mode === 'deck' && !this.dialogOpen() && this.$('mission-complete').hidden;
    if (on === this.lookout) return;
    this.touch?.reset();
    this.lookout = on; this.keys.clear(); this.net.input({}); this.cameraSnap = true;
    this.root.classList.toggle('lookout-active', on); this.$('lookout-overlay').hidden = !on;
    this.$('binoculars').setAttribute('aria-pressed', String(on)); this.$('binoculars').textContent = on ? 'Lower binoculars [L]' : 'Binoculars [L]';
    if (on) this.updateLookoutZoom();
  }
  zoomLookout(delta) {
    if (!this.lookout || this.dialogOpen()) return;
    this.magnification = THREE.MathUtils.clamp(this.magnification + delta, 2, 6);
    this.updateLookoutZoom();
  }
  updateLookoutZoom() {
    this.$('lookout-zoom').value = `${this.magnification.toFixed(1)}×`;
    this.$('lookout-zoom-out').disabled = this.magnification <= 2;
    this.$('lookout-zoom-in').disabled = this.magnification >= 6;
  }
  resetCamera() { this.setLookout(false); this.naturalist.lens.reset(); const mode = this.state?.players[this.net.id]?.mode, winch = mode === 'winch' && this.view === 'deck'; this.orbit = winch ? WINCH_VIEW.yaw : 0; this.orbitPitch = .3; this.deckPitch = winch ? WINCH_VIEW.pitch : mode === 'helm' && this.view === 'deck' ? HELM_VIEW.pitch : 0; this.zoom = 27; this.walkZoom = 7.5; this.pitch = 0; this.yaw = this.state?.ship.heading ?? Math.PI; this.cameraSnap = true; }
  contextAction() {
    const w = this.state, p = w?.players[this.net.id]; if (!p) return null;
    const actions = availableActions(w, this.net.id), has = a => actions.includes(a);
    if (p.mode === 'deck' && performance.now() < (this.boardingUntil || 0)) return null;
    if (has('attach')) return 'attach';
    if (has('board')) return 'board';
    if (p.mode === 'diver') return null;
    if (has('deliver')) return 'deliver';
    const nearby = nearbyDeckStation(w, this.net.id);
    if (nearby) return nearby.action;
    if (w.cargo.attached && !w.cargo.recovered) { if (!w.ship.anchor) return 'anchor'; return has('winch') ? 'winch' : null; }
    if (w.mission === 'dive' && distance(w.ship, w.cargo) < 32) { if (!w.ship.anchor) return 'anchor'; if (has('dive')) return 'dive'; }
    if (p.mode !== 'helm' && has('helm')) return 'helm';
    if (p.mode === 'helm' && w.ship.anchor) return 'anchor';
    if (p.mode === 'deck' && w.players[w.ship.pilot]?.connected && w.ship.pilot !== this.net.id) return 'lookout';
    return null;
  }
  async action(action) {
    if (action === 'lookout') {
      if (this.contextAction() === 'lookout') this.setLookout(true);
      return;
    }
    if (action === 'radio') {
      if (nearbyDeckStation(this.state, this.net.id)?.station === 'radio') this.radio.show({ station: true });
      return;
    }
    try { await this.net.action(action); this.message = ''; } catch (error) { this.message = error.message; this.messageUntil = performance.now() + 4000; }
  }
  update(dt) {
    const app = this.app, w = this.net.interpolated();
    this.frameWorld = w;
    if (!w) { app.weather.update(dt); return; }
    app.time = w.time; app.ocean.time = w.time; app.paused = false;
    U.uNavigationSea.value.set(1, w.time, w.storm);
    const storm = w.storm;
    app.weather.set({ sunElevation: .55 - storm * .25, windSpeed: 5 + storm * 18, swellHs: .7 + storm * 3.2, storm,
      cloudCoverage: .35 + storm * .65, cloudDensity: .55 + storm * .7, rain: storm * .65, fog: storm * .25, spray: storm * .45, lightningRate: storm * .12, foamStrength: .55 }, true);
    app.weather.update(dt);
    const p = w.players[this.net.id]; if (!p) return;
    if (this.lastMode !== p.mode) {
      const leavingStation = (this.lastMode === 'winch' || this.lastMode === 'helm') && p.mode === 'deck' && this.view === 'deck' && this.deckView === 'deck';
      this.setLookout(false);
      if (p.mode === 'deck') this.view = this.deckView; else if (p.mode === 'winch' || p.mode === 'helm') this.view = this.settings.values.views[p.mode];
      this.lastMode = p.mode; this.yaw = p.yaw; this.pitch = p.mode === 'diver' ? -.2 : 0;
      // Station input must be ready in this frame, before the slower HUD refresh.
      this.$('camera-view').disabled = p.mode === 'diver';
      // Stepping away from equipment keeps the first-person view facing the
      // same direction, so the next walking input follows where we were looking.
      if (!leavingStation) {
        const atWinch = p.mode === 'winch' && this.view === 'deck';
        this.orbit = atWinch ? WINCH_VIEW.yaw : 0;
        this.deckPitch = atWinch ? WINCH_VIEW.pitch : p.mode === 'helm' && this.view === 'deck' ? HELM_VIEW.pitch : 0;
      }
      this.keys.clear(); this.cameraSnap = !leavingStation;
    }
    this.touch.update(p.mode);
    this.models.update(w, this.net.id, this.lookout ? 'deck' : this.view);
    const s = w.ship;
    const position = new THREE.Vector3(), look = new THREE.Vector3();
    if (p.mode === 'diver') {
      const left = this.keys.has('KeyQ') || this.keys.has('ArrowLeft'), right = this.keys.has('KeyE') || this.keys.has('ArrowRight');
      this.yaw += (Number(left) - Number(right)) * dt * 1.5 * this.settings.values.sensitivity / (this.naturalist.open ? this.naturalist.lens.value : 1);
      position.set(p.x, p.y, p.z); look.copy(position).add(new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)));
    } else if (this.view === 'deck' || this.lookout) {
      this.orbit += (Number(this.keys.has('KeyQ')) - Number(this.keys.has('KeyE'))) * dt * 1.5 * this.settings.values.sensitivity / (this.lookout ? this.magnification : 1);
      position.copy(this.models.ship.localToWorld(new THREE.Vector3(p.mode === 'deck' ? (p.deckX ?? DECK_SPAWN.x) : p.mode === 'helm' ? HELM_VIEW.x : WINCH_VIEW.x, 3.6, p.mode === 'deck' ? (p.deckZ ?? DECK_SPAWN.z) : p.mode === 'helm' ? HELM_VIEW.z : WINCH_VIEW.z)));
      const angle = s.heading + this.orbit; look.copy(position).add(new THREE.Vector3(Math.sin(angle) * Math.cos(this.deckPitch) * 30, Math.sin(this.deckPitch) * 30, Math.cos(angle) * Math.cos(this.deckPitch) * 30));
    } else if (p.mode === 'deck') {
      const follow = deckFollowPose(p, this.orbit, this.orbitPitch, this.walkZoom, w.cargo.recovered);
      position.copy(this.models.ship.localToWorld(follow.position)); look.copy(this.models.ship.localToWorld(follow.target));
      // Frame the crewmate above the console, particularly on narrow screens.
      look.y -= Math.max(0, (this.objectiveMarker.consoleHeight || 240) / innerHeight - .23) * position.distanceTo(look) * .65;
    } else {
      const angle = s.heading + this.orbit; const radius = this.zoom;
      position.set(s.x - Math.sin(angle) * radius, s.y + 7 + Math.sin(this.orbitPitch) * 22, s.z - Math.cos(angle) * radius);
      look.set(s.x + Math.sin(s.heading) * 4, s.y + 2, s.z + Math.cos(s.heading) * 4);
    }
    const cameraCut = this.cameraSnap, previousFov = app.camera.fov;
    app.camera.position.lerp(position, this.cameraSnap ? 1 : 1 - Math.exp(-dt * 12)); this.cameraSnap = false;
    if (p.mode === 'deck' && this.view === 'chase' && !this.lookout) {
      const local = this.models.ship.worldToLocal(app.camera.position.clone()), target = deckFollowTarget(p, w.cargo.recovered);
      app.camera.position.copy(this.models.ship.localToWorld(clearDeckCamera(target, local, w.cargo.recovered)));
    }
    if (p.mode !== 'diver' && (this.view === 'deck' || this.lookout)) {
      const local = this.models.ship.worldToLocal(app.camera.position.clone());
      const safe = this.models.ship.localToWorld(clearDeckEye(local));
      look.add(safe.clone().sub(app.camera.position));
      app.camera.position.copy(safe);
    }
    app.camera.up.set(0, 1, 0); app.camera.lookAt(look); app.camera.fov = p.mode === 'diver' ? (this.naturalist.open ? this.naturalist.lens.update(dt) : 68) : this.lookout ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(55) / 2) / this.magnification)) : p.mode === 'helm' && this.view === 'deck' ? helmFieldOfView(app.camera.aspect) : 55; app.camera.updateMatrixWorld(); app.cine.focusDistance = p.mode === 'diver' ? 18 : 35;
    if (cameraCut || Math.abs(previousFov - app.camera.fov) > .1) { app.post.reset = true; app.clouds.reset = true; }
    this.models.updateCameraVisibility(app.camera);
    if (performance.now() - this.lastSend > 90) {
      this.lastSend = performance.now(); const n = (...codes) => codes.some(code => this.keys.has(code)) ? 1 : 0;
      const combine = (keyboard, touch) => THREE.MathUtils.clamp(keyboard + touch, -1, 1);
      const strafe = p.mode === 'deck' ? n('KeyD', 'ArrowRight') - n('KeyA', 'ArrowLeft') : n('KeyD') - n('KeyA');
      this.net.input({ mode: p.mode, forward: combine(n('KeyW', 'ArrowUp') - n('KeyS', 'ArrowDown'), this.touch.forward), turn: combine(n('KeyD', 'ArrowRight') - n('KeyA', 'ArrowLeft'), this.touch.x), strafe: combine(strafe, this.touch.x), vertical: combine(n('Space') - n('ControlLeft', 'ControlRight'), this.touch.vertical), yaw: this.yaw, pitch: this.pitch, walkYaw: this.orbit,
        survey: this.keys.has('KeyX') && !this.dialogOpen() && !this.naturalist.open && !document.hidden && this.$('mission-complete').hidden });
    }
    if (performance.now() - this.lastUI > 150) { this.lastUI = performance.now(); this.updateUI(this.state); }
  }
  afterUpdate(dt) {
    if (!this.started) return;
    this.diveLight.update(dt);
    this.app.camera.getWorldDirection(U.uDiveForward.value);
    // Crew poses, effects and sound use the same interpolation instant as the
    // camera, rather than advancing the network clock twice within one frame.
    const world = this.frameWorld;
    if (world) {
      this.bubbles.update(world, this.models);
      this.splash.update(world);
      this.sound.update(world, this.net.id, this.models.ship);
      this.signals.update(world, !this.dialogOpen() && this.$('mission-complete').hidden);
      this.naturalist.update(performance.now());
      this.crewAwareness.update(world, performance.now());
    }
  }
  updateUI(w) {
    const p = w.players[this.net.id], s = w.ship; if (!p) return;
    this.savedExpeditions.update(w);
    this.activities.updateUI(w);
    this.radio.updateUI(w);
    this.crewTracking.updateUI(w);
    this.naturalist.updateUI(w);
    this.diveLight.updateUI(w);
    this.voyage.updateUI(w);
    this.signals.updateUI(w);
    this.survey.updateUI(w);
    const [title, detail] = titles[w.mission]; this.$('mission-title').textContent = title; this.$('mission-detail').textContent = detail;
    const course = courseTarget(w, this.net.id), objective = course || objectiveFor(w, this.net.id);
    this.$('mission-detail').textContent = missionGuidance(w, this.net.id)?.text || detail;
    if (course) { this.$('mission-title').textContent = course.label; this.$('mission-detail').textContent = course.hint; }
    this.root.querySelector('.mission-panel .eyebrow').textContent = course ? 'KESTREL / CREW COURSE' : 'KESTREL / SALVAGE 001';
    this.$('salvage-progress').hidden = !w.cargo.attached;
    if (w.cargo.attached) {
      const recovery = recoveryStatus(w);
      this.$('salvage-status').textContent = recovery.text;
      this.$('salvage-percent').textContent = `${Math.round(recovery.progress * 100)}%`;
      this.$('salvage-meter').value = recovery.progress;
    }
    this.$('station').textContent = { deck: 'ON DECK', helm: 'AT THE HELM', winch: 'WINCH CONTROL', diver: 'DIVE TEAM' }[p.mode];
    this.$('speed').innerHTML = p.mode === 'diver' ? `${Math.max(0, -p.y).toFixed(1)} <small>m deep</small>` : `${s.speed < -.05 ? '−' : ''}${(Math.abs(s.speed) * 1.944).toFixed(1)} <small>kn</small>`;
    this.$('sea-state').textContent = w.storm < .15 ? 'Fair' : w.storm < .5 ? 'Building' : 'Rough';
    const anchor = anchorStatus(s);
    this.$('anchor-state').textContent = anchor.state;
    const helm = this.$('helm-feedback'); helm.hidden = p.mode !== 'helm';
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft'), right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    helm.textContent = `${s.anchor || anchor.moving ? anchor.description : s.speed < -.05 ? 'Astern' : Math.abs(s.speed) < .05 ? 'Stopped' : 'Ahead'} · ${left !== right ? (right ? 'Rudder right' : 'Rudder left') : 'Rudder centered'}`;
    this.$('camera-view').disabled = p.mode === 'diver'; this.$('camera-view').textContent = p.mode === 'diver' ? 'View: diver' : `View: ${p.mode === 'deck' && this.view === 'chase' ? 'follow' : this.view} [C]`;
    this.$('binoculars').disabled = p.mode !== 'deck'; this.$('binoculars').title = p.mode === 'diver' ? 'Use binoculars while aboard the cutter.' : p.mode !== 'deck' ? 'Leave your station to walk the deck and use binoculars.' : 'Look out from the deck with 2–6× magnification.';
    if (this.lookout) {
      const bearing = ((-(s.heading + this.orbit) * 180 / Math.PI % 360) + 360) % 360;
      this.$('lookout-bearing').textContent = `${bearing.toFixed(0).padStart(3, '0')}° ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8]}`;
      this.updateLookoutZoom();
    }
    this.$('bearing').textContent = `${((-s.heading * 180 / Math.PI % 360 + 360) % 360).toFixed(0)}°`;
    this.$('crew-count').textContent = `PRIVATE CREW · ${Object.values(w.players).filter(p => p.connected).length}/4`;
    this.$('connection-status').textContent = this.net.ready ? `● Connected · ${this.net.room}` : `○ ${this.status}`;
    this.$('connection-status').classList.toggle('offline', !this.net.ready);
    this.$('connection-recovery').hidden = this.net.ready || performance.now() - this.net.receivedAt < 4000;
    const destination = objective || { key: 'base', ...BASE, y: 3 };
    const destinationName = destination.key === 'course' ? destination.label : { buoy: 'Survey buoy', archive: 'Archive signal', ship: 'Kestrel', lift: 'Archive recovery', base: 'Pelican Station' }[destination.key];
    this.$('range').textContent = `${destinationName} · ${Math.round(objectiveDistance(w, this.net.id, destination))} m`;
    const actions = availableActions(w, this.net.id);
    for (const [action, button] of this.actionButtons) {
      const aboard = p.mode !== 'diver';
      button.hidden = !actions.includes(action) && !(aboard && (action === 'dive' || action === 'winch' || (action === 'helm' && p.mode !== 'helm')));
      if (action === 'winch' && (p.mode === 'winch' || w.cargo.recovered)) button.hidden = true;
      button.disabled = !this.net.ready || !actions.includes(action) || !!this.net.actionGuard?.(action);
      button.title = actions.includes(action) ? '' : action === 'dive' ? 'Slow below 4 knots to enter the water.' : action === 'winch' ? (!w.cargo.attached ? 'A diver must attach the lifting cable first.' : 'Another crewmate is operating the winch.') : 'Another crewmate is at the helm.';
    }
    const primary = this.contextAction();
    for (const [action, button] of this.actionButtons) {
      const suggested = action === primary, quiet = this.root.classList.contains('quiet-play');
      let label = action === 'anchor' ? (s.anchor ? 'Raise anchor [B]' : 'Deploy anchor [B]') : labels[action];
      if (quiet && suggested) label = label.replace(/ \[[A-Z]\]$/, '');
      button.classList.toggle('suggested', suggested);
      button.textContent = `${suggested ? '[F] ' : ''}${label}${!actions.includes(action) && action === 'dive' ? ' · slow down' : !actions.includes(action) && action === 'winch' ? (!w.cargo.attached ? ' · cable needed' : ' · occupied') : !actions.includes(action) && action === 'helm' ? ' · occupied' : ''}`;
    }
    this.$('pilot-hint').textContent = p.mode === 'helm' ? (anchor.moving ? `${anchor.description}…` : s.anchor ? `${anchor.description} — raise it to get underway` : 'W / ↑ ahead · S / ↓ slow & reverse · A / ← left · D / → right') : p.mode === 'deck' ? (s.pilot ? 'Walk the deck while your crewmate pilots. You can anchor, dive, or work the winch.' : 'Walk the deck, explore underwater, or press H to take the helm.') : p.mode === 'diver' ? 'Space ascend · Ctrl descend · Q / E turn' : 'Lifting archive…';
    this.$('controls').textContent = p.mode === 'diver' ? 'W / S swim · A / D strafe · Ctrl down / Space up · Q / E or drag to look · F interact' : p.mode === 'winch' ? `${recoveryStatus(w).text} · Q / E or drag to look · Home controls · R leave station` : 'Hold W / S throttle · Release to coast · Q / E look in first person · Drag to look · Scroll zoom · C view · Home reset';
    if (p.mode === 'deck') this.$('controls').textContent = `WASD / arrows walk · ${this.view === 'deck' ? 'Q / E turn · ' : ''}Drag to look · C ${this.view === 'chase' ? 'first person · Scroll zoom' : 'follow view'} · L binoculars · G mark for crew`;
    if (p.mode === 'diver' && objective?.key === 'archive') this.$('controls').textContent += ` · Crate ${Math.round(Math.hypot(p.x - w.cargo.x, p.y - w.cargo.y, p.z - w.cargo.z))} m`;
    if (objective && (course || p.mode !== 'helm' || w.mission !== 'outbound')) this.$('pilot-hint').textContent = objective.hint;
    if (this.lookout) { this.$('pilot-hint').textContent = 'LOOKOUT · walk to the bow for a clear view of the sea'; this.$('controls').textContent = 'WASD walk · Q / E or drag to aim · Scroll or − / + zoom 2–6× · G mark for crew · L / Esc lower'; }
    this.hud.update(w);
    this.objectiveMarker.consoleHeight = this.root.querySelector('.ship-console').offsetHeight;
    this.objectiveMarker.occluders = (this.lookout ? ['.lookout-readout'] : [this.naturalist.open ? '#crew-naturalist' : '.mission-panel', '.nav-panel'])
      .map(selector => this.root.querySelector(selector)).filter(e => getComputedStyle(e).visibility !== 'hidden').map(e => e.getBoundingClientRect());
    if (w.log !== this.lastLog) { this.lastLog = w.log; this.logUntil = performance.now() + 7000; }
    // Anchor command logs predate the shared gear animation. While it runs,
    // describe the current motion instead of announcing its endpoint early.
    const anchorLog = ['Anchor deployed. The cutter will hold position.', 'Anchor raised. The helm is ready.'].includes(w.log);
    const anchorInReadout = this.root.classList.contains('quiet-play') && p.mode === 'helm' && this.hud.readout.textContent.includes(anchor.description);
    const log = anchorLog && anchorInReadout ? '' : anchor.moving && anchorLog ? `${anchor.description}…` : w.log;
    this.$('game-message').textContent = this.message && performance.now() < this.messageUntil ? this.message : performance.now() < this.logUntil ? log : '';
    this.$('crew-list').replaceChildren(...Object.values(w.players).map((p, index) => { const row = document.createElement('div'); row.className = `crew-row crew-${index}`; const name = document.createElement('span'), mode = document.createElement('span'); name.textContent = `${p.id === this.net.id ? '● ' : '○ '}${p.name}`; mode.textContent = crewActivityLabel(p); row.append(name, mode); return row; }));
    const phase = course ? (w.surveys?.[course.site.id]?.completedAt != null ? 3 : (w.surveys?.[course.site.id]?.seconds || 0) > 0 ? 2 : p.mode === 'diver' ? 1 : 0) : ['outbound', 'dive', 'recovery', 'return', 'complete'].indexOf(w.mission);
    this.root.querySelectorAll('.mission-steps span').forEach((el, i) => { el.textContent = (course ? ['SAIL', 'DIVE', 'SURVEY', 'LOGGED'] : ['SAIL', 'DIVE', 'RECOVER', 'RETURN'])[i]; el.classList.toggle('done', i <= phase); });
    this.delivery.update(w);
    this.drawChart(w);
  }
  drawChart(w) {
    const canvas = this.$('sea-chart'), c = canvas.getContext('2d'); const center = { x: (BASE.x + WRECK.x) / 2, z: (BASE.z + WRECK.z) / 2 };
    const course = courseTarget(w, this.net.id);
    const extent = Math.max(160, Math.abs(w.ship.x - center.x) + 40, Math.abs(w.ship.z - center.z) + 40, course ? Math.max(Math.abs(course.x - center.x), Math.abs(course.z - center.z)) + 40 : 0);
    this.chartView = { center, extent };
    const point = p => [140 - (p.x - center.x) * 112 / extent, 125 - (p.z - center.z) * 112 / extent];
    c.clearRect(0, 0, 280, 250); c.strokeStyle = '#365254'; c.lineWidth = .5;
    for (let n = 20; n < 280; n += 30) { c.beginPath(); c.moveTo(n, 0); c.lineTo(n, 250); c.stroke(); }
    for (let n = 5; n < 250; n += 30) { c.beginPath(); c.moveTo(0, n); c.lineTo(280, n); c.stroke(); }
    c.strokeStyle = '#d5b47766'; c.setLineDash([3, 5]); c.beginPath(); c.moveTo(...point(BASE)); c.lineTo(...point(WRECK)); c.stroke(); c.setLineDash([]);
    for (const [p, label, color] of [[BASE, 'PELICAN', '#a9cab8'], [WRECK, 'ARCHIVE', '#e6b364']]) { const [x, y] = point(p); c.fillStyle = color; c.strokeStyle = color; c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.stroke(); c.font = '10px monospace'; c.fillText(label, x + 10, y + 3); }
    c.fillStyle = '#e9f0e1'; c.font = '11px monospace'; c.fillText('N ↑', 12, 20);
    const [x, y] = point(w.ship); c.save(); c.translate(x, y); c.rotate(-w.ship.heading); c.fillStyle = '#f7dfae'; c.beginPath(); c.moveTo(0, -9); c.lineTo(5, 7); c.lineTo(0, 4); c.lineTo(-5, 7); c.closePath(); c.fill(); c.restore();
    Object.values(w.players).filter(p => p.mode === 'diver').forEach(p => { const [x, y] = point(p); c.fillStyle = '#70ded0'; c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill(); });
    if (course) { c.strokeStyle = '#edc888'; c.lineWidth = 1.5; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(...point(w.ship)); c.lineTo(...point(course)); c.stroke(); c.setLineDash([]); c.beginPath(); c.arc(...point(course), 7, 0, Math.PI * 2); c.stroke(); }
    for (const signal of this.signals.active(w)) { const [x, y] = point(signal); c.strokeStyle = '#7af1dc'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 7 + Math.sin(w.time * 3) * 1.5, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#7af1dc'; c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill(); }
  }
  async toggleSound() {
    const button = this.$('sound'); if (button.disabled) return; button.disabled = true;
    try { await this.sound.setEnabled(!this.sound.enabled); button.textContent = this.sound.enabled ? 'Sound on' : 'Sound off'; button.setAttribute('aria-pressed', String(this.sound.enabled)); }
    catch (error) { this.message = error.message; this.messageUntil = performance.now() + 5000; }
    finally { button.disabled = false; }
  }
}
