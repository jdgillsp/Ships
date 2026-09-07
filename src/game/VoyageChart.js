import { chartCoordinate, makeVoyageBackground } from './VoyageMap.js';
import { voyageSites, courseBearing } from './VoyageSites.js';
import { SURVEY_SECONDS } from './Survey.js';
import { dialogFocus } from './DialogFocus.js';

export class VoyageChart {
  constructor(game) {
    this.game = game; this.sites = voyageSites();
    this.button = document.createElement('button'); this.button.id = 'open-voyage'; this.button.textContent = 'Voyage chart [N]';
    this.button.title = 'Choose a habitat and plot a course for the crew.';
    game.root.querySelector('.chart-heading span').replaceWith(this.button); this.button.onclick = () => this.show();
    this.dialog = document.createElement('dialog'); this.dialog.id = 'voyage-chart'; this.dialog.setAttribute('aria-labelledby', 'voyage-title');
    this.dialog.innerHTML = `<div class="voyage-heading"><div><p class="eyebrow">KESTREL / NAVIGATION</p><h2 id="voyage-title">Voyage chart</h2></div><button id="close-voyage">Close</button></div>
      <p>Choose a dive site on the chart or in the list. Plot a course to share it with the crew.</p><p id="voyage-progress"></p>
      <div class="voyage-layout"><div><canvas id="voyage-map" width="640" height="640" aria-label="Seabed depth chart, numbered dive sites, crew course and cutter position"></canvas><div class="voyage-legend"><span>Reef</span><span>Kelp</span><span>Slope</span><span>Abyss</span></div><p class="voyage-map-note">Depth contours in metres · ▲ Kestrel · ● Diver</p><div class="voyage-route-key"><span>— Crew course</span><span>┄ Considering</span></div></div>
      <div class="voyage-details"><label for="voyage-destination">Dive destination</label><select id="voyage-destination"></select><h3 id="voyage-name"></h3><p id="voyage-description"></p><p id="voyage-range"></p><p id="voyage-depth"></p><p id="voyage-record"></p>
      <button id="plot-course">Plot crew course</button><button id="clear-course">Resume mission guidance</button><p id="voyage-status" role="status"></p></div></div>`;
    game.root.append(this.dialog); this.$ = id => this.dialog.querySelector(`#${id}`);
    this.select = this.$('voyage-destination');
    this.select.replaceChildren(...this.sites.map((s, i) => new Option(`${i + 1}. ${s.name}`, s.id)));
    this.select.onchange = () => this.updateUI(game.state);
    this.$('close-voyage').onclick = () => this.dialog.close();
    const restoreFocus = dialogFocus(game, this.dialog);
    this.dialog.addEventListener('close', () => restoreFocus(game.hud.chart, this.button, game.hud.button));
    this.$('plot-course').onclick = () => this.plot(this.select.value);
    this.$('clear-course').onclick = () => this.plot(null);
    this.$('voyage-map').onclick = e => {
      const r = e.target.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 640, y = (e.clientY - r.top) / r.height * 640;
      const nearest = this.sites.map(s => ({ s, d: Math.hypot(this.map(s.x) - x, this.map(s.z) - y) })).sort((a, b) => a.d - b.d)[0];
      if (nearest.d < 24) { this.select.value = nearest.s.id; this.updateUI(game.state); }
    };
    const explore = document.createElement('button'); explore.id = 'delivery-next-dive'; explore.textContent = 'Plan another dive';
    explore.onclick = () => { game.delivery.close(); this.show(); }; game.$('continue-sailing').after(explore);
  }
  map(v) { return chartCoordinate(v); }
  show() {
    const g = this.game; if (!g.started || g.dialogOpen()) return;
    g.setLookout(false); g.naturalist.toggle(false); g.keys.clear(); g.net.input({});
    this.select.value = g.state.course?.id || 'reef'; this.error = '';
    this.makeBackground(); this.dialog.showModal(); this.updateUI(g.state);
  }
  async plot(destination) {
    if (this.pending) return; this.pending = true; this.error = ''; this.updateUI(this.game.state);
    try { await this.game.net.action('course', { destination }); this.game.crewTracking.id = ''; this.dialog.close(); }
    catch (e) { this.error = e.message; }
    finally { this.pending = false; this.updateUI(this.game.state); }
  }
  makeBackground() {
    this.background ??= makeVoyageBackground();
  }
  updateUI(w) {
    if (!this.dialog.open) return;
    const site = this.sites.find(s => s.id === this.select.value), bearing = courseBearing(w.ship, site);
    const surveys = w.surveys || {}, completed = Object.values(surveys).filter(s => s.completedAt != null).length, record = surveys[site.id];
    this.$('voyage-progress').textContent = w.surveys ? `Survey log · ${completed} of ${this.sites.length} sites recorded` : '';
    this.$('voyage-record').textContent = record?.completedAt != null ? `✓ Surveyed by ${record.contributors.map(c => c.name).join(' & ')} · ${Math.floor(record.completedAt / 60)} min ${Math.floor(record.completedAt % 60)} sec at sea` : record?.seconds ? `Survey in progress · ${Math.floor(record.seconds / SURVEY_SECONDS * 100)}% · return to the dive signal and hold X to continue.` : w.surveys ? `Unsurveyed · Dive to the signal and hold X to survey (${SURVEY_SECONDS} seconds; quicker with more divers).` : '';
    for (const [i, s] of this.sites.entries()) { const text = `${surveys[s.id]?.completedAt != null ? '✓ ' : ''}${i + 1}. ${s.name}`; if (this.select.options[i].text !== text) this.select.options[i].text = text; }
    this.$('voyage-name').textContent = site.name; this.$('voyage-description').textContent = site.description;
    this.$('voyage-range').textContent = `${Math.round(Math.hypot(site.x - w.ship.x, site.z - w.ship.z))} m to sail · ${bearing.toString().padStart(3, '0')}°`;
    this.$('voyage-depth').textContent = `${Math.round(-site.y).toLocaleString()} m dive · ${site.biome === 'deep' ? 'Long descent into darkness' : site.biome === 'blue' ? 'Beyond the sunlit shelf' : 'Sunlit shelf habitat'}`;
    const supported = Object.hasOwn(w, 'course');
    this.$('plot-course').disabled = this.pending || !this.game.net.ready || !supported;
    this.$('clear-course').disabled = this.pending || !this.game.net.ready || !w.course;
    this.$('voyage-status').textContent = this.error || (!supported ? 'Crew navigation is unavailable on this server.' : w.course ? `Crew course: ${this.sites.find(s => s.id === w.course.id)?.name || 'a dive site'} · plotted by ${w.players[w.course.owner]?.name || 'crew'}.${w.course.id !== site.id ? ' Plot to change course.' : ''}` : 'Following the salvage mission. Plot to set a dive destination.');
    const c = this.$('voyage-map').getContext('2d'); c.drawImage(this.background, 0, 0);
    const course = this.sites.find(s => s.id === w.course?.id);
    const route = (target, preview) => {
      c.strokeStyle = preview ? '#8b5938' : '#264e43'; c.lineWidth = 2.5; c.setLineDash(preview ? [5, 7] : []);
      c.beginPath(); c.moveTo(this.map(w.ship.x), this.map(w.ship.z)); c.lineTo(this.map(target.x), this.map(target.z)); c.stroke(); c.setLineDash([]);
    };
    if (course) route(course, false);
    if (course?.id !== site.id) route(site, true);
    for (const [i, s] of this.sites.entries()) {
      const active = s.id === site.id, x = this.map(s.x), y = this.map(s.z);
      const surveyed = surveys[s.id]?.completedAt != null;
      if (s.id === course?.id) { c.beginPath(); c.arc(x, y, 17, 0, Math.PI * 2); c.strokeStyle = '#264e43'; c.lineWidth = 2; c.stroke(); }
      c.beginPath(); c.arc(x, y, active ? 13 : 10, 0, Math.PI * 2); c.fillStyle = active ? '#86532e' : surveyed ? '#476b58' : '#eae5d0'; c.fill(); c.strokeStyle = '#365648'; c.lineWidth = surveyed ? 2.5 : 1; c.stroke();
      c.fillStyle = active || surveyed ? '#fff7e2' : '#233e34'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '12px system-ui'; c.fillText(String(i + 1), x, y);
    }
    const x = this.map(w.ship.x), y = this.map(w.ship.z); c.save(); c.translate(x, y); c.rotate(-w.ship.heading);
    c.fillStyle = '#233e34'; c.beginPath(); c.moveTo(0, -11); c.lineTo(6, 8); c.lineTo(0, 5); c.lineTo(-6, 8); c.closePath(); c.fill(); c.strokeStyle = '#fff4d8'; c.lineWidth = 1.5; c.stroke(); c.restore();
    for (const p of Object.values(w.players).filter(p => p.connected && p.mode === 'diver')) { c.fillStyle = '#8c4e31'; c.beginPath(); c.arc(this.map(p.x), this.map(p.z), 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff4d8'; c.lineWidth = 1; c.stroke(); }
  }
}
