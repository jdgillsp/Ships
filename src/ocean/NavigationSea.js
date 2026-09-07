// The broad swell is shared by authoritative ship physics and GPU rendering.
// FFT displacement remains as smaller surface detail in expedition mode.
const waves = [[.055, .035, .9, .45], [-.08, .09, 1.25, .22]];
export function navigationHeight(x, z, time, storm = 0) {
  return waves.reduce((h, [kx, kz, speed, amplitude]) => h + Math.sin(x * kx + z * kz - time * speed) * amplitude, 0) * (1 + storm * 2.2);
}
const number = n => Number.isInteger(n) ? `${n}.0` : String(n);
export const NAVIGATION_SEA_GLSL = `
uniform vec3 uNavigationSea;
vec3 navigationDetail(vec3 displacement) {
  // The authoritative hull follows navigationHeight, not the client FFT.
  // A fixed gain alone still lets storm spectra push metres of water through
  // its deck. Bound detail smoothly in every axis without clipping crests.
  vec3 detail = displacement * 0.16;
  detail *= inversesqrt(vec3(1.0) + detail * detail / (0.45 * 0.45));
  return mix(displacement, detail, uNavigationSea.x);
}
float navigationHeight(vec2 p) {
  return (${waves.map(([x, z, speed, amplitude]) => `sin(dot(p,vec2(${number(x)},${number(z)}))-uNavigationSea.y*${number(speed)})*${number(amplitude)}`).join('+')})*(1.0+uNavigationSea.z*2.2)*uNavigationSea.x;
}
vec2 navigationSlope(vec2 p) {
  return (${waves.map(([x, z, speed, amplitude]) => `cos(dot(p,vec2(${number(x)},${number(z)}))-uNavigationSea.y*${number(speed)})*${number(amplitude)}*vec2(${number(x)},${number(z)})`).join('+')})*(1.0+uNavigationSea.z*2.2)*uNavigationSea.x;
}
`;
