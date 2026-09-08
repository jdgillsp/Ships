import { stormAfter, seaCondition, weatherOutlook, planDuration } from './WeatherOutlook.js';

export function diveReturnPlan(w, id) {
  const p = w.players[id];
  if (!p?.connected || p.mode !== 'diver') return null;
  const ascent = Math.max(0, -p.y) / 5;
  const swim = Math.hypot(w.ship.x - p.x, w.ship.z - p.z) / 5;
  const total = ascent + swim;
  return { ascent, swim, total, moving: Math.abs(w.ship.speed) >= .1,
    sea: weatherOutlook(w).known ? seaCondition(stormAfter(w, total)) : null };
}

export class DiveReturnBriefing {
  constructor(game, activities) {
    this.game = game;
    this.root = document.createElement('section'); this.root.id = 'dive-return-briefing';
    this.root.innerHTML = '<h3>Dive team return</h3><p>At full swim speed: a direct ascent, then a surface swim to Kestrel’s current position. Allow extra time for obstacles and boarding.</p><ul></ul>';
    activities.$('activities-crew').after(this.root);
  }
  update(w) {
    const divers = Object.values(w.players).filter(p => p.connected && p.mode === 'diver');
    this.root.hidden = !divers.length;
    const rows = divers.map(p => {
      const plan = diveReturnPlan(w, p.id);
      return { name: p.name, text: !this.game.net.ready ? 'Return estimate paused while reconnecting.' :
        `About ${planDuration(plan.total)} · ${planDuration(plan.ascent)} ascent + ${planDuration(plan.swim)} surface swim. ${plan.sea ? `${plan.sea} sea expected on arrival.` : 'No timed weather outlook yet.'}${plan.moving ? ' Kestrel is moving; the return distance is changing.' : ''}` };
    });
    const key = JSON.stringify(rows); if (this.key === key) return; this.key = key;
    this.root.querySelector('ul').replaceChildren(...rows.map(row => {
      const item = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('p');
      name.textContent = row.name; detail.textContent = row.text; item.append(name, detail); return item;
    }));
  }
}
