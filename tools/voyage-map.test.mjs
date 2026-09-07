import test from 'node:test';
import assert from 'node:assert/strict';
import { chartCoordinate, depthContours } from '../src/game/VoyageMap.js';
import { DOMAIN_RADIUS } from '../src/underwater/OceanDomain.js';

test('seabed contours follow known depth fields, including flat and exact-level cells', () => {
  const size = 5, plane = Float32Array.from({ length: size * size }, (_, i) => 50 * (i % size));
  for (const level of [25, 100, 175]) {
    const lines = depthContours(plane, size, level);
    assert.ok(lines.length > 0);
    let length = 0;
    for (const [a, b] of lines) {
      assert.ok(Math.abs(a[0] - level / 50) < 1e-8 && Math.abs(b[0] - level / 50) < 1e-8);
      length += Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    assert.ok(Math.abs(length - 4) < 1e-8, 'A planar depth contour covers the chart once without gaps or duplicates');
  }
  assert.deepEqual(depthContours(new Float32Array(25).fill(100), 5, 100), []);
  assert.deepEqual(depthContours(plane, size, 300), []);
});

test('nautical chart preserves the game north and east conventions', () => {
  assert.equal(chartCoordinate(0), 320);
  assert.equal(chartCoordinate(DOMAIN_RADIUS), 20);
  assert.equal(chartCoordinate(-DOMAIN_RADIUS), 620);
  assert.ok(chartCoordinate(100) < chartCoordinate(0), 'North (+Z) is above the chart center');
  assert.ok(chartCoordinate(-100) > chartCoordinate(0), 'East (-X) is right of the chart center');
});
