const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class CrewMotion {
  constructor() { this.states = new Map(); }
  update(p, time) {
    const diving = p.mode === 'diver', x = diving ? p.x : p.deckX ?? 0, y = diving ? p.y : 0, z = diving ? p.z : p.deckZ ?? 0;
    let state = this.states.get(p.id);
    if (!state || state.mode !== p.mode || time < state.time || time - state.time > 1) {
      state = { x, y, z, time, mode: p.mode, speed: 0, forward: 0 }; this.states.set(p.id, state);
    }
    const dt = time - state.time;
    if (dt > 0) {
      const dx = x - state.x, dy = y - state.y, dz = z - state.z, distance = Math.hypot(dx, dy, dz);
      const speed = distance / dt;
      // Rejoins and safety-beacon moves cannot turn into a burst of animation.
      const valid = speed < 12, a = 1 - Math.exp(-dt * 8);
      const forward = (dx * Math.sin(p.yaw) * Math.cos(p.pitch) + dy * Math.sin(p.pitch) + dz * Math.cos(p.yaw) * Math.cos(p.pitch)) / dt;
      state.speed += ((valid ? speed : 0) - state.speed) * a;
      state.forward += ((valid ? forward : 0) - state.forward) * a;
      Object.assign(state, { x, y, z, time });
    }
    const walk = p.mode === 'deck' ? clamp(state.speed / 2.5, 0, 1) : 0;
    const swim = diving ? clamp(state.speed / 5, 0, 1) : 0;
    const prone = diving ? clamp(state.forward / 4, 0, 1) * 1.4 : 0;
    const offset = [...p.id].reduce((n, c) => n + c.charCodeAt(0), 0) * .13;
    const phase = time * (diving ? 4.8 : 7.5) + offset;
    const bodyPitch = diving ? prone - (p.pitch || 0) * swim : 0;
    const result = { walk, swim, bodyPitch, headPitch: diving ? -(p.pitch || 0) - bodyPitch : 0,
      bob: Math.abs(Math.sin(phase)) * .025 * walk, legs: [], knees: [], arms: [], elbows: [], ankles: [] };
    for (const side of [-1, 1]) {
      const wave = Math.sin(phase + (side === 1 ? Math.PI : 0));
      result.legs.push(diving ? wave * (.08 + swim * .3) : wave * .42 * walk);
      result.knees.push(diving ? .15 + Math.max(0, wave) * (.12 + swim * .22) : Math.max(0, -wave) * .55 * walk);
      result.arms.push(diving ? -.65 + prone * .3 + wave * .07 : p.mode === 'winch' || p.mode === 'helm' ? -.65 : -wave * .3 * walk + .05);
      result.elbows.push(diving ? -.55 : p.mode === 'winch' || p.mode === 'helm' ? -.35 : -.08 - .12 * walk);
      result.ankles.push(diving ? 1.05 + wave * .14 * swim : -.12 * Math.max(0, wave) * walk);
    }
    return result;
  }
}
