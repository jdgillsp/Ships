import { validMilestones } from './VoyageLog.js';
import { SALVAGE_SITES, activeSalvage } from './SalvageSites.js';
export { SALVAGE_SITES, activeSalvage } from './SalvageSites.js';

export function nextSalvageReason(world, id) {
  if (world.research) return 'File or set aside the research request at Pelican Station before accepting salvage.';
  if (!world.players[id]?.connected) return 'Join the crew to accept a salvage job.';
  if (world.mission !== 'complete') return 'Deliver the current archive before accepting another job.';
  const base = world.locations?.base || { x: -140, z: 440 };
  if (Math.hypot(world.ship.x - base.x, world.ship.z - base.z) >= 24 || Math.abs(world.ship.speed) >= 1.5 || !world.ship.anchor) return 'Return to Pelican Station and anchor to take another job.';
  if (Object.values(world.players).some(p => p.connected && p.mode === 'diver')) return 'Bring every connected diver aboard before accepting another job.';
  return '';
}

export function beginSalvage(world, id, destination) {
  const reason = nextSalvageReason(world, id), site = SALVAGE_SITES.find(s => s.id === destination);
  if (reason) return { ok: false, message: reason };
  if (!site || site.id === activeSalvage(world).id) return { ok: false, message: 'Choose another salvage site.' };
  world.salvageHistory ??= [];
  world.salvageHistory.push({ number: world.contract?.number || 1, site: activeSalvage(world).id, startedAt: world.contract?.startedAt ?? 0, delivery: world.delivery, milestones: world.milestones || {} });
  if (world.salvageHistory.length > 20) world.salvageHistory.shift();
  world.contract = { site: site.id, number: (world.contract?.number || 1) + 1, startedAt: world.time };
  world.locations = { ...world.locations, wreck: { ...site.wreck } };
  world.cargo = { ...site.cargo, initialY: site.cargo.y, attached: false, recovered: false };
  world.delivery = null; world.milestones = {}; world.mission = 'outbound'; world.stormStart = null;
  world.weatherCarry = { time: world.time, storm: world.storm };
  world.course = null; world.winch = null;
  for (const p of Object.values(world.players)) { p.input = {}; if (p.mode === 'winch') p.mode = 'deck'; }
  world.log = `${world.players[id].name} accepted ${site.name}. The next archive is marked by the survey buoy.`;
  world.revision++; return { ok: true };
}

export function validSalvageState(w) {
  if (w.weatherCarry !== undefined && (!w.weatherCarry || !Number.isFinite(w.weatherCarry.time) || w.weatherCarry.time < 0 || w.weatherCarry.time > w.time || !Number.isFinite(w.weatherCarry.storm) || w.weatherCarry.storm < 0 || w.weatherCarry.storm > .85)) return false;
  const site = SALVAGE_SITES.find(s => s.id === w.contract?.site);
  if (w.contract !== undefined && (!site || !Number.isSafeInteger(w.contract.number) || w.contract.number < 2 || !Number.isFinite(w.contract.startedAt) || w.contract.startedAt < 0 || w.contract.startedAt > w.time ||
    w.locations?.wreck?.x !== site.wreck.x || w.locations?.wreck?.z !== site.wreck.z || w.cargo.initialY !== site.cargo.y)) return false;
  if (w.salvageHistory === undefined) return true;
  return Array.isArray(w.salvageHistory) && w.salvageHistory.length <= 20 && w.salvageHistory.every(h => h && SALVAGE_SITES.some(s => s.id === h.site) &&
    Number.isSafeInteger(h.number) && h.number >= 1 &&
    (h.startedAt === undefined || Number.isFinite(h.startedAt) && h.startedAt >= 0 && h.startedAt <= (h.delivery?.time ?? w.time)) &&
    validMilestones({ time: w.time, milestones: h.milestones }) &&
    (h.delivery === null || h.delivery && Number.isFinite(h.delivery.time) && h.delivery.time >= 0 && h.delivery.time <= w.time &&
      (h.delivery.duration === undefined || Number.isFinite(h.delivery.duration) && h.delivery.duration >= 0 && h.delivery.duration <= h.delivery.time) &&
      typeof h.delivery.receivedFrom === 'string' && h.delivery.receivedFrom.length <= 20 && Array.isArray(h.delivery.crew) && h.delivery.crew.length <= 4 && h.delivery.crew.every(n => typeof n === 'string' && n.length <= 20)));
}
