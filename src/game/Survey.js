import { voyageSites } from './VoyageSites.js';

export const SURVEY_RADIUS = 18;
export const SURVEY_SECONDS = 8;

export function isSurveying(world, id) {
  if (!world.players[id]?.input?.survey) return false;
  const status = surveyStatus(world, id);
  return !!status?.eligible && !status.complete;
}

export function surveyStatus(world, id) {
  const p = world.players[id];
  if (!p || !world.surveys) return null;
  const sites = voyageSites({ seed: world.seed });
  const range = s => Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z);
  const destination = world.course?.id || (world.research && world.surveys?.[world.research.site]?.completedAt == null ? world.research.site : null);
  const plotted = sites.find(s => s.id === destination);
  // A diver's actual working location takes precedence over a distant course.
  // Select exactly one site so overlapping work areas cannot double-count effort.
  const local = p.mode === 'diver' && p.y < -3 ? sites.filter(s => range(s) <= SURVEY_RADIUS).sort((a, b) => range(a) - range(b))[0] : null;
  const site = plotted && range(plotted) <= SURVEY_RADIUS ? plotted : local || plotted;
  if (!site) return null;
  const record = world.surveys[site.id];
  const distance = Math.hypot(site.x - p.x, site.y - p.y, site.z - p.z);
  return { site, record, distance, complete: record?.completedAt != null, progress: (record?.seconds || 0) / SURVEY_SECONDS,
    eligible: p.connected && p.mode === 'diver' && p.y < -3 && distance <= SURVEY_RADIUS };
}

export function advanceSurvey(world, dt) {
  for (const record of Object.values(world.surveys || {})) record.active = 0;
  if (!world.surveys) return;
  const groups = new Map();
  for (const p of Object.values(world.players)) {
    if (!p.input?.survey) continue;
    const status = surveyStatus(world, p.id);
    if (!status?.eligible || status.complete) continue;
    if (!groups.has(status.site.id)) groups.set(status.site.id, { site: status.site, divers: [] });
    groups.get(status.site.id).divers.push(p);
  }
  for (const { site, divers } of groups.values()) {
    const record = world.surveys[site.id] ??= { seconds: 0, contributors: [], completedAt: null };
    record.active = divers.length;
    for (const p of divers) if (!record.contributors.some(c => c.id === p.id) && record.contributors.length < 4) record.contributors.push({ id: p.id, name: p.name });
    record.seconds = Math.min(SURVEY_SECONDS, record.seconds + dt * divers.length);
    if (record.seconds >= SURVEY_SECONDS - 1e-9) {
      record.seconds = SURVEY_SECONDS; record.completedAt = world.time; record.active = 0;
      world.log = `${site.name} surveyed. ${record.contributors.map(c => c.name).join(' & ')} added it to the crew chart.`;
      if (world.research?.site === site.id) {
        world.log += ' The research report is ready to bring home to Pelican Station.';
        if (!world.course || world.course.id === site.id) world.course = { id: 'pelican-station', owner: divers[0].id };
      }
      world.revision++;
    }
  }
}
