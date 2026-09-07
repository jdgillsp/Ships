import { availableActions, BASE, WRECK, distance } from './Simulation.js';
import { recoveryStatus, missionGuidance } from './Guidance.js';
import { courseTarget } from './VoyageSites.js';
import { surveyStatus, SURVEY_RADIUS, SURVEY_SECONDS } from './Survey.js';
import { dialogFocus } from './DialogFocus.js';
import { canCall, CALL_COOLDOWN } from './CrewCalls.js';
import { stationGuide } from './StationGuide.js';

export function crewActivityLabel(player) {
  if (!player.connected) return 'Reconnecting';
  if (player.mode === 'diver') return `${player.surveying ? 'Surveying' : 'Diving'} · ${Math.max(0, -player.y).toFixed(0)} m`;
  return { deck: 'On deck', helm: 'Captain', winch: 'Winch' }[player.mode] || 'Aboard';
}

export function crewActivities(world, id) {
  const p = world.players[id]; if (!p) return null;
  const actions = availableActions(world, id), can = action => actions.includes(action), diver = p.mode === 'diver';
  const captain = world.players[world.ship.pilot];
  const jobs = [
    { id: 'navigate', title: 'Plan the next dive', action: 'chart', button: 'Open voyage chart', enabled: true,
      detail: 'Choose from 15 habitats and share a course with the whole crew. The captain sees your waypoint.' },
    { id: 'lookout', title: 'Scout from the deck', action: p.mode === 'helm' ? 'leaveHelm' : p.mode === 'winch' ? 'leaveWinch' : 'lookout',
      button: p.mode === 'helm' ? 'Leave helm to scout' : p.mode === 'winch' ? 'Leave winch to scout' : 'Raise binoculars', enabled: !diver,
      detail: diver ? 'Climb aboard to use the binoculars. You can still mark what you see underwater with G.' : 'Walk to the bow, look for the survey buoy, and press G to mark it for your crewmates.' },
    { id: 'dive', title: diver ? 'Study marine life' : 'Join the dive team', action: diver ? 'study' : 'dive', button: diver ? 'Observe wildlife' : 'Enter the water', enabled: diver || can('dive'),
      detail: diver ? 'Identify an animal, then photograph it for your field journal. You can swim while observing and save your photographs to keep.' : can('dive') ? 'Swim freely, find the archive, or explore a plotted habitat. Space rises; Ctrl descends.' : 'The cutter is moving too fast. Ask the captain to slow below 4 knots before entering the water.' },
    { id: 'recover', title: 'Bring the archive aboard', action: diver ? (world.cargo.attached ? 'board' : 'attach') : p.mode === 'winch' ? 'leaveWinch' : 'winch',
      button: diver ? (world.cargo.attached ? 'Climb aboard' : 'Attach lifting cable') : p.mode === 'winch' ? 'Leave winch' : 'Operate winch',
      enabled: diver ? can(world.cargo.attached ? 'board' : 'attach') : can(p.mode === 'winch' ? 'leaveWinch' : 'winch'),
      detail: world.cargo.recovered ? 'The archive is secured on deck. Recover your divers and bring it home to Pelican Station.' : diver ? (world.cargo.attached ? 'The cable is attached. Ascend and swim alongside Kestrel to board; a crewmate can operate the winch.' : `Follow the archive signal. Attach within 5 m while Kestrel is anchored over the wreck. Archive: ${Math.round(Math.hypot(p.x - world.cargo.x, p.y - world.cargo.y, p.z - world.cargo.z))} m away.`) : !world.cargo.attached ? 'A diver must attach the cable first. Then an aboard crewmate can lift the archive with the winch.' : recoveryStatus(world).text }
  ];
  if (world.cargo.recovered) {
    Object.assign(jobs[3], world.mission === 'complete' ? { title: 'Archive delivered', action: 'chart', button: 'Choose another dive site', enabled: true,
      detail: 'Your crew brought the archive home. Keep sailing and discover another habitat together.' } : { title: 'Bring the archive home', action: 'deliver', button: 'Deliver archive', enabled: can('deliver'),
      detail: `${recoveryStatus(world).text}. ${Math.round(distance(world.ship, BASE))} m to Pelican Station; slow alongside to deliver the archive.` });
  }
  const course = courseTarget(world, id);
  const survey = surveyStatus(world, id);
  if (survey) {
    const { site, record, complete, progress, eligible } = survey;
    const active = Object.values(world.players).filter(p => p.connected && p.surveying).map(p => p.name);
    const detail = complete ? `Logged by ${record.contributors.map(c => c.name).join(' & ')}. Choose another habitat or stay and study its wildlife.` :
      `${Math.round(-site.y)} m deep · ${Math.round(course.distance)} m away. ${Math.floor(progress * 100)}% surveyed${active.length ? ` · ${active.join(' & ')} scanning` : ''}. ` +
      (diver ? `Swim within ${SURVEY_RADIUS} m of the signal and hold X or the survey button. ${SURVEY_SECONDS} seconds of combined diver effort logs the site; each teammate helps.` : can('dive') ? 'Sail close to the site, then dive to the underwater signal. Your crew can scan together; partial work is kept.' : 'Ask the captain to slow below 4 knots before diving. Your crew can scan together; partial work is kept.');
    jobs.unshift({ id: 'survey', title: `${complete ? 'Survey logged' : 'Survey together'}: ${site.name}`, detail,
      action: complete ? 'chart' : diver ? 'survey' : 'dive', button: complete ? 'Choose the next habitat' : diver ? (eligible ? 'Show survey controls' : 'Follow survey signal') : 'Enter water to survey',
      enabled: complete || diver || can('dive'), progress, complete });
  }
  let recommended = survey && !survey.complete && (diver || (course.distance < 32 && can('dive'))) ? 'survey' : world.cargo.attached && !world.cargo.recovered ? 'recover' : diver ? 'dive' : world.ship.anchor && (course ? course.distance < 32 : distance(world.ship, WRECK) < 32) ? 'dive' : captain && captain.id !== id ? 'lookout' : 'navigate';
  if (!course && world.mission !== 'complete') {
    const step = missionGuidance(world, id);
    const mission = { id: 'mission', ...step, detail: step.text, enabled: true };
    if (diver && !world.ship.anchor && distance(world.ship, world.cargo) < 32 && canCall(world, id, 'anchor')) mission.request = { kind: 'anchor', label: 'Ask crew to anchor' };
    if (diver && world.cargo.attached && !world.winch && canCall(world, id, 'winch')) mission.request = { kind: 'winch', label: 'Request winch operator' };
    jobs.unshift(mission); recommended = 'mission';
    const navigation = jobs.find(job => job.id === 'navigate'); navigation.title = 'Explore optional dive sites';
    navigation.detail = 'Take a detour to survey a habitat. Plotting a crew course replaces salvage guidance until you resume it.';
  }
  const aboardCrew = Object.values(world.players).some(other => other.connected && other.id !== id && other.mode !== 'diver');
  if (aboardCrew) {
    const diveJob = jobs.find(job => job.id === (survey && !survey.complete ? 'survey' : 'dive'));
    if (!diver && !can('dive') && captain?.id !== id) diveJob.request = { kind: 'slow', label: 'Ask crew to slow down' };
    const recoveryJob = jobs.find(job => job.id === 'recover');
    if (diver && !world.cargo.recovered) {
      if (world.cargo.attached && !world.winch) recoveryJob.request = { kind: 'winch', label: 'Request winch operator' };
      else if (!world.cargo.attached && !world.ship.anchor && distance(world.ship, world.cargo) < 32) recoveryJob.request = { kind: 'anchor', label: 'Ask crew to hold position' };
    }
  }
  return { jobs: jobs.map(job => ({ ...job, recommended: job.id === recommended && job.enabled })),
    intro: diver ? 'You’re on the dive team. Explore, study wildlife, or help recover the archive.' : captain && captain.id !== id ? `${captain.name} has the helm. You can scout, plan a course, or join the dive team.` : p.mode === 'helm' ? 'You’re steering Kestrel. Your crewmates can scout, plan courses, dive and recover the archive.' : 'Choose something to do aboard Kestrel. You can switch activities whenever you like.' };
}

export class CrewActivities {
  constructor(game) {
    this.game = game;
    this.button = document.createElement('button'); this.button.id = 'crew-activities'; this.button.textContent = 'Crew activities →'; this.button.setAttribute('aria-haspopup', 'dialog');
    game.root.querySelector('.context-row').append(this.button);
    this.dialog = document.createElement('dialog'); this.dialog.id = 'crew-activities-dialog'; this.dialog.setAttribute('aria-labelledby', 'activities-title'); this.dialog.setAttribute('aria-describedby', 'activities-intro');
    this.dialog.innerHTML = '<div class="activities-heading"><div><p class="eyebrow">KESTREL / EXPEDITION NOTES</p><h2 id="activities-title">Crew notebook</h2></div><button id="close-activities">Close</button></div><p id="activities-intro"></p><div class="activities-grid"></div><table id="activities-crew"><caption>Crew manifest</caption><thead><tr><th scope="col">Name</th><th scope="col">Current duty</th></tr></thead><tbody></tbody></table><div class="activities-footer"><button id="activities-journal">Open field journal</button></div><p id="activities-status" role="status"></p>';
    game.root.append(this.dialog); this.$ = id => this.dialog.querySelector(`#${id}`); this.cards = new Map();
    this.guide = document.createElement('details'); this.guide.id = 'activity-controls';
    this.guide.innerHTML = '<summary></summary><p>Close the notebook to use these controls.</p><dl></dl>';
    this.$('activities-intro').after(this.guide);
    for (const id of ['mission', 'survey', 'navigate', 'lookout', 'dive', 'recover']) {
      const card = document.createElement('article'); card.dataset.activity = id;
      const category = document.createElement('span'); category.className = 'activity-category';
      category.textContent = { mission: 'Current mission', survey: 'Survey', navigate: 'Navigation', lookout: 'Lookout', dive: 'Dive team', recover: 'Recovery' }[id];
      const badge = document.createElement('span'); badge.className = 'activity-suggestion'; badge.textContent = 'Suggested duty'; category.append(badge);
      const title = document.createElement('h3'), detail = document.createElement('p'), button = document.createElement('button');
      const meter = document.createElement('progress'); meter.max = 1; meter.setAttribute('aria-label', 'Shared survey progress'); meter.hidden = id !== 'survey';
      const request = document.createElement('button'); request.id = `activity-${id}-request`; request.className = 'activity-request'; request.hidden = true;
      button.id = `activity-${id}`; detail.id = `activity-${id}-detail`; button.setAttribute('aria-describedby', detail.id); request.setAttribute('aria-describedby', detail.id); card.append(category, title, meter, detail, button, request); this.dialog.querySelector('.activities-grid').append(card);
      button.onclick = () => this.run(id); request.onclick = () => this.request(id); this.cards.set(id, { card, badge, title, detail, button, meter, request });
    }
    this.button.onclick = () => this.show();
    this.$('close-activities').onclick = () => this.dialog.close();
    const restoreFocus = dialogFocus(game, this.dialog);
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return;
      // Opening already neutralizes movement. The queued close event must not
      // erase a fresh walking key pressed after the dialog disappears.
      this.scoutAfterRelease = false;
      const focusSurvey = this.focusSurvey; this.focusSurvey = false;
      if (game.dialogOpen()) return;
      if (focusSurvey) { game.survey.updateUI(game.state); if (!game.survey.button.disabled) { game.survey.button.focus({ preventScroll: true }); return; } }
      restoreFocus(this.button, game.hud.button);
    });
    this.$('activities-journal').onclick = () => { this.dialog.close(); game.naturalist.showJournal(); };
  }
  show() {
    const g = this.game; if (!g.started || g.dialogOpen()) return;
    g.setLookout(false); g.naturalist.toggle(false); g.keys.clear(); g.net.input({});
    this.$('activities-status').textContent = ''; this.dialog.showModal(); this.updateUI(g.state);
  }
  updateUI(world) {
    if (!this.dialog.open) return;
    if (this.scoutAfterRelease && world.players[this.game.net.id]?.mode === 'deck' && this.game.lastMode === 'deck' && this.game.net.ready) {
      this.scoutAfterRelease = false; this.dialog.close(); this.game.setLookout(true); return;
    }
    const model = crewActivities(world, this.game.net.id); if (!model) return;
    const mode = world.players[this.game.net.id].mode, touch = this.game.touch?.media.matches || false, guideKey = `${mode}:${touch}`;
    if (this.guideKey !== guideKey) {
      this.guideKey = guideKey; const guide = stationGuide(mode, touch);
      this.guide.querySelector('summary').textContent = `${guide.title} · controls`;
      this.guide.querySelector('dl').replaceChildren(...guide.rows.flatMap(([key, help]) => {
        const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = help; return [dt, dd];
      }));
    }
    this.$('activities-intro').textContent = model.intro;
    const crew = Object.values(world.players).filter(p => p.connected).map(p => ({ id: p.id, name: p.name, duty: crewActivityLabel(p) }));
    const crewKey = JSON.stringify(crew);
    if (this.crewKey !== crewKey) {
      this.crewKey = crewKey;
      this.$('activities-crew').querySelector('tbody').replaceChildren(...crew.map(p => {
        const row = document.createElement('tr'), name = document.createElement('th'), duty = document.createElement('td');
        name.scope = 'row'; name.textContent = p.name; duty.textContent = p.duty;
        if (p.id === this.game.net.id) { const self = document.createElement('small'); self.textContent = 'You'; name.append(' ', self); }
        row.append(name, duty); return row;
      }));
    }
    for (const [id, card] of this.cards) card.card.hidden = !model.jobs.some(job => job.id === id);
    for (const job of model.jobs) {
      const c = this.cards.get(job.id); c.title.textContent = job.title; c.detail.textContent = job.detail; c.button.textContent = job.button;
      if (job.id === 'survey') c.meter.value = job.progress;
      c.button.disabled = this.pending || this.scoutAfterRelease || !job.enabled || !this.game.net.ready || !!this.game.net.actionGuard?.(job.action); c.badge.hidden = !job.recommended; c.card.classList.toggle('recommended', job.recommended);
      c.request.hidden = !job.request;
      if (job.request) {
        const cooling = world.time - (world.players[this.game.net.id]?.lastCall ?? -Infinity) < CALL_COOLDOWN;
        c.request.textContent = cooling ? 'Call sent · wait a moment' : job.request.label;
        c.request.disabled = this.pending || !this.game.net.ready || cooling || !canCall(world, this.game.net.id, job.request.kind);
      }
    }
    if (!this.game.net.ready) { this.connectionMessage = true; this.$('activities-status').textContent = 'Waiting for the connection. Activities will return when you reconnect.'; }
    else if (this.connectionMessage) { this.connectionMessage = false; this.$('activities-status').textContent = ''; }
  }
  async request(id) {
    const g = this.game, request = crewActivities(g.state, g.net.id)?.jobs.find(job => job.id === id)?.request;
    if (!request || this.pending || !g.net.ready || !canCall(g.state, g.net.id, request.kind) ||
      g.state.time - (g.state.players[g.net.id]?.lastCall ?? -Infinity) < CALL_COOLDOWN) return;
    this.pending = true; this.$('activities-status').textContent = ''; this.updateUI(g.state);
    try {
      await g.net.action('crewCall', { kind: request.kind });
      this.$('activities-status').textContent = 'Request sent over the crew radio. Your crewmates can reply “On it”.';
    } catch (error) { this.$('activities-status').textContent = error.message; }
    finally { this.pending = false; this.updateUI(g.state); }
  }
  async run(id) {
    const g = this.game, job = crewActivities(g.state, g.net.id)?.jobs.find(j => j.id === id);
    if (!job?.enabled || !g.net.ready || this.pending) return;
    if (job.action === 'glance' || job.action === 'radio') {
      this.dialog.close();
      if (job.action === 'radio') g.radio.show();
      else { g.hud.glanceUntil = 0; g.hud.glance.hidden = true; g.hud.toggleGlance(); }
      return;
    }
    if (['chart', 'study', 'lookout', 'survey'].includes(job.action)) {
      this.focusSurvey = job.action === 'survey';
      this.dialog.close();
      if (job.action === 'survey') { g.crewTracking.id = ''; g.crewTracking.updateUI(g.state); }
      if (job.action === 'chart') g.voyage.show();
      if (job.action === 'study') g.naturalist.toggle(true);
      if (job.action === 'lookout') g.setLookout(true);
      return;
    }
    this.pending = true; this.scoutAfterRelease = id === 'lookout'; this.$('activities-status').textContent = ''; this.updateUI(g.state);
    try {
      await g.net.action(job.action);
      // Raise binoculars when the station release arrives in a snapshot; the
      // action response can arrive before the client knows it is on deck.
      if (job.action !== 'leaveHelm' && job.action !== 'leaveWinch') this.dialog.close();
    } catch (error) { this.scoutAfterRelease = false; this.$('activities-status').textContent = error.message; }
    finally { this.pending = false; this.updateUI(g.state); }
  }
}
