import { navigationHeight } from '../ocean/NavigationSea.js';

export const SPLASH_LIMIT = 384;
const onboard = new Set(['deck', 'helm', 'winch']);

export function splashPose(drop, time) {
  const age = Math.max(0, time - drop.born);
  return { x: drop.x + drop.vx * age, y: drop.y + drop.vy * age - 4.9 * age * age,
    z: drop.z + drop.vz * age, radius: drop.radius,
    opacity: Math.min(1, age / .045) * Math.max(0, Math.min(1, (drop.life - age) / .25)) };
}

// Infer only transitions this client actually witnessed: joining an existing
// dive or returning from a suspended tab must not replay an entry splash.
export class DiveSplashTrail {
  constructor() { this.players = new Map(); this.drops = []; this.time = null; }
  update(players, time, storm = 0) {
    const recent = this.time !== null && time >= this.time && time - this.time <= 1;
    if (!recent) { this.players.clear(); this.drops = []; }
    const next = new Map();
    for (const p of players) {
      if (!p.connected) continue;
      const last = this.players.get(p.id);
      if (last && onboard.has(last.mode) && p.mode === 'diver' && p.y > -3 && p.y < 2 && Number.isFinite(p.x + p.y + p.z)) {
        let seed = 2166136261;
        for (const c of p.id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
        const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
        const y = navigationHeight(p.x, p.z, time, storm) + .12;
        for (let i = 0; i < 96; i++) {
          const angle = (i + random()) / 96 * Math.PI * 2, speed = .8 + random() * 1.9, vy = 2.1 + random() * 2.7;
          this.drops.push({ born: time, x: p.x + Math.cos(angle) * .2, y, z: p.z + Math.sin(angle) * .2,
            vx: Math.cos(angle) * speed, vy, vz: Math.sin(angle) * speed, radius: .012 + random() * .022, life: vy / 4.9 });
        }
      }
      next.set(p.id, { mode: p.mode });
    }
    this.players = next; this.time = time;
    this.drops = this.drops.filter(d => time - d.born < d.life).slice(-SPLASH_LIMIT);
    return this.drops;
  }
}
