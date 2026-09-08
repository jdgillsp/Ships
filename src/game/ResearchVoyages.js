import { beginResearchExperience, validResearchExperience } from './ResearchExperience.js';
import { voyageSites } from './VoyageSites.js';

export function researchSite(w) { return voyageSites({ seed: w.seed }).find(s => s.id === w.research?.site); }
export function researchReady(w) { return !!w.research && w.surveys?.[w.research.site]?.completedAt != null; }
export function researchHarborReason(w, id) {
  if (!w.players[id]?.connected) return 'Join the crew to handle a research request.';
  const base = w.locations.base;
  if (Math.hypot(w.ship.x - base.x, w.ship.z - base.z) >= 24 || Math.abs(w.ship.speed) >= 1.5 || !w.ship.anchor) return 'Anchor beside Pelican Station to handle research requests.';
  if (Object.values(w.players).some(p => p.connected && p.mode === 'diver')) return 'Bring every connected diver aboard first.';
  return '';
}
export function acceptResearch(w, id, destination) {
  const reason = researchHarborReason(w, id);
  if (reason) return { ok: false, message: reason };
  if (w.mission !== 'complete' || w.research) return { ok: false, message: w.research ? 'Finish or set aside the current research request first.' : 'Deliver the archive before accepting a research request.' };
  const site = voyageSites({ seed: w.seed }).find(s => s.id === destination);
  if (!site || w.surveys?.[site.id]?.completedAt != null) return { ok: false, message: 'Choose a habitat the crew has not surveyed yet.' };
  w.researchSequence = (w.researchSequence || 0) + 1;
  w.research = { id: w.researchSequence, site: site.id, startedAt: w.time, acceptedBy: w.players[id].name, experience: beginResearchExperience(w) };
  w.course = { id: site.id, owner: id };
  w.log = `${w.players[id].name} accepted a research request for ${site.name}. Survey the habitat and bring the report home.`; w.revision++;
  return { ok: true };
}
export function finishResearch(w, id, file = true) {
  const reason = researchHarborReason(w, id);
  if (reason) return { ok: false, message: reason };
  if (!w.research || file && !researchReady(w)) return { ok: false, message: 'Survey the requested habitat before filing its report.' };
  const site = researchSite(w), survey = w.surveys?.[site.id];
  w.researchHistory ??= [];
  w.researchHistory.push({ ...w.research, finishedAt: w.time, finishedBy: w.players[id].name, status: file ? 'filed' : 'set-aside',
    contributors: file ? survey.contributors.map(p => p.name) : [] });
  if (w.researchHistory.length > 32) w.researchHistory.shift();
  w.research = null;
  if (w.course?.id === site.id) w.course = null;
  w.log = file ? `Pelican Station received the ${site.name} research report. ${survey.contributors.map(p => p.name).join(' & ')} surveyed the habitat.` : `The ${site.name} request was set aside. Your survey progress and discoveries are kept.`;
  w.revision++; return { ok: true };
}
export function researchTarget(w, id) {
  const site = researchSite(w), p = w.players[id]; if (!site || !p) return null;
  const ready = researchReady(w), diver = p.mode === 'diver';
  return ready ? { key: diver ? 'ship' : 'base', label: diver ? 'KESTREL / RESEARCH TEAM' : 'PELICAN / RESEARCH REPORT',
    ...(diver ? { x: w.ship.x, z: w.ship.z } : w.locations.base), y: diver ? 0 : 3,
    hint: diver ? 'Survey complete · return aboard for the homeward sail' : 'Bring the crew home and file the report in Activities' } :
    { key: 'research', label: site.name, x: site.x, y: diver ? site.y : 2, z: site.z, hint: diver ? 'Follow the habitat signal · hold X to survey' : 'Sail to the requested habitat, anchor and dive to survey' };
}
export function validResearch(w) {
  const sites = new Set(voyageSites({ seed: w.seed }).map(s => s.id));
  const name = n => typeof n === 'string' && n.length <= 20;
  const request = r => r && Number.isSafeInteger(r.id) && r.id > 0 && r.id <= w.researchSequence && sites.has(r.site) &&
    Number.isFinite(r.startedAt) && r.startedAt >= 0 && r.startedAt <= w.time && name(r.acceptedBy) && validResearchExperience(r, w.time);
  if (w.researchSequence !== undefined && (!Number.isSafeInteger(w.researchSequence) || w.researchSequence < 0)) return false;
  if (w.research != null && (!request(w.research) || w.mission !== 'complete')) return false;
  if (w.research && w.surveys?.[w.research.site]?.completedAt != null && w.surveys[w.research.site].completedAt < w.research.startedAt) return false;
  return w.researchHistory === undefined || Array.isArray(w.researchHistory) && w.researchHistory.length <= 32 &&
    new Set(w.researchHistory.map(r => r?.id)).size === w.researchHistory.length &&
    w.researchHistory.every(r => request(r) && r.id !== w.research?.id && Number.isFinite(r.finishedAt) && r.finishedAt >= r.startedAt && r.finishedAt <= w.time &&
      name(r.finishedBy) && ['filed', 'set-aside'].includes(r.status) && Array.isArray(r.contributors) && r.contributors.length <= 4 &&
      (r.status === 'filed' ? r.contributors.length > 0 : r.contributors.length === 0) && r.contributors.every(name));
}
