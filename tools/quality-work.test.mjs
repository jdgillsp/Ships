import test from 'node:test';
import assert from 'node:assert/strict';
import { Quality } from '../src/core/Quality.js';

function run(interval, work) {
  const q = new Quality('high'); q.onDowngrade = (name, scale) => q.setPreset(name, scale);
  for (let i = 0; i < 120; i++) q.tick(interval, work);
  return q;
}
test('slow browser scheduling does not reduce detail when measured rendering is inexpensive', () => {
  const q = run(100, 8);
  assert.equal(q.presetName, 'high'); assert.equal(q.dynamicScale, 1);
  assert.equal(q.averageMs, 100, 'Performance readouts still report actual frame cadence');
});
test('measured foreground overload and unavailable GPU timing retain quality rescue', () => {
  assert.notEqual(run(100, 100).presetName, 'high');
  assert.notEqual(run(100, undefined).presetName, 'high');
  assert.ok(run(50, 45).effectiveScale < .8);
});
test('pending measurement warmup cannot be mistaken for slow rendering', () => {
  const q = run(100, null);
  assert.equal(q.presetName, 'high'); assert.equal(q.dynamicScale, 1);
});

import { FrameTiming } from '../src/core/FrameTiming.js';
function fixture(extension = true) {
  let now = 0, next = 0, active = null;
  const live = new Set(), records = new Map();
  const gl = {
    CURRENT_QUERY: 1, QUERY_RESULT_AVAILABLE: 2, QUERY_RESULT: 3, disjoint: false,
    isContextLost: () => false, getParameter: () => gl.disjoint, getQuery: () => active,
    createQuery: () => { const q = ++next; live.add(q); records.set(q, { ready: false, ms: 0 }); return q; },
    deleteQuery: q => { assert.notEqual(q, active, 'Never delete an active query'); live.delete(q); },
    beginQuery: (_target, q) => { assert.equal(active, null, 'Queries cannot overlap'); active = q; },
    endQuery: () => { assert.notEqual(active, null); active = null; },
    getQueryParameter: (q, name) => name === gl.QUERY_RESULT_AVAILABLE ? records.get(q).ready : records.get(q).ms * 1e6,
  };
  const timer = new FrameTiming(gl, extension ? { TIME_ELAPSED_EXT: 4, GPU_DISJOINT_EXT: 5 } : null, () => now);
  return { timer, gl, live, advance: n => { now += n; }, finish: ms => { for (const r of records.values()) Object.assign(r, { ready: true, ms }); } };
}
test('frame measurements retain the larger CPU or GPU cost and exclude scheduling gaps', () => {
  const f = fixture(); f.timer.begin(true); assert.equal(f.timer.workMs(100), null);
  f.advance(8); f.timer.end(); f.finish(5); f.advance(92); f.timer.begin(true);
  assert.equal(f.timer.workMs(100), 8); f.advance(4); f.timer.end(); f.finish(40);
  f.advance(96); f.timer.begin(true); assert.equal(f.timer.workMs(100), 40);
  f.advance(70); f.timer.end(); f.finish(10); f.timer.begin(true);
  assert.equal(f.timer.workMs(100), 70, 'CPU bottlenecks remain visible'); f.timer.end();
  f.timer.begin(false); assert.equal(f.live.size, 0); assert.equal(f.timer.workMs(100), 100);
});
test('stalled, unsupported and invalid GPU queries fall back without growing indefinitely', () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) { f.timer.begin(true); f.advance(100); f.timer.end(); }
  assert.ok(f.live.size <= 6); assert.equal(f.timer.workMs(100), 100);
  f.gl.disjoint = true; f.timer.begin(true); assert.equal(f.live.size, 0); assert.equal(f.timer.workMs(100), 100); f.timer.end();
  const missing = fixture(false); missing.timer.begin(true); missing.advance(2); missing.timer.end();
  assert.equal(missing.timer.workMs(80), 80); assert.equal(missing.live.size, 0);
});
test('resize and visibility invalidation discard in-flight old-scene costs', () => {
  const f = fixture(); f.timer.begin(true); f.advance(300); f.timer.reset(); f.timer.end();
  assert.equal(f.live.size, 0); assert.equal(f.timer.latest, null); assert.equal(f.timer.cpuMs, 0);
  f.timer.begin(true); f.advance(8); f.timer.end(); f.finish(5); f.timer.begin(true);
  assert.equal(f.timer.workMs(100), 8); f.timer.end(); f.timer.reset(); assert.equal(f.live.size, 0);
});
test('late GPU results cannot masquerade as current cheap work', () => {
  const f = fixture(); f.timer.begin(true); f.advance(8); f.timer.end();
  f.advance(1000); f.finish(5); f.timer.begin(true);
  assert.equal(f.timer.workMs(100), 100); f.timer.end();
});
