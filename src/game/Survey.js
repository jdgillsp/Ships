import { voyageSites } from './VoyageSites.js';

export const SURVEY_RADIUS = 18;
export const SURVEY_SECONDS = 8;

export function isSurveying(world, id) {
  if (!world.players[id]?.input?.survey) return false;
  const status = surveyStatus(world, id);
  return !!status?.eligible && !status.complete;
}

export function surveyStatus(world, id) {
  const site = voyageSites({ seed: world.seed }).find(s => s.id === world.course?.id), p = world.players[id];
  if (!site || !p || !world.surveys) return null;
  const record = world.surveys[site.id];
  const distance = Math.hypot(site.x - p.x, site.y - p.y, site.z - p.z);
  return { site, record, distance, complete: record?.completedAt != null, progress: (record?.seconds || 0) / SURVEY_SECONDS,
    eligible: p.connected && p.mode === 'diver' && p.y < -3 && distance <= SURVEY_RADIUS };
}

export function advanceSurvey(world, dt) {
  for (const record of Object.values(world.surveys || {})) record.active = 0;
  if (!world.course || !world.surveys) return;
  const site = voyageSites({ seed: world.seed }).find(s => s.id === world.course.id);
  if (!site || world.surveys[site.id]?.completedAt != null) return;
  const divers = Object.values(world.players).filter(p => isSurveying(world, p.id));
  if (!divers.length) return;
  const record = world.surveys[site.id] ??= { seconds: 0, contributors: [], completedAt: null };
  record.active = divers.length;
  for (const p of divers) if (!record.contributors.some(c => c.id === p.id) && record.contributors.length < 4) record.contributors.push({ id: p.id, name: p.name });
  record.seconds = Math.min(SURVEY_SECONDS, record.seconds + dt * divers.length);
  if (record.seconds >= SURVEY_SECONDS - 1e-9) {
    record.seconds = SURVEY_SECONDS; record.completedAt = world.time; record.active = 0;
    world.log = `${site.name} surveyed. ${record.contributors.map(c => c.name).join(' & ')} added it to the crew chart.`;
    world.revision++;
  }
}
