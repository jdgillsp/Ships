import { surveyStatus } from './Survey.js';
import { recoveryStatus, missionGuidance, objectiveFor, objectiveDistance } from './Guidance.js';
import { courseTarget } from './VoyageSites.js';
import { PlayerHelp } from './PlayerHelp.js';
import { nearbyDeckStation } from './DeckInteraction.js';
import { distance } from './Simulation.js';
import { anchorStatus } from './Anchoring.js';

export class PlayHUD {
  constructor(game) {
    this.game = game; this.open = false;
    this.readout = document.createElement('p'); this.readout.id = 'play-readout';
    game.root.querySelector('.ship-console').prepend(this.readout);
    this.scout = document.createElement('button'); this.scout.id = 'scout-ahead'; this.scout.dataset.action = 'lookout';
    this.scout.textContent = '[F] Scout ahead'; this.scout.className = 'suggested'; this.scout.hidden = true;
    game.$('game-actions').append(this.scout);
    this.chart = document.createElement('button'); this.chart.id = 'play-chart'; this.chart.textContent = 'Chart [N]';
    this.chart.onclick = () => game.voyage.show();
    this.button = document.createElement('button'); this.button.id = 'play-tools'; this.button.textContent = 'Tools [I]';
    this.button.setAttribute('aria-controls', 'game-actions'); this.button.onclick = () => this.toggle();
    this.toolbar = game.root.querySelector('.context-row');
    this.toolbar.append(this.chart, this.button);
    this.help = new PlayerHelp(game, game.root.querySelector('.ship-console'));
    this.glanceButton = document.createElement('button'); this.glanceButton.id = 'navigation-glance'; this.glanceButton.textContent = 'Bearing [K]';
    this.glanceButton.onclick = () => this.toggleGlance(); this.toolbar.prepend(this.glanceButton);
    this.glance = document.createElement('aside'); this.glance.id = 'navigation-glance-panel'; this.glance.hidden = true;
    this.glance.setAttribute('aria-label', 'Navigation glance'); game.root.append(this.glance);
    this.glanceButton.setAttribute('aria-controls', this.glance.id);
    this.coarsePointer = matchMedia('(any-pointer: coarse)');
    const wake = () => this.wake();
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'wheel', 'focusin']) {
      window.addEventListener(type, wake, { capture: true, passive: true });
    }
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    this.coarsePointer.addEventListener('change', () => this.apply());
    this.toolbar.addEventListener('pointerenter', () => { this.hovered = true; this.wake(); });
    this.toolbar.addEventListener('pointerleave', () => { this.hovered = false; this.wake(); });
    this.apply();
  }
  wake() {
    this.lastActivity = performance.now();
    this.game.root.classList.remove('controls-idle');
  }
  toggleGlance() {
    this.glanceUntil = this.glance.hidden ? performance.now() + 7000 : 0;
    this.wake(); this.update(this.game.state);
  }
  updateIdle(world) {
    const g = this.game;
    const context = `${world.players[g.net.id]?.mode}:${world.mission}:${g.contextAction()}`;
    if (context !== this.context || !g.started || !g.net.ready || g.dialogOpen() ||
        !g.settings.values.immersive || this.open || g.settings.values.alwaysShowControls ||
        !this.help.root.hidden || this.coarsePointer.matches || this.hovered || this.toolbar.contains(document.activeElement) || g.keys.size) {
      this.wake();
    }
    this.context = context;
    g.root.classList.toggle('controls-idle', performance.now() - this.lastActivity >= 6000);
  }
  toggle() {
    this.open = !this.open; this.game.setLookout(false); this.apply();
    if (!this.open && this.game.root.contains(document.activeElement)) this.button.focus({ preventScroll: true });
  }
  apply() {
    this.wake();
    this.game.touch?.reset();
    const quiet = this.game.settings.values.immersive && !this.open;
    this.game.root.classList.toggle('quiet-play', quiet);
    const touch = this.coarsePointer.matches;
    this.button.textContent = quiet ? (touch ? 'Tools' : 'Tools [I]') : (touch ? 'Return to sea' : 'Return to sea [I]');
    this.chart.textContent = touch ? 'Chart' : 'Chart [N]';
    this.glanceButton.textContent = touch ? 'Bearing' : 'Bearing [K]';
    this.button.hidden = !this.game.settings.values.immersive;
    this.button.setAttribute('aria-expanded', String(!quiet));
    this.chart.hidden = !quiet;
    this.game.activities.button.textContent = quiet ? 'Activities' : 'Crew activities →';
    this.game.cameraSnap = true;
  }
  update(world) {
    this.help.update(world);
    this.updateIdle(world);
    const g = this.game, p = world.players[g.net.id], s = world.ship;
    if (!p) return;
    const target = courseTarget(world, g.net.id) || objectiveFor(world, g.net.id);
    this.glance.hidden = !g.started || g.dialogOpen() || performance.now() >= (this.glanceUntil || 0);
    this.glanceButton.setAttribute('aria-expanded', String(!this.glance.hidden));
    if (!this.glance.hidden) {
      const origin = p.mode === 'diver' ? p : s;
      const bearing = target ? ((Math.atan2(-(target.x - origin.x), target.z - origin.z) * 180 / Math.PI + 360) % 360) : 0;
      this.glance.textContent = target ? `${target.label} · ${Math.round(objectiveDistance(world, g.net.id, target))} m · ${Math.round(bearing).toString().padStart(3, '0')}° — ${courseTarget(world, g.net.id)?.hint || missionGuidance(world, g.net.id)?.text || target.hint}` : 'Archive delivered. Open the chart to choose another dive site.';
    }
    this.scout.hidden = g.lookout || g.contextAction() !== 'lookout'; this.scout.disabled = !g.net.ready;
    const recoveringHere = p.mode !== 'diver' && world.cargo.attached && !world.cargo.recovered && s.anchor && distance(s, world.cargo) < 34;
    const recovery = p.mode === 'winch' || recoveringHere ? recoveryStatus(world) : null;
    const station = nearbyDeckStation(world, g.net.id);
    const anchor = anchorStatus(s);
    let text = p.mode === 'helm' ? `${String(Math.round((-s.heading * 180 / Math.PI) % 360 + 360) % 360).padStart(3, '0')}° · ${(s.speed * 1.944).toFixed(1)} kn${s.anchor || anchor.moving ? ` · ${anchor.description}` : ''}` :
      p.mode === 'diver' ? `${Math.max(0, -p.y).toFixed(1)} m deep` : recovery ? `${recovery.text} · ${Math.round(recovery.progress * 100)}%` : station?.text || '';
    if (recoveringHere && p.mode !== 'winch') text = station?.text || recovery.text;
    if (p.mode === 'helm') {
      const divers = Object.values(world.players).filter(other => other.connected && other.mode === 'diver').length;
      if (divers) text += ` · ${divers} diver${divers === 1 ? '' : 's'} in water`;
    }
    if (g.lookout) text = '';
    if (p.mode === 'deck' && performance.now() < (g.boardingUntil || 0)) text = g.touch?.media.matches ? 'Back aboard · thumbstick to walk away from the ladder' : 'Back aboard · WASD to walk away from the ladder';
    const survey = surveyStatus(world, g.net.id);
    if (survey?.eligible && !survey.complete) text += ` · Survey ${Math.floor(survey.progress * 100)}%`;
    this.readout.textContent = text; this.readout.hidden = !text;
  }
}
