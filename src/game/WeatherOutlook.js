import { voyageLight } from './VoyageLight.js';
import { activeSalvage, ARCHIVE_LIFT_SPEED } from './SalvageSites.js';
import { explorationWeather } from './ExplorationWeather.js';
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// The server and the planning instruments use the same expedition weather curve.
export function stormAfter(world, seconds = 0) {
  const elapsed = Math.max(0, seconds);
  if (world.mission === 'complete') return explorationWeather(world, elapsed)?.storm ?? Math.max(0, world.storm - elapsed / 90);
  const carry = world.weatherCarry ? Math.max(0, world.weatherCarry.storm - (world.time + elapsed - world.weatherCarry.time) / 90) : 0;
  return Math.max(carry, world.stormStart == null ? 0 : clamp((world.time + elapsed - world.stormStart - 25) / 150, 0, .85));
}

export function seaCondition(storm) { return storm < .15 ? 'Fair' : storm < .5 ? 'Building' : 'Rough'; }

export function weatherOutlook(world) {
  if (world.mission === 'complete' && world.explorationWeather) {
    const current = explorationWeather(world), now = seaCondition(world.storm), future = seaCondition(explorationWeather(world, 120).storm);
    return { now, future, known: true, trend: current.trend, text: `${now} now · ${current.trend.toLowerCase()} · ${future.toLowerCase()} in 2 min` };
  }
  const easing = world.mission === 'complete' || world.stormStart == null && world.weatherCarry?.storm > 0;
  const now = seaCondition(world.storm), known = world.stormStart != null || easing;
  const future = known ? seaCondition(stormAfter(world, 120)) : null;
  const trend = !known ? 'No active squall' : easing ? (world.storm > 0 ? 'Squall easing' : 'Squall passed') : world.storm < .85 ? 'Squall approaching' : 'Squall holding';
  return { now, future, known, trend, text: `${now} now · ${trend.toLowerCase()}${future ? ` · ${future.toLowerCase()} in 2 min` : ''}` };
}

export function divePlan(world, site, stay = 60) {
  const sailing = Math.hypot(site.x - world.ship.x, site.z - world.ship.z) / 10;
  const descent = Math.max(0, -site.y) / 5;
  const atSite = sailing + descent, surface = atSite + clamp(Number.isFinite(stay) ? stay : 60, 0, 600) + descent;
  const outlook = weatherOutlook(world);
  return { sailing, descent, atSite, surface, outlook, returnLight: voyageLight(world, surface).label,
    arrivalSea: outlook.known ? seaCondition(stormAfter(world, atSite)) : null,
    returnSea: outlook.known ? seaCondition(stormAfter(world, surface)) : null };
}

export function planDuration(seconds) {
  const rounded = Math.ceil(seconds / 5) * 5;
  return rounded < 60 ? `${rounded} sec` : `${Math.floor(rounded / 60)} min${rounded % 60 ? ` ${rounded % 60} sec` : ''}`;
}

export function salvagePlan(world, stay = 60) {
  if (world.mission === 'complete') return { delivered: true, boarding: 0, lift: 0, homeward: 0, total: 0, homeSea: null };
  const site = activeSalvage(world).cargo, base = world.locations?.base || { x: -140, z: 440 };
  const boarding = world.cargo.attached || world.cargo.recovered ? Math.max(0, ...Object.values(world.players).filter(p => p.connected && p.mode === 'diver')
    .map(p => Math.hypot(p.x - world.ship.x, p.y, p.z - world.ship.z) / 5)) : divePlan(world, site, stay).surface;
  const lift = world.cargo.recovered ? 0 : Math.max(0, 2 - world.cargo.y) / ARCHIVE_LIFT_SPEED;
  const from = world.cargo.attached || world.cargo.recovered ? world.ship : site;
  const homeward = Math.hypot(from.x - base.x, from.z - base.z) / 10, total = boarding + lift + homeward;
  return { delivered: false, boarding, lift, homeward, total, homeSea: weatherOutlook(world).known ? seaCondition(stormAfter(world, total)) : null };
}

export class DivePlanner {
  constructor(chart) {
    this.chart = chart;
    this.root = document.createElement('section'); this.root.id = 'dive-planner';
    this.root.innerHTML = '<h3>Weather & dive plan</h3><p id="weather-outlook"></p><p>Plan from Kestrel’s current position.</p><label for="planned-stay">Time exploring at the destination</label><select id="planned-stay"><option value="30">30 seconds</option><option value="60" selected>1 minute</option><option value="180">3 minutes</option><option value="300">5 minutes</option></select><dl><dt>Reach the destination</dt><dd id="planned-arrival"></dd><dt>Back at the surface</dt><dd id="planned-surface"></dd></dl><p id="planned-weather"></p><p id="planned-light"></p><p class="planning-note">Optimistic game-time estimates: full-speed sailing and direct swimming. Allow extra time for turns, boarding and equipment. The outlook assumes the current mission phase continues.</p>';
    chart.$('voyage-record').after(this.root);
    const recovery = document.createElement('section'); recovery.id = 'salvage-return-plan'; recovery.hidden = true;
    recovery.innerHTML = '<h3>Recovery & return</h3><dl><dt>Crew aboard</dt><dd id="planned-boarding"></dd><dt>Winch after boarding</dt><dd id="planned-lift"></dd><dt>Homeward sail</dt><dd id="planned-homeward"></dd><dt>Arrival at Pelican Station</dt><dd id="planned-home"></dd></dl><p id="planned-home-weather"></p>';
    this.root.querySelector('.planning-note').before(recovery);
    this.$ = id => this.root.querySelector(`#${id}`);
    this.$('planned-stay').onchange = () => chart.updateUI(chart.game.state);
  }
  update(world, site) {
    const harbor = site.biome === 'harbor';
    const plan = divePlan(world, site, harbor ? 0 : Number(this.$('planned-stay').value));
    const recovering = site.biome === 'salvage' && (world.cargo.attached || world.cargo.recovered);
    this.$('planned-stay').hidden = recovering || harbor;
    this.root.querySelector('label[for="planned-stay"]').hidden = recovering || harbor;
    this.root.querySelector('h3').textContent = harbor ? 'Weather & passage plan' : 'Weather & dive plan';
    this.$('planned-surface').hidden = harbor; this.$('planned-surface').previousElementSibling.hidden = harbor;
    this.$('planned-arrival').parentElement.hidden = recovering;
    this.$('planned-weather').hidden = recovering;
    this.root.querySelector('.planning-note').textContent = 'Optimistic game-time estimates: full-speed sailing and direct swimming. Allow extra time for turns, boarding and equipment. The outlook assumes the current mission phase continues.' +
      (site.biome === 'salvage' ? ' Recovery assumes divers board before an uninterrupted lift, then a direct sail home. Crew may overlap diving and lifting. Allow extra time to position the ship and anchor.' : '');
    this.$('salvage-return-plan').hidden = site.biome !== 'salvage';
    if (site.biome === 'salvage') {
      const salvage = salvagePlan(world, Number(this.$('planned-stay').value));
      this.$('planned-boarding').textContent = `About ${planDuration(salvage.boarding)} from now`;
      this.$('planned-lift').textContent = planDuration(salvage.lift);
      this.$('planned-homeward').textContent = planDuration(salvage.homeward);
      this.$('planned-home').textContent = salvage.delivered ? 'Archive already delivered' : `About ${planDuration(salvage.total)} from now`;
      this.$('planned-home-weather').textContent = salvage.homeSea ? `${salvage.homeSea} surface conditions at the estimated arrival time.` : 'No timed return-weather estimate available.';
    }
    this.$('weather-outlook').textContent = plan.outlook.text;
    const lightAt = recovering ? salvagePlan(world, Number(this.$('planned-stay').value)).total : harbor ? plan.atSite : plan.surface;
    this.$('planned-light').textContent = `Light: ${voyageLight(world).label.toLowerCase()} now · ${voyageLight(world, lightAt).label.toLowerCase()} ${recovering || harbor ? 'at the station' : plan.descent ? 'on surfacing' : 'after exploring'}. Clouds and depth affect visibility too.`;
    this.$('planned-arrival').textContent = `About ${planDuration(plan.atSite)} · ${planDuration(plan.sailing)} sailing${plan.descent ? ` + ${planDuration(plan.descent)} descent` : ''}`;
    this.$('planned-surface').textContent = `About ${planDuration(plan.surface)} from departure, including your time exploring`;
    this.root.querySelector('dt:last-of-type').textContent = plan.descent ? 'Back at the surface' : 'Finish exploring';
    this.$('planned-weather').textContent = !plan.outlook.known ? 'No timed outlook yet. Check again when the sea starts changing.' :
      `Surface conditions: ${plan.arrivalSea.toLowerCase()} on arrival · ${plan.returnSea.toLowerCase()} ${plan.descent ? 'on surfacing' : 'at the end of your visit'}.`;
    if (harbor && plan.outlook.known) this.$('planned-weather').textContent = `${plan.arrivalSea} surface conditions at the estimated arrival time. Allow time to recover any divers before setting off.`;
  }
}
