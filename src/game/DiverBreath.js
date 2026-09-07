export function breathPhase(time, id = '') {
  const offset = [...id].reduce((n, c) => n + c.charCodeAt(0), 0) * .013;
  return ((time / 5 + offset) % 1 + 1) % 1;
}

export function breathEnvelope(time, id) {
  const phase = breathPhase(time, id);
  return phase < .38 ? Math.sin(phase / .38 * Math.PI) : phase < .85 ? Math.sin((phase - .38) / .47 * Math.PI) * .6 : 0;
}
