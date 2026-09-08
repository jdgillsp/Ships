export const DAY_PERIOD = 3600;
const START = Math.asin(.55 / .75);

export function voyageLight(w, seconds = 0) {
  const elapsed = Math.max(0, w.time + Math.max(0, seconds) - (w.daylightStart ?? w.time));
  const phase = START + (elapsed % DAY_PERIOD) / DAY_PERIOD * Math.PI * 2;
  const elevation = .75 * Math.sin(phase), rising = Math.cos(phase) >= 0;
  return { elevation, azimuth: (2.1 + elapsed / DAY_PERIOD * Math.PI * 2) % (Math.PI * 2),
    label: elevation < -.1 ? 'Night' : elevation <= .1 ? (rising ? 'Dawn' : 'Dusk') : rising ? 'Morning' : 'Afternoon' };
}
export function validVoyageLight(w) {
  return w.daylightStart === undefined || Number.isFinite(w.daylightStart) && w.daylightStart >= 0 && w.daylightStart <= w.time;
}
