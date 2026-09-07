import { breathPhase } from './DiverBreath.js';
import { navigationHeight } from '../ocean/NavigationSea.js';

export const BUBBLE_LIMIT = 256;
export const BUBBLE_LIFETIME = 4;
const interval = .1;
const random = seed => { let n = seed | 0; return () => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return (n >>> 0) / 4294967296; }; };

export function bubblePose(bubble, time) {
  const age = Math.max(0, time - bubble.born), spread = age * .08;
  return { x: bubble.x + bubble.dx * age + Math.sin(age * 3 + bubble.seed) * spread,
    y: bubble.y + bubble.rise * age, z: bubble.z + bubble.dz * age + Math.cos(age * 2.7 + bubble.seed) * spread,
    radius: bubble.radius * (1 + age * .13), opacity: Math.max(0, Math.min(1, age / .15, (BUBBLE_LIFETIME - age) / .65)) };
}

export class BubbleTrail {
  constructor() { this.states = new Map(); this.bubbles = []; this.time = null; }
  update(emitters, time, storm = 0) {
    if (this.time !== null && time < this.time) { this.states.clear(); this.bubbles = []; }
    this.time = time;
    const ids = new Set(emitters.map(p => p.id));
    for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id);
    for (const p of emitters) {
      const last = this.states.get(p.id), dt = last ? time - last.time : 0;
      const moved = last ? Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) : 0;
      if (last && dt > 0 && dt <= 1 && moved / dt < 12) {
        // Fixed emission times make a slow render produce the same trail as a
        // fast one. Interpolate the mouth at birth, never attach old bubbles.
        for (let step = Math.floor((last.time + 1e-8) / interval) + 1; step <= Math.floor((time + 1e-8) / interval); step++) {
          const born = step * interval, phase = breathPhase(born, p.id);
          if (phase < .38 || phase >= .85) continue;
          const t = Math.min(1, Math.max(0, (born - last.time) / dt));
          const x = last.x + (p.x - last.x) * t, y = last.y + (p.y - last.y) * t, z = last.z + (p.z - last.z) * t;
          if (y > navigationHeight(x, z, born, storm) - .15) continue;
          const seed = [...p.id].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) ^ Math.imul(step + 1, 2654435761);
          const rng = random(seed || 1);
          for (let i = 0; i < 2; i++) this.bubbles.push({ id: `${p.id}:${step}:${i}`, owner: p.id, born,
            x: x + (rng() - .5) * .05, y, z: z + (rng() - .5) * .05,
            dx: (rng() - .5) * .12, dz: (rng() - .5) * .12, rise: .55 + rng() * .35,
            radius: .018 + rng() * .027, seed: rng() * Math.PI * 2 });
        }
      }
      this.states.set(p.id, { x: p.x, y: p.y, z: p.z, time });
    }
    this.bubbles = this.bubbles.filter(b => {
      const pose = bubblePose(b, time);
      return time - b.born < BUBBLE_LIFETIME && pose.y < navigationHeight(pose.x, pose.z, time, storm) - .03;
    }).slice(-BUBBLE_LIMIT);
    return this.bubbles;
  }
}
