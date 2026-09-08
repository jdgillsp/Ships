export function pickupDiver(w) {
  const p = w.players[w.pickup?.diver];
  return p?.connected && p.mode === 'diver' ? p : null;
}
export function startPickup(w, id, diver) {
  const caller = w.players[id], p = w.players[diver];
  if (!caller?.connected || caller.mode === 'diver') return { ok: false, message: 'Come aboard to set a pickup course.' };
  if (!p?.connected || p.mode !== 'diver') return { ok: false, message: 'That crewmate is no longer in the water.' };
  if (w.pickup?.diver === diver) return { ok: true };
  w.pickup = { diver, owner: id, time: w.time, navigator: caller.name };
  w.log = `${caller.name} set a pickup course for ${p.name}. The plotted expedition course is kept.`; w.revision++;
  return { ok: true };
}
export function finishPickup(w, diver, assisted) {
  const pickup = w.pickup; if (!pickup || pickup.diver !== diver.id) return;
  const records = w.pickupRecords ??= [];
  records.push({ id: (records.at(-1)?.id || 0) + 1, startedAt: pickup.time, time: w.time,
    diver: diver.name, navigator: pickup.navigator ?? w.players[pickup.owner]?.name ?? null,
    pilot: w.players[w.ship.pilot]?.name ?? null, assisted });
  if (records.length > 32) records.shift();
  w.pickup = null;
}
export function validPickupRecords(w) {
  const name = n => typeof n === 'string' && n.length <= 20;
  return w.pickupRecords === undefined || Array.isArray(w.pickupRecords) && w.pickupRecords.length <= 32 &&
    w.pickupRecords.every((r,i) => r && Number.isSafeInteger(r.id) && r.id > (w.pickupRecords[i-1]?.id || 0) &&
      Number.isFinite(r.startedAt) && r.startedAt >= 0 && Number.isFinite(r.time) && r.time >= r.startedAt && r.time <= w.time &&
      name(r.diver) && (r.navigator === null || name(r.navigator)) && (r.pilot === null || name(r.pilot)) && typeof r.assisted === 'boolean');
}
export function cancelPickup(w, id) {
  if (!w.players[id]?.connected) return { ok: false, message: 'Join the crew before changing navigation.' };
  w.pickup = null; w.revision++; return { ok: true };
}
export function updatePickup(w) {
  if (w.pickup && !pickupDiver(w)) { w.pickup = null; w.revision++; }
}
export function validPickup(w) {
  const p = w.pickup;
  return p == null || !!p && typeof p.diver === 'string' && Object.hasOwn(w.players, p.diver) &&
    typeof p.owner === 'string' && p.owner.length <= 64 && Number.isFinite(p.time) && p.time >= 0 && p.time <= w.time && (p.navigator === undefined || typeof p.navigator === 'string' && p.navigator.length <= 20);
}
export function pickupTarget(w, id) {
  const diver = pickupDiver(w), self = w.players[id]; if (!diver || !self) return null;
  const returning = id === diver.id, target = returning ? w.ship : diver;
  const from = self.mode === 'diver' ? self : w.ship, horizontal = Math.hypot(target.x - from.x, target.z - from.z);
  const label = returning ? 'Kestrel · pickup arranged' : `${diver.name} · live pickup`;
  const y = returning || self.mode !== 'diver' ? 0 : diver.y;
  const hint = returning ? 'Ascend and return alongside Kestrel. The crew is following your position.' :
    self.mode === 'diver' ? `Find ${diver.name} at ${Math.round(Math.max(0, -diver.y))} m depth. Ascend and return to Kestrel together.` :
    horizontal < 20 ? `Hold position and slow for boarding · ${diver.name} is ${Math.round(Math.max(0, -diver.y))} m deep` :
      `Sail toward ${diver.name}’s live position, then slow and hold for boarding`;
  return { key: 'course', label, x: target.x, y, z: target.z,
    distance: self.mode === 'diver' ? Math.hypot(horizontal, self.y - y) : horizontal,
    detail: `${Math.round(Math.max(0, -diver.y))} m deep · live pickup`, hint,
    site: { id: 'live-pickup', biome: 'pickup', name: label, x: target.x, y, z: target.z } };
}
