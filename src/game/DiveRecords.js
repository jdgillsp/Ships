import { recordResearchDive } from './ResearchExperience.js';

export const DIVE_RECORD_LIMIT = 64;

export function startDive(w, p) {
  p.diveRecord = { startedAt: w.time, maximumDepth: Math.max(0, -p.y), expedition: w.contract?.number || 1, name: p.name };
  if (w.research?.experience) p.diveRecord.researchRequest = w.research.id;
}
export function measureDive(p) {
  if (p.diveRecord && p.mode === 'diver') p.diveRecord.maximumDepth = Math.max(p.diveRecord.maximumDepth, -p.y, 0);
}
export function finishDive(w, p, assisted) {
  if (!p.diveRecord) return; // Older saves have no reliable entry time.
  measureDive(p); w.diveRecords ??= [];
  const id = (w.diveRecords.at(-1)?.id || 0) + 1;
  w.diveRecords.push({ ...p.diveRecord, id, endedAt: w.time, assisted });
  recordResearchDive(w, w.diveRecords.at(-1));
  if (w.diveRecords.length > DIVE_RECORD_LIMIT) w.diveRecords.shift();
  delete p.diveRecord;
}
export function validDiveRecords(w) {
  const valid = r => r && Number.isFinite(r.startedAt) && r.startedAt >= 0 && r.startedAt <= w.time &&
    Number.isFinite(r.maximumDepth) && r.maximumDepth >= 0 && r.maximumDepth <= 2000 && Number.isSafeInteger(r.expedition) && r.expedition >= 1 && typeof r.name === 'string' && r.name.length <= 20 &&
    (r.researchRequest === undefined || Number.isSafeInteger(r.researchRequest) && r.researchRequest > 0 && r.researchRequest <= w.researchSequence);
  return Object.values(w.players).every(p => p.diveRecord === undefined || p.mode === 'diver' && valid(p.diveRecord)) &&
    (w.diveRecords === undefined || Array.isArray(w.diveRecords) && w.diveRecords.length <= DIVE_RECORD_LIMIT &&
      w.diveRecords.every((r, i) => valid(r) && Number.isSafeInteger(r.id) && r.id > (w.diveRecords[i - 1]?.id || 0) &&
        Number.isFinite(r.endedAt) && r.endedAt >= r.startedAt && r.endedAt <= w.time && typeof r.assisted === 'boolean'));
}
