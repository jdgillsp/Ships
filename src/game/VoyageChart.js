import { pickupDiver } from './PickupCourse.js';
import { researchReady } from './ResearchVoyages.js';
import { chartCoordinate, makeVoyageBackground } from './VoyageMap.js';
import { voyageSites, voyageDestinations, courseBearing } from './VoyageSites.js';
import { SavedPlaceControls } from './SavedPlaceControls.js';
import { DivePlanner } from './WeatherOutlook.js';
import { PlaceNotebook } from './PlaceNotebook.js';
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
      <p>Choose a habitat or saved place on the chart or in the list. Plot a course to share it with the crew.</p><p id="voyage-progress"></p>
      <div class="voyage-layout"><div><canvas id="voyage-map" width="640" height="640" aria-label="Seabed depth chart, numbered dive sites, crew course and cutter position"></canvas><div class="voyage-legend"><span>Reef</span><span>Kelp</span><span>Slope</span><span>Abyss</span></div><p class="voyage-map-note">Depth contours in metres · ▲ Kestrel · ● Diver</p><div class="voyage-route-key"><span>— Crew course</span><span>┄ Considering</span></div></div>
      <div class="voyage-details"><label for="voyage-destination">Dive destination</label><select id="voyage-destination"></select><h3 id="voyage-name"></h3><p id="voyage-description"></p><p id="voyage-range"></p><p id="voyage-depth"></p><p id="voyage-record"></p>
      <button id="plot-course">Plot crew course</button><button id="clear-course">Resume mission guidance</button><p id="voyage-status" role="status"></p></div></div>`;
    game.root.append(this.dialog); this.$ = id => this.dialog.querySelector(`#${id}`);
    this.select = this.$('voyage-destination');
    this.select.replaceChildren(...this.sites.map((s, i) => new Option(`${i + 1}. ${s.name}`, s.id)));
    this.select.onchange = () => this.updateUI(game.state);
    const salvage = document.createElement('button'); salvage.id = 'plan-salvage'; salvage.textContent = 'Plan current salvage';
    this.select.before(salvage);
    salvage.onclick = () => { this.select.value = game.state.research ? (researchReady(game.state) ? 'pelican-station' : game.state.research.site) : 'salvage-active'; this.updateUI(game.state); };
    const home = document.createElement('button'); home.id = 'plan-home'; home.textContent = 'Plan a course home';
    salvage.after(home); home.onclick = () => { this.select.value = 'pelican-station'; this.updateUI(game.state); };
    this.$('close-voyage').onclick = () => this.dialog.close();
    const restoreFocus = dialogFocus(game, this.dialog);
    this.dialog.addEventListener('close', () => restoreFocus(game.hud.chart, this.button, game.hud.button));
    this.$('plot-course').onclick = () => this.plot(this.select.value);
    this.$('clear-course').onclick = () => this.plot(null, !!game.state.pickup);
    this.$('voyage-map').onclick = e => {
      const r = e.target.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 640, y = (e.clientY - r.top) / r.height * 640;
      const nearest = this.sites.map(s => ({ s, d: Math.hypot(this.map(s.x) - x, this.map(s.z) - y) })).sort((a, b) => a.d - b.d)[0];
      if (nearest.d < 24) { this.select.value = nearest.s.id; this.updateUI(game.state); }
    };
    const explore = document.createElement('button'); explore.id = 'delivery-next-dive'; explore.textContent = 'Plan another dive';
    explore.onclick = () => { game.delivery.close(); this.show(); }; game.$('continue-sailing').after(explore);
    this.savedPlaces = new SavedPlaceControls(this);
    this.planner = new DivePlanner(this);
    this.placeNotebook = new PlaceNotebook(this);
  }
  refreshSites(w) {
    const sites = voyageDestinations(w), signature = JSON.stringify(sites.map(s => [s.id, s.name]));
    this.sites = sites;
    if (signature === this.sitesSignature) return;
    const selected = this.select.value; this.sitesSignature = signature; this.sites = sites;
    this.select.replaceChildren(...sites.map((s, i) => new Option(`${i + 1}. ${s.name}`, s.id)));
    this.select.value = sites.some(s => s.id === selected) ? selected : 'reef';
  }
  map(v) { return chartCoordinate(v); }
  show() {
    const g = this.game; if (!g.started || g.dialogOpen()) return;
    g.setLookout(false); g.naturalist.toggle(false); g.keys.clear(); g.net.input({});
    this.refreshSites(g.state);
    this.select.value = g.state.course?.id || (g.state.research ? (researchReady(g.state) ? 'pelican-station' : g.state.research.site) : 'reef'); this.error = '';
    this.makeBackground(); this.dialog.showModal(); this.updateUI(g.state);
  }
  async plot(destination, cancelPickup = false) {
    if (this.pending) return; this.pending = true; this.error = ''; this.updateUI(this.game.state);
    try { await this.game.net.action(cancelPickup ? 'cancelPickup' : 'course', { destination }); this.game.crewTracking.id = ''; this.dialog.close(); }
    catch (e) { this.error = e.message; }
    finally { this.pending = false; this.updateUI(this.game.state); }
  }
  makeBackground() {
    this.background ??= makeVoyageBackground();
  }
  updateUI(w) {
    if (!this.dialog.open) return;
    this.refreshSites(w); this.savedPlaces.update(w); this.placeNotebook.update(w);
    const site = this.sites.find(s => s.id === this.select.value), bearing = courseBearing(w.ship, site);
    this.planner.update(w, site);
    const surveys = w.surveys || {}, completed = Object.values(surveys).filter(s => s.completedAt != null).length, record = surveys[site.id];
    this.$('voyage-progress').textContent = w.surveys ? `Survey log · ${completed} of ${voyageSites({ seed: w.seed }).length} sites recorded` : '';
    this.$('voyage-record').textContent = record?.completedAt != null ? `✓ Surveyed by ${record.contributors.map(c => c.name).join(' & ')} · ${Math.floor(record.completedAt / 60)} min ${Math.floor(record.completedAt % 60)} sec at sea` : record?.seconds ? `Survey in progress · ${Math.floor(record.seconds / SURVEY_SECONDS * 100)}% · return to the dive signal and hold X to continue.` : w.surveys ? `Unsurveyed · Dive to the signal and hold X to survey (${SURVEY_SECONDS} seconds; quicker with more divers).` : '';
    for (const [i, s] of this.sites.entries()) { const text = `${surveys[s.id]?.completedAt != null ? '✓ ' : ''}${i + 1}. ${s.name}`; if (this.select.options[i].text !== text) this.select.options[i].text = text; }
    this.$('voyage-name').textContent = site.name; this.$('voyage-description').textContent = site.description;
    this.$('voyage-range').textContent = `${Math.round(Math.hypot(site.x - w.ship.x, site.z - w.ship.z))} m to sail · ${bearing.toString().padStart(3, '0')}°`;
    this.$('voyage-depth').textContent = `${Math.round(-site.y).toLocaleString()} m dive · ${site.biome === 'deep' ? 'Long descent into darkness' : site.biome === 'blue' ? 'Beyond the sunlit shelf' : 'Sunlit shelf habitat'}`;
    if (site.biome === 'saved') {
      this.$('voyage-depth').textContent = site.y < -2 ? `${Math.round(-site.y)} m deep · Marked underwater location` : 'Surface location';
      this.$('voyage-record').textContent = 'Crew-saved place · explore freely here. Habitat surveys appear only at established survey sites.';
    }
    if (site.biome === 'salvage') {
      this.$('voyage-depth').textContent = `${Math.round(-site.y)} m recovery · Assigned wreck`;
      this.$('voyage-record').textContent = w.cargo.recovered ? 'Archive recovered. Resume mission guidance for the next step.' : w.cargo.attached ? 'Cable attached. Return aboard and operate the winch while anchored.' : 'Anchor within 32 m of the archive. Dive and attach the cable within 5 m. The salvage course switches to boarding and recovery guidance when attached.';
    }
    if (site.biome === 'harbor') {
      this.$('voyage-depth').textContent = 'Home station · Surface destination';
      const divers = Object.values(w.players).filter(p => p.connected && p.mode === 'diver').length;
      this.$('voyage-record').textContent = divers ? `${divers} ${divers === 1 ? 'diver is' : 'divers are'} still in the water. Bring the crew aboard before departure.` : 'Crew aboard. Approach slowly and anchor beside Pelican Station.';
    }
    if (site.biome === 'wreck') {
      const discovery = w.wreckDiscoveries[site.wreckId];
      this.$('voyage-depth').textContent = `${Math.round(-site.y)} m dive · Explored wreck`;
      this.$('voyage-record').textContent = `First explored by ${discovery.crew.join(' & ')} · Expedition ${discovery.expedition}. Kept in the shared voyage log.`;
    }
    this.$('plan-salvage').textContent = w.research ? (researchReady(w) ? 'Plan research return' : 'Plan research dive') : 'Plan current salvage';
    this.$('clear-course').textContent = w.pickup ? 'End pickup · resume course' : w.research ? 'Resume research guidance' : 'Resume mission guidance';
    const supported = Object.hasOwn(w, 'course');
    this.$('plot-course').disabled = this.pending || !this.game.net.ready || !supported;
    this.$('clear-course').disabled = this.pending || !this.game.net.ready || (!w.course && !w.pickup);
    this.$('voyage-status').textContent = this.error || (pickupDiver(w) ? `Live pickup: ${pickupDiver(w).name}. The previous plotted course is kept. Slow and hold position for boarding.` : !supported ? 'Crew navigation is unavailable on this server.' : w.course ? `Crew course: ${this.sites.find(s => s.id === w.course.id)?.name || 'a dive site'} · plotted by ${w.players[w.course.owner]?.name || 'crew'}.${w.course.id !== site.id ? ' Plot to change course.' : ''}` : w.research ? 'Following the research request. Plot a course to take a detour.' : 'Following the salvage mission. Plot to set a dive destination.');
    const c = this.$('voyage-map').getContext('2d'); c.drawImage(this.background, 0, 0);
    const course = pickupDiver(w) || this.sites.find(s => s.id === w.course?.id);
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
