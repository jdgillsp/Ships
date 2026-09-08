import { seaCondition } from './WeatherOutlook.js';

export function beginResearchExperience(w) {
  return { dives: 0, maximumDepth: 0, diverSeconds: 0, beaconReturns: 0, strongestStorm: w.storm };
}
export function recordResearchDive(w, dive) {
  const request = w.research, e = request?.experience;
  if (!e || dive.researchRequest !== request.id || dive.startedAt < request.startedAt) return;
  e.dives++;
  e.maximumDepth = Math.max(e.maximumDepth, dive.maximumDepth);
  e.diverSeconds += dive.endedAt - dive.startedAt;
  if (dive.assisted) e.beaconReturns++;
}
export function recordResearchWeather(w) {
  const e = w.research?.experience;
  if (e) e.strongestStorm = Math.max(e.strongestStorm, w.storm);
}
export function validResearchExperience(r, worldTime) {
  const e = r.experience;
  if (e === undefined) return true; // Older requests have no complete observations.
  const duration = (r.finishedAt ?? worldTime) - r.startedAt;
  return !!e && Number.isSafeInteger(e.dives) && e.dives >= 0 &&
    Number.isSafeInteger(e.beaconReturns) && e.beaconReturns >= 0 && e.beaconReturns <= e.dives &&
    Number.isFinite(e.maximumDepth) && e.maximumDepth >= 0 && e.maximumDepth <= 2000 &&
    Number.isFinite(e.diverSeconds) && e.diverSeconds >= 0 && e.diverSeconds <= duration * 4 + .001 &&
    Number.isFinite(e.strongestStorm) && e.strongestStorm >= 0 && e.strongestStorm <= 1 &&
    (e.dives > 0 || e.maximumDepth === 0 && e.diverSeconds === 0);
}
export function researchExperienceText(r) {
  const e = r?.experience; if (!e) return '';
  const seconds = Math.floor(e.diverSeconds);
  return (e.dives ? `${e.dives} completed dive${e.dives === 1 ? '' : 's'} · ${Math.round(e.maximumDepth)} m deepest recorded dive · ${Math.floor(seconds / 60)} min ${seconds % 60} sec combined dive time` : 'No completed dives recorded') +
    ` · Strongest seas during request: ${seaCondition(e.strongestStorm).toLowerCase()}` +
    (e.beaconReturns ? ` · ${e.beaconReturns} safety-beacon return${e.beaconReturns === 1 ? '' : 's'}` : '');
}
