import { biomeAt } from '../underwater/BiomeLayout.js';
import { DOMAIN_RADIUS } from '../underwater/OceanDomain.js';

export const chartCoordinate = v => 320 - v / DOMAIN_RADIUS * 300;
export const CHART_DEPTHS = [50, 100, 200, 500, 1000, 1400];

// Triangulating each cell avoids ambiguous saddle connections and preserves
// the sampled seabed instead of inventing decorative contour lines.
export function depthContours(depths, size, level) {
  const segments = [];
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const a = [x, y], b = [x + 1, y], c = [x + 1, y + 1], d = [x, y + 1];
    for (const triangle of [[a, b, c], [a, c, d]]) {
      const hits = [];
      for (let i = 0; i < 3; i++) {
        const p = triangle[i], q = triangle[(i + 1) % 3];
        const from = depths[p[1] * size + p[0]], to = depths[q[1] * size + q[0]];
        if ((from >= level) === (to >= level)) continue;
        const t = (level - from) / (to - from);
        hits.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
      if (hits.length === 2 && Math.hypot(hits[0][0] - hits[1][0], hits[0][1] - hits[1][1]) > 1e-8) segments.push(hits);
    }
  }
  return segments;
}

export function makeVoyageBackground() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640;
  const c = canvas.getContext('2d'); c.fillStyle = '#e2dfca'; c.fillRect(0, 0, 640, 640);
  const size = 129, depths = new Float32Array(size * size);
  const wash = document.createElement('canvas'); wash.width = wash.height = size;
  const wc = wash.getContext('2d'), pixels = wc.createImageData(size, size);
  const colors = [[191, 204, 175], [202, 200, 155], [176, 198, 193], [145, 171, 179]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const biome = biomeAt(DOMAIN_RADIUS * (1 - x / (size - 1) * 2), DOMAIN_RADIUS * (1 - y / (size - 1) * 2), { seed: 713 });
    depths[y * size + x] = biome.depth;
    const weights = [biome.reef, biome.kelp, Math.max(0, 1 - biome.reef - biome.kelp - biome.deep), biome.deep];
    const offset = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] = colors.reduce((sum, color, i) => sum + color[channel] * weights[i], 0);
    pixels.data[offset + 3] = 255;
  }
  wc.putImageData(pixels, 0, 0);
  c.save(); c.beginPath(); c.arc(320, 320, 300, 0, Math.PI * 2); c.clip();
  c.drawImage(wash, 20, 20, 600, 600);
  c.strokeStyle = '#536d6130'; c.lineWidth = 1;
  for (let v = -2000; v <= 2000; v += 500) {
    c.beginPath(); c.moveTo(chartCoordinate(v), 20); c.lineTo(chartCoordinate(v), 620);
    c.moveTo(20, chartCoordinate(v)); c.lineTo(620, chartCoordinate(v)); c.stroke();
  }
  CHART_DEPTHS.forEach((level, index) => {
    const lines = depthContours(depths, size, level), scale = 600 / (size - 1);
    c.strokeStyle = '#506f6b99'; c.lineWidth = .8; c.beginPath();
    for (const [a, b] of lines) { c.moveTo(20 + a[0] * scale, 20 + a[1] * scale); c.lineTo(20 + b[0] * scale, 20 + b[1] * scale); }
    c.stroke();
    const labelX = 80 + index * 90;
    const line = lines.reduce((best, item) => !best || Math.abs(20 + item[0][0] * scale - labelX) < Math.abs(20 + best[0][0] * scale - labelX) ? item : best, null);
    if (line) {
      const x = 20 + line[0][0] * scale, y = 20 + line[0][1] * scale;
      c.font = '12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.strokeStyle = '#d7ded0'; c.lineWidth = 4; c.strokeText(String(level), x, y);
      c.fillStyle = '#38554f'; c.fillText(String(level), x, y);
    }
  });
  c.restore(); c.strokeStyle = '#566e60'; c.lineWidth = 1.5;
  c.beginPath(); c.arc(320, 320, 300, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#304b42'; c.textAlign = 'center'; c.font = '16px Georgia';
  c.fillText('N', 320, 15); c.fillText('S', 320, 637); c.fillText('W', 9, 326); c.fillText('E', 631, 326);
  c.font = '12px system-ui'; c.fillText('500 m', 89, 632);
  c.beginPath(); c.moveTo(55, 610); c.lineTo(55, 617); c.lineTo(55 + 500 / DOMAIN_RADIUS * 300, 617); c.lineTo(55 + 500 / DOMAIN_RADIUS * 300, 610); c.stroke();
  return canvas;
}
