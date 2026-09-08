import { researchExperienceText } from './ResearchExperience.js';
import { voyageSites } from './VoyageSites.js';
import { activeSalvage } from './SalvageSites.js';
import { CrewLogComposer } from './CrewLog.js';
import { wreckName } from './WreckDiscoveries.js';
import { FIELD_NOTES } from '../underwater/FieldNotes.js';

const TITLES = { departed: 'Left Pelican Station', wreck: 'Located the survey wreck', attached: 'Attached the archive cable', recovered: 'Secured the archive aboard' };

export function recordMilestone(world, kind, people = []) {
  if (!Object.hasOwn(TITLES, kind)) return;
  world.milestones ??= {};
  if (Object.hasOwn(world.milestones, kind)) return;
  world.milestones[kind] = { time: world.time, crew: people.filter(Boolean).map(p => p.name).slice(0, 4) };
  world.revision++;
}

export function validMilestones(world) {
  const records = world.milestones;
  return records === undefined || (!!records && typeof records === 'object' && !Array.isArray(records) &&
    Object.entries(records).every(([kind, r]) => Object.hasOwn(TITLES, kind) && r && Number.isFinite(r.time) &&
      r.time >= 0 && r.time <= world.time && Array.isArray(r.crew) && r.crew.length <= 4 &&
      r.crew.every(name => typeof name === 'string' && name.length <= 20)));
}

export function voyageEntries(world) {
  const expedition = world.contract;
  const site = activeSalvage(world);
  const entries = Object.entries(world.milestones || {}).map(([kind, r]) => ({
    id: kind, time: r.time, title: TITLES[kind], detail: r.crew.length ? r.crew.join(' & ') : 'Crew milestone'
  }));
  if (expedition && Number.isFinite(expedition.startedAt)) entries.unshift({ id: 'accepted', time: expedition.startedAt,
    title: 'Accepted the next salvage expedition', detail: `${site.name} · ${Math.round(-site.cargo.y)} m recovery` });
  if (world.delivery) entries.push({ id: 'delivery', time: world.delivery.time, title: 'Delivered the archive at Pelican Station',
    detail: `Brought ashore by ${world.delivery.receivedFrom} · Crew: ${world.delivery.crew.join(', ')} · ${voyageTime(world.delivery.duration ?? world.delivery.time)} to delivery` });
  if (expedition) for (const entry of entries) {
    entry.title = `Expedition ${expedition.number} · ${entry.title}`;
    if (entry.id !== 'accepted') entry.detail = `${site.name} · ${entry.detail}`;
  }
  for (const place of Object.values(world.places || {})) entries.push({ id: place.id, time: place.time,
    title: `Charted ${place.name}`, detail: `${place.savedBy} · ${place.y < -2 ? `${Math.round(-place.y)} m deep` : 'Surface location'}${place.note ? ` · Crew note: ${place.note}` : ''}` });
  for (const site of voyageSites({ seed: world.seed })) {
    const r = world.surveys?.[site.id];
    if (r?.completedAt != null) entries.push({ id: `survey-${site.id}`, time: r.completedAt,
      title: `Surveyed ${site.name}`, detail: `${Math.round(-site.y)} m deep · ${r.contributors.map(p => p.name).join(' & ')}` });
  }
  for (const history of world.salvageHistory || []) {
    const contract = { number: history.number, site: history.site, startedAt: history.number > 1 ? history.startedAt : undefined };
    for (const entry of voyageEntries({ seed: world.seed, contract, milestones: history.milestones, delivery: history.delivery })) {
      entries.push({ ...entry, id: `salvage-${history.number}-${entry.id}` });
    }
  }
  for (const entry of world.crewLog || []) entries.push({ id: `crew-${entry.id}`, time: entry.time,
    title: `Expedition ${entry.expedition} · ${entry.author}’s log`, detail: entry.text + (entry.position ? `\nRecorded at ${Math.round(entry.position.x)}, ${Math.round(entry.position.z)} · ${entry.position.y < -2 ? `${Math.round(-entry.position.y)} m deep` : 'surface location'}` : ''),
    logId: entry.position ? entry.id : null, charted: Object.values(world.places || {}).some(p => p.sourceLog === entry.id) });
  for (const r of world.pickupRecords || []) entries.push({ id: `pickup-${r.id}`, time: r.time,
    title: `${r.diver} returned during a crew pickup`,
    detail: `${r.assisted ? 'Returned using the safety beacon' : 'Climbed aboard'} · ${voyageTime(r.time-r.startedAt)} after pickup course set` +
      (r.navigator ? ` · Course set by ${r.navigator}` : '') + (r.pilot ? ` · At the helm: ${r.pilot}` : '') });
  for (const dive of world.diveRecords || []) entries.push({ id: `dive-${dive.id}`, time: dive.endedAt,
    title: `Expedition ${dive.expedition} · ${dive.name} returned from a dive`,
    detail: `${voyageTime(dive.endedAt - dive.startedAt)} in the water · ${Math.round(dive.maximumDepth)} m maximum depth · ${dive.assisted ? 'Returned using the safety beacon' : 'Climbed aboard'}` });
  for (const [id, r] of Object.entries(world.wreckDiscoveries || {})) entries.push({ id: `wreck-${id}`, time: r.time,
    title: `Expedition ${r.expedition} · Explored ${wreckName(id).toLowerCase()}`, detail: `${r.crew.join(' & ')} · Wreck location kept on the crew chart` });
  for (const [type, r] of Object.entries(world.sightings || {})) entries.push({ id: `sighting-${type}`, time: r.time,
    title: `Expedition ${r.expedition} · ${FIELD_NOTES[type][0]} sighting`,
    detail: `Reported by ${r.observer} · Observer depth ${Math.max(0, Math.round(-r.position.y))} m · Location marks the observer, not the moving animal`,
    sightingType: type, charted: Object.values(world.places || {}).some(p => p.sourceSighting === type) });
  for (const r of [...(world.researchHistory || []), ...(world.research ? [world.research] : [])]) {
    const name = voyageSites({ seed: world.seed }).find(s => s.id === r.site).name;
    entries.push({ id: `research-${r.id}-accepted`, time: r.startedAt, title: `Accepted research request: ${name}`, detail: `${r.acceptedBy} · Survey the habitat and bring the report home` });
    if (r.finishedAt != null) entries.push({ id: `research-${r.id}-finished`, time: r.finishedAt,
      title: `${r.status === 'filed' ? 'Filed research report' : 'Set aside research request'}: ${name}`,
      detail: `${r.finishedBy} at Pelican Station${r.status === 'filed' ? ` · Survey team: ${r.contributors.join(' & ')} · ${voyageTime(r.finishedAt - r.startedAt)} from acceptance` : ' · Survey progress kept'}` + (researchExperienceText(r) ? `\n${researchExperienceText(r)}` : '') });
  }
  return entries.sort((a, b) => a.time - b.time);
}

export function voyageTime(time) {
  const seconds = Math.max(0, Math.floor(time));
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function voyageText(world) {
  return ['KESTREL — VOYAGE LOG', `Ocean seed: ${world.seed}`, 'Times are elapsed voyage time.', '',
    ...voyageEntries(world).map(e => `${voyageTime(e.time)} — ${e.title}\n${e.detail}\n`)].join('\n');
}

export class VoyageLog {
  constructor(game, activities) {
    this.game = game;
    this.button = document.createElement('button'); this.button.id = 'deck-logbook'; this.button.dataset.action = 'logbook';
    this.button.textContent = '[F] Read ship’s log'; this.button.className = 'suggested'; this.button.hidden = true;
    this.button.setAttribute('aria-haspopup', 'dialog'); this.button.onclick = () => game.action('logbook');
    game.$('game-actions').append(this.button);
    this.section = document.createElement('details'); this.section.id = 'voyage-log';
    this.section.innerHTML = '<summary>Voyage log</summary><p>Shared milestones and completed surveys, recorded in voyage time.</p><p class="voyage-log-empty">Your story begins when Kestrel leaves the station. Completed surveys and archive recovery will be recorded here.</p><ol></ol><button id="save-voyage-log">Save voyage log</button>';
    activities.$('activities-crew').after(this.section);
    const search = document.createElement('div'); search.id = 'voyage-log-search';
    // A text searchbox lets Escape close the notebook instead of clearing a
    // native search input and consuming the dialog's cancel key.
    search.innerHTML = '<label for="search-voyage-log">Search the voyage log</label><input id="search-voyage-log" type="text" role="searchbox" maxlength="100" placeholder="Name, place, expedition or memory"><button id="clear-voyage-search" type="button">Clear search</button><p id="voyage-search-count" role="status"></p>';
    this.section.querySelector('ol').before(search);
    this.search = search.querySelector('input'); this.search.oninput = () => this.update(game.state);
    search.querySelector('button').onclick = () => { this.search.value = ''; this.update(game.state); this.search.focus(); };
    this.composer = new CrewLogComposer(game, this.section);
    this.section.querySelector('#save-voyage-log').onclick = () => {
      const url = URL.createObjectURL(new Blob([voyageText(game.state)], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `kestrel-voyage-${game.state.seed}.txt`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
  show() {
    const activities = this.game.activities;
    activities.show();
    if (!activities.dialog.open) return;
    activities.returnFocus = this.button;
    this.section.open = true;
    this.section.scrollIntoView({ block: 'center' });
    this.section.querySelector('summary').focus({ preventScroll: true });
  }
  update(world) {
    this.button.hidden = this.game.contextAction() !== 'logbook';
    this.button.disabled = !this.game.net.ready;
    if (!this.game.activities.dialog.open) return;
    this.composer.update();
    const entries = voyageEntries(world), query = this.search.value.trim().toLocaleLowerCase(), key = JSON.stringify([entries, query]);
    if (key === this.key) return; this.key = key;
    this.section.querySelector('summary').textContent = `Voyage log · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    this.section.querySelector('.voyage-log-empty').hidden = entries.length > 0;
    this.section.querySelector('#save-voyage-log').disabled = !entries.length;
    const words = query.split(/\s+/).filter(Boolean);
    const visible = entries.filter(e => { const text = `${e.title} ${e.detail} ${voyageTime(e.time)}`.toLocaleLowerCase(); return words.every(word => text.includes(word)); });
    this.section.querySelector('#clear-voyage-search').disabled = !query;
    this.section.querySelector('#voyage-search-count').textContent = query ? `${visible.length} of ${entries.length} entries match. Save voyage log exports the full history.` : '';
    this.section.querySelector('ol').replaceChildren(...visible.map(e => {
      const row = document.createElement('li'), time = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('p');
      time.textContent = voyageTime(e.time); title.textContent = e.title; detail.textContent = e.detail;
      row.append(time, title, detail);
      if (e.logId || e.sightingType) {
        const chart = document.createElement('button'), status = document.createElement('p');
        chart.textContent = e.charted ? 'Location saved in chart' : 'Save location to chart'; chart.disabled = e.charted;
        if (e.logId) chart.dataset.logLocation = e.logId;
        else chart.dataset.sightingLocation = e.sightingType;
        status.setAttribute('role', 'status');
        chart.onclick = async () => {
          chart.disabled = true;
          try { await this.game.net.action(e.logId ? 'chartCrewEntry' : 'chartSighting', e.logId ? { entryId: e.logId } : { type: e.sightingType }); status.textContent = 'Location saved. Open the voyage chart to name it or plot a course.'; }
          catch (error) { status.textContent = error.message; }
          finally { chart.disabled = false; }
        };
        row.append(chart, status);
      }
      return row;
    }));
  }
}
