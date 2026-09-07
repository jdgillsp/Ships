// Keep the established night-sky brightness independent of solar irradiance.
// Sky emission and the cloud approximation must use the same radiance scale.
export const NIGHT_LIGHTING_GLSL = /* glsl */ `
float nightRadianceScale(float sunHeight) {
  return 22.0 * (1.0 - smoothstep(-0.10, 0.06, sunHeight));
}
vec3 nightSkyGlow(vec3 dir, vec3 moonDir) {
  float angle = acos(clamp(dot(dir, moonDir), -1.0, 1.0));
  float halo = exp(-angle * angle / 0.012);
  return vec3(.003, .007, .018) * (.4 + max(dir.y, 0.0) * .6 + halo * 1.2);
}
`;
