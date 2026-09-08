import { researchExperienceText } from './ResearchExperience.js';
import { voyageSites } from './VoyageSites.js';
import { researchSite, researchReady, researchHarborReason } from './ResearchVoyages.js';

export class ResearchJobs {
  constructor(game, activities) {
    this.game = game; this.activities = activities;
    this.root = document.createElement('section'); this.root.id = 'research-jobs';
    this.root.innerHTML = '<h3>Pelican research requests</h3><p id="research-brief"></p><div id="research-choice"><label for="research-site">Habitat to survey</label><select id="research-site"></select><p id="research-depth"></p><button id="accept-research">Accept research request</button></div><div id="research-current"><button id="plot-research">Plot research course</button><button id="file-research">File research report</button><button id="set-aside-research">Set aside request at harbor</button></div><p id="research-status" role="status"></p><p id="research-receipt"></p><p id="research-experience"></p>';
    activities.$('activities-crew').before(this.root); this.$ = id => this.root.querySelector(`#${id}`);
    this.$('research-site').onchange = () => this.update(game.state);
    this.$('accept-research').onclick = () => this.send('acceptResearch', { destination: this.$('research-site').value }, true);
    this.$('file-research').onclick = () => this.send('fileResearch');
    this.$('set-aside-research').onclick = () => this.send('setAsideResearch');
    this.$('plot-research').onclick = () => this.send('course', { destination: researchReady(game.state) ? 'pelican-station' : game.state.research.site }, true);
  }
  async send(action, data = {}, close = false) {
    if (this.pending) return; this.pending = true; this.error = ''; this.update(this.game.state);
    try { await this.game.net.action(action, data); if (close) this.activities.dialog.close(); }
    catch (e) { this.error = e.message; }
    finally { this.pending = false; this.update(this.game.state); }
  }
  update(w) {
    this.root.hidden = w.mission !== 'complete'; if (this.root.hidden) return;
    const active = !!w.research, ready = researchReady(w), reason = researchHarborReason(w, this.game.net.id), blocked = this.pending || !this.game.net.ready;
    const sites = voyageSites({ seed: w.seed }), available = sites.filter(s => w.surveys?.[s.id]?.completedAt == null), select = this.$('research-site');
    const key = available.map(s => s.id).join(',');
    if (this.key !== key) { const chosen = select.value; this.key = key; select.replaceChildren(...available.map(s => new Option(s.name, s.id))); if (available.some(s => s.id === chosen)) select.value = chosen; }
    const site = active ? researchSite(w) : available.find(s => s.id === select.value);
    this.$('research-choice').hidden = active; this.$('research-current').hidden = !active;
    this.$('research-brief').textContent = active ? `${site.name} · ${ready ? 'Survey complete. Recover the dive team and bring the findings to Pelican Station.' : 'Survey the habitat, then return with the whole crew to file the report. Partial survey work is kept.'}` : 'Choose a habitat Pelican Station needs surveyed. Sail, dive and survey together, then bring the findings home.';
    this.$('research-depth').textContent = site ? `${Math.round(-site.y)} m dive · ${Math.round(Math.hypot(site.x - w.ship.x, site.z - w.ship.z))} m to sail` : 'Every habitat has been surveyed. Your reports and discoveries remain in the voyage log.';
    select.disabled = !!blocked; this.$('accept-research').disabled = !!blocked || !!reason || !site;
    this.$('plot-research').disabled = !!blocked; this.$('plot-research').textContent = ready ? 'Plot a course home' : 'Plot research course';
    this.$('file-research').disabled = !!blocked || !!reason || !ready;
    this.$('set-aside-research').disabled = !!blocked || !!reason;
    this.$('research-status').textContent = this.error || reason || (active ? ready ? 'Ready to file the completed report.' : 'The survey is still needed. You can set aside the request here without losing discoveries.' : site ? 'Ready to accept a research request. Its course will be shared with the crew.' : '');
    const last = w.researchHistory?.at(-1);
    this.$('research-experience').textContent = researchExperienceText(last);
    this.$('research-receipt').textContent = last ? `${last.status === 'filed' ? 'Report received' : 'Request set aside'}: ${sites.find(s => s.id === last.site).name} · ${last.finishedBy}${last.status === 'filed' ? ` · Survey team: ${last.contributors.join(' & ')}` : ''}. Kept in the voyage log.` : '';
  }
}
