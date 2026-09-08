// Composed game weather, in voyage seconds. Long fair intervals leave room for
// quiet exploration; each passing front builds and clears continuously.
export const FRONT_PERIOD = 900;
export const FRONT_BUILD = 420;
export const FRONT_PEAK = 540;
export const FRONT_EASE = 600;
export const FRONT_END = 780;
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export function explorationWeather(w, seconds = 0) {
  const start = w.explorationWeather;
  if (!start) return null;
  const elapsed = Math.max(0, w.time + Math.max(0, seconds) - start.time), cycle = Math.floor(elapsed / FRONT_PERIOD), phase = elapsed % FRONT_PERIOD;
  let hash = Math.imul((w.seed | 0) ^ (cycle + 1), 0x45d9f3b); hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  const peak = .55 + ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff * .25;
  const front = phase < FRONT_PEAK ? peak * smooth((phase - FRONT_BUILD) / (FRONT_PEAK - FRONT_BUILD)) :
    phase < FRONT_EASE ? peak : peak * (1 - smooth((phase - FRONT_EASE) / (FRONT_END - FRONT_EASE)));
  const clearing = Math.max(0, start.storm - elapsed / 90);
  const trend = clearing > front ? 'Squall easing' : phase >= FRONT_EASE && phase < FRONT_END ? 'Weather front easing' :
    phase >= FRONT_PEAK && phase < FRONT_EASE ? 'Weather front passing' : phase >= FRONT_BUILD ? 'Weather front building' :
    phase >= FRONT_BUILD - 120 ? 'Weather front approaching' : 'Fair interval';
  return { storm: Math.max(clearing, front), trend: phase >= FRONT_END ? 'Fair interval' : trend, cycle, phase, peak };
}

export function validExplorationWeather(w) {
  const r = w.explorationWeather;
  return r === undefined || !!r && Number.isFinite(r.time) && r.time >= 0 && r.time <= w.time && Number.isFinite(r.storm) && r.storm >= 0 && r.storm <= .85;
}
