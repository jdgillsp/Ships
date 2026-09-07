import { autoDetectPreset } from '../core/Quality.js';

const storageKey = 'abyssal:expedition-settings';
const graphicsModes = ['auto', 'potato', 'low', 'medium', 'high', 'ultra'];
export function normalizeSettings(value = {}) {
  const bounded = (v, lo, hi, fallback) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  const view = (role, fallback) => ['deck', 'chase'].includes(value?.views?.[role]) ? value.views[role] : fallback;
  return { graphics: graphicsModes.includes(value?.graphics) ? value.graphics : 'auto',
    sensitivity: bounded(value?.sensitivity, .35, 2.5, 1), invertY: value?.invertY === true, volume: bounded(value?.volume, 0, 1, .5), interface: value?.interface === 'compact' ? 'compact' : 'full', immersive: value?.immersive !== false,
    alwaysShowControls: value?.alwaysShowControls === true,
    textScale: bounded(value?.textScale, 1, 2, 1), readablePanels: value?.readablePanels === true,
    views: { deck: view('deck', 'deck'), helm: view('helm', 'chase'), winch: view('winch', 'deck') } };
}

export class GameSettings {
  constructor(game) {
    this.game = game;
    let saved; try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { saved = {}; }
    this.values = normalizeSettings(saved);
    const app = game.app;
    if (app.params.has('preset') || app.params.has('adaptive')) this.values.graphics = app.quality.adaptive ? 'auto' : app.quality.presetName;
    else this.applyGraphics();
    game.sound.ambient.volume = this.values.volume;
    this.button = document.createElement('button'); this.button.id = 'game-settings'; this.button.textContent = 'Settings';
    game.$('invite').before(this.button);
    this.dialog = document.createElement('dialog'); this.dialog.id = 'settings-dialog'; this.dialog.setAttribute('aria-labelledby', 'settings-title');
    this.dialog.innerHTML = `<div class="settings-heading"><h2 id="settings-title">Settings & controls</h2><button id="close-settings" aria-label="Close settings">Close</button></div>
      <p>Make the ocean comfortable to explore. Your crew keeps sailing while this panel is open.</p>
      <label for="ui-text-scale">Interface text size <output id="text-scale-value"></output></label><input id="ui-text-scale" type="range" min="1" max="2" step="0.1" aria-describedby="text-scale-help"><p id="text-scale-help" class="setting-note">Enlarge labels, instructions and menus. Panels scroll to keep their controls reachable.</p><label class="check-setting"><input id="readable-panels" type="checkbox"> Solid backgrounds behind instruments</label><label for="graphics-quality">Graphics quality</label><select id="graphics-quality"><option value="auto">Automatic — balance detail and smoothness</option><option value="potato">Minimum — for slower devices</option><option value="low">Performance</option><option value="medium">Balanced</option><option value="high">High detail</option><option value="ultra">Maximum detail</option></select>
      <label class="check-setting"><input id="immersive-view" type="checkbox"> Immersive play view</label><label for="interface-density">Tools panel detail</label><select id="interface-density" aria-describedby="interface-help"><option value="full">Full — chart and detailed guidance</option><option value="compact">Compact — more room for the ocean</option></select><p id="interface-help" class="setting-note">I opens or closes ship tools in the immersive view. N opens the chart; Activities offers crew jobs.</p>
      <label class="check-setting"><input id="always-show-controls" type="checkbox" aria-describedby="idle-controls-help"> Always show controls</label><p id="idle-controls-help" class="setting-note">In immersive view, Activities, Chart and Tools fade after a pause. Move the pointer or press a key to show them. Touch controls stay visible.</p>
      <label for="camera-sensitivity">Look sensitivity <output id="sensitivity-value"></output></label><input id="camera-sensitivity" type="range" min="0.35" max="2.5" step="0.05" aria-describedby="sensitivity-help"><p id="sensitivity-help" class="setting-note">Adjust dragging and keyboard turning. Magnified views turn more slowly for precise aiming.</p>
      <label class="check-setting"><input id="invert-look" type="checkbox"> Invert vertical look</label>
      <label for="game-volume">Sound volume <output id="volume-value"></output></label><input id="game-volume" type="range" min="0" max="1" step="0.05"><p class="setting-note">Enable Sound in the top bar to hear the ocean.</p>
      <h3>On deck, at the helm, underwater</h3><dl class="control-guide"><dt>? / K</dt><dd>Show current controls / glance at destination, bearing and next step</dd><dt>WASD</dt><dd>Walk on deck, steer at the helm, swim underwater</dd><dt>Arrow keys</dt><dd>Walk on deck or steer at the helm. Underwater: ↑ / ↓ swim, ← / → look.</dd><dt>Tab / Space / Enter</dt><dd>Focus and activate buttons. Clicking a control returns to movement.</dd><dt>Drag / scroll</dt><dd>Look around / zoom the follow view, binoculars, or wildlife observation</dd><dt>F</dt><dd>Use the highlighted action</dd><dt>H</dt><dd>Take or leave the helm</dd><dt>B / V / R</dt><dd>Anchor / enter water / operate winch</dd><dt>Space / Ctrl</dt><dd>Ascend / descend underwater</dd><dt>C / Home</dt><dd>Change view / reset camera</dd><dt>L / Esc</dt><dd>Raise binoculars on deck / lower them</dd><dt>G / chart click</dt><dd>Mark a location for the whole crew</dd></dl>`;
    game.root.append(this.dialog);
    const journal = document.createElement('button'); journal.textContent = 'Open field journal [J]';
    journal.onclick = () => { this.dialog.close(); game.naturalist.showJournal(); };
    this.dialog.append(journal);
    const observeKey = document.createElement('dt'), observeHelp = document.createElement('dd');
    observeKey.textContent = 'O / P / J'; observeHelp.textContent = 'Observe wildlife while diving / photograph the identified animal / open field journal';
    this.dialog.querySelector('.control-guide').append(observeKey, observeHelp);
    const lightKey = document.createElement('dt'), lightHelp = document.createElement('dd');
    lightKey.textContent = 'T'; lightHelp.textContent = 'Cycle dive light: Automatic, On, Off';
    this.dialog.querySelector('.control-guide').append(lightKey, lightHelp);
    const chartKey = document.createElement('dt'), chartHelp = document.createElement('dd');
    chartKey.textContent = 'N'; chartHelp.textContent = 'Open the voyage chart and plot a crew course';
    this.dialog.querySelector('.control-guide').append(chartKey, chartHelp);
    const surveyKey = document.createElement('dt'), surveyHelp = document.createElement('dd');
    surveyKey.textContent = 'Hold X'; surveyHelp.textContent = 'Survey a plotted habitat while diving near its signal; teammates can help';
    this.dialog.querySelector('.control-guide').append(surveyKey, surveyHelp);
    const cameraNote = document.createElement('p'); cameraNote.className = 'setting-note'; cameraNote.textContent = 'Your chosen view is remembered separately for deck, helm and winch. Home recenters your current view.'; this.dialog.append(cameraNote);
    const turnKey = document.createElement('dt'), turnHelp = document.createElement('dd'); turnKey.textContent = 'Q / E'; turnHelp.textContent = 'Turn your view left / right in first person, underwater or through binoculars.'; this.dialog.querySelector('.control-guide').append(turnKey, turnHelp);
    this.$ = id => this.dialog.querySelector(`#${id}`);
    this.$('graphics-quality').value = this.values.graphics;
    this.applyInterface();
    this.$('ui-text-scale').value = this.values.textScale;
    this.$('readable-panels').checked = this.values.readablePanels;
    this.$('camera-sensitivity').value = this.values.sensitivity;
    this.$('invert-look').checked = this.values.invertY;
    this.$('immersive-view').checked = this.values.immersive;
    this.$('always-show-controls').checked = this.values.alwaysShowControls;
    this.$('game-volume').value = this.values.volume;
    this.showValues();
    this.button.onclick = () => { game.setLookout(false); game.keys.clear(); game.net.input({}); this.dialog.showModal(); };
    this.$('close-settings').onclick = () => this.dialog.close();
    this.$('ui-text-scale').oninput = e => { this.values.textScale = Number(e.target.value); this.applyInterface(); this.save(); };
    this.$('readable-panels').onchange = e => { this.values.readablePanels = e.target.checked; this.applyInterface(); this.save(); };
    this.$('graphics-quality').onchange = e => { this.values.graphics = e.target.value; this.applyGraphics(); this.save(); };
    this.$('interface-density').onchange = e => { this.values.interface = e.target.value; this.applyInterface(); this.save(); };
    this.$('immersive-view').onchange = e => { this.values.immersive = e.target.checked; this.game.hud.open = false; this.game.hud.apply(); this.save(); };
    this.$('always-show-controls').onchange = e => { this.values.alwaysShowControls = e.target.checked; this.game.hud.wake(); this.save(); };
    this.$('camera-sensitivity').oninput = e => { this.values.sensitivity = Number(e.target.value); this.save(); };
    this.$('invert-look').onchange = e => { this.values.invertY = e.target.checked; this.save(); };
    this.$('game-volume').oninput = e => { this.values.volume = Number(e.target.value); game.sound.ambient.volume = this.values.volume; this.save(); };
  }
  applyGraphics() {
    const app = this.game.app, automatic = this.values.graphics === 'auto';
    app.quality.adaptive = automatic;
    app.setQualityPreset(automatic ? autoDetectPreset(app.caps.renderer) : this.values.graphics);
    // Keep a copied URL honest about a user's explicit graphics choice.
    const url = new URL(location.href);
    if (automatic) { url.searchParams.delete('preset'); url.searchParams.delete('adaptive'); }
    else { url.searchParams.set('preset', this.values.graphics); url.searchParams.set('adaptive', '0'); }
    history.replaceState(null, '', url);
  }
  applyInterface() {
    this.game.root.style.setProperty('--ui-text-scale', this.values.textScale);
    this.game.root.classList.toggle('readable-panels', this.values.readablePanels);
    this.game.root.classList.toggle('large-text', this.values.textScale >= 1.5);
    this.game.root.classList.toggle('compact-interface', this.values.interface === 'compact');
    this.$('interface-density').value = this.values.interface;
    this.game.cameraSnap = true;
    this.game.hud?.apply();
  }
  toggleInterface() {
    if (this.values.immersive) { this.game.hud.toggle(); return; }
    this.values.interface = this.values.interface === 'compact' ? 'full' : 'compact';
    this.applyInterface(); this.save();
  }
  showValues() { this.$('text-scale-value').value = `${Math.round(this.values.textScale * 100)}%`; this.$('sensitivity-value').value = `${this.values.sensitivity.toFixed(2)}×`; this.$('volume-value').value = `${Math.round(this.values.volume * 100)}%`; }
  save() { this.showValues(); try { localStorage.setItem(storageKey, JSON.stringify(this.values)); } catch {} }
}
