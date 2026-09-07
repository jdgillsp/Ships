export const WAKE_POINTS = 32;
export const WAKE_LIFETIME = 14;

// Deposits stay in world space, so a turn bends the wake instead of swinging
// the whole trail with the hull. A live tip closes the gap between deposits.
export class WakeTrail {
  constructor() { this.points = []; this.lastTime = null; }
  update(ship, time) {
    const direction = ship.speed < 0 ? -1 : 1;
    const point = { x: ship.x - Math.sin(ship.heading) * 6.8 * direction,
      z: ship.z - Math.cos(ship.heading) * 6.8 * direction, time,
      strength: Math.min(1, Math.max(0, (Math.abs(ship.speed) - .25) / 6)) };
    const last = this.points.at(-1);
    if (this.lastTime !== null && (time < this.lastTime || time - this.lastTime > 2 ||
      (last && Math.hypot(point.x - last.x, point.z - last.z) > 35))) this.points = [];
    this.lastTime = time;
    this.points = this.points.filter(p => time - p.time < WAKE_LIFETIME);
    if (point.strength > 0) {
      const tail = this.points.at(-1);
      if (!tail || time - tail.time >= .45 || Math.hypot(point.x - tail.x, point.z - tail.z) >= 4) this.points.push(point);
    }
    this.points = this.points.slice(-(WAKE_POINTS - 1));
    return point.strength > 0 && this.points.at(-1) !== point ? [...this.points, point] : this.points;
  }
}
