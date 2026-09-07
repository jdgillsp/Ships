import { U } from '../core/SharedUniforms.js';
import { smooth } from '../underwater/OceanDomain.js';

export function diveLampLevel(mode, diving, depth, daylight) {
  if (!diving || mode === 'off') return 0;
  if (mode === 'on') return 1;
  return Math.max(smooth(70, 230, depth), (1 - smooth(.08, .4, daylight)) * .8);
}

export function diveExposure(depth, night) {
  const deep = smooth(70, 350, depth);
  return { fixedExposure: 2.6 - deep * 1.1, fixedExposureMix: Math.max(deep, night * .98) };
}

export class DiveLight {
  constructor(game) {
    this.game = game; this.mode = 'auto'; this.level = 0;
    const post = game.app.post.settings;
    this.surfaceExposure = { fixedExposure: post.fixedExposure, fixedExposureMix: post.fixedExposureMix };
    this.button = document.createElement('button'); this.button.id = 'dive-light'; this.button.hidden = true;
    this.button.textContent = 'Light: auto [T]';
    this.button.title = 'Automatic light adapts to depth and daylight. Click or press T for On, Off, then Auto.';
    game.$('camera-view').after(this.button); this.button.onclick = () => this.cycle();
  }
  cycle() {
    const g = this.game;
    if (!g.started || g.dialogOpen() || g.state?.players[g.net.id]?.mode !== 'diver') return;
    this.mode = { auto: 'on', on: 'off', off: 'auto' }[this.mode];
    this.button.textContent = `Light: ${this.mode} [T]`;
    g.app.post.reset = true; g.app.underwater.shadowDirty = true;
  }
  update(dt = 1 / 60) {
    const g = this.game, diving = g.state?.players[g.net.id]?.mode === 'diver';
    const depth = Math.max(0, -g.app.camera.position.y);
    const target = diveLampLevel(this.mode, diving, depth, U.uDiveLight.value);
    this.level = !diving || this.mode !== 'auto' ? target : this.level + (target - this.level) * (1 - Math.exp(-Math.min(dt, .25) * 3));
    U.uLamp.value = this.level;
    // Match the explorer's exposure ceiling in dark water. Otherwise automatic
    // exposure lifts the narrow lamp beam until animals lose their markings.
    Object.assign(g.app.post.settings, diving ? diveExposure(depth, U.uDiveNight.value) : this.surfaceExposure);
  }
  updateUI(world) {
    const diving = world.players[this.game.net.id]?.mode === 'diver';
    this.button.hidden = !diving; this.game.$('camera-view').hidden = diving;
  }
}
