import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { AnimalMotion } from '../src/underwater/AnimalMotion.js';
import { makeFaunaPopulation, faunaPose } from '../src/underwater/OceanFauna.js';
import { oceanFloor } from '../src/underwater/OceanDomain.js';
import { GENERATOR_DEFAULTS, HABITATS } from '../src/underwater/WorldMath.js';
import { MarineLife } from '../src/underwater/MarineLife.js';
import { BiomeWildlife } from '../src/underwater/BiomeWildlife.js';
import { RockField } from '../src/underwater/AnimalMotion.js';

const recipe = { ...GENERATOR_DEFAULTS, seed: 713 };
const animals = makeFaunaPopulation(recipe);
const environment = { diver: { x: -140, y: -24, z: 140 }, flow: (_p, t) => ({ x: Math.sin(t * .4) * .08, y: .01, z: .03 }) };
function run(Motion, poseAt = faunaPose) {
  const motion = new Motion(animals, (a, t, out) => poseAt(a, t, recipe, out), { floor: (x, z) => oceanFloor(x, z, recipe), perception: 4 });
  const samples = [];
  for (let i = 1; i <= 90; i++) {
    const start = performance.now(); motion.advance(i / 10, environment);
    if (i > 20) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { timing: { median: samples[35], p95: samples[66], animals: animals.length }, poses: motion.poses };
}
const current = run(AnimalMotion);
let reference;
const referenceDir = process.argv.find(arg => arg.startsWith('--reference='))?.slice(12);
if (referenceDir) {
  // Before optimising, copy the four motion modules into an ignored reference
  // directory. Dependencies continue using the current world/terrain modules.
  const before = async name => {
    const source = (await fs.readFile(`${referenceDir}/${name}.js`, 'utf8')).replace(/from (['"])([^'"]+)\1/g, (_match, _quote, spec) => `from ${JSON.stringify(spec.startsWith('.') ? new URL(spec, pathToFileURL(`${process.cwd()}/src/underwater/${name}.js`)).href : import.meta.resolve(spec))}`);
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  };
  const { AnimalMotion: Before } = await before('AnimalMotion');
  const { faunaPose: beforePose } = await before('OceanFauna');
  reference = run(Before, beforePose);
  assert.deepEqual(current.poses, reference.poses, 'Optimisation must preserve every animal pose, orientation and animation state');
  const { MarineLife: BeforeMarine } = await before('MarineLife');
  const habitat = { ...HABITATS[0], ...recipe }, marine = new MarineLife(habitat), oldMarine = new BeforeMarine(habitat);
  for (let i = 1; i <= 60; i++) { marine.update(i / 30, null, environment); oldMarine.update(i / 30, null, environment); }
  assert.deepEqual(marine.schoolMotion.poses, oldMarine.schoolMotion.poses, 'Habitat school movement must remain identical');
  assert.deepEqual(marine.fish.instanceMatrix.array, oldMarine.fish.instanceMatrix.array, 'Habitat fish must retain identical rendered transforms');
  const { BiomeWildlife: BeforeRegional } = await before('BiomeWildlife');
  const regional = new BiomeWildlife(recipe), oldRegional = new BeforeRegional(recipe), rocks = new RockField(), position = { x: -140, y: -24, z: 440 };
  for (let i = 1; i <= 60; i++) { regional.update(i / 30, position, environment, rocks); oldRegional.update(i / 30, position, environment, rocks); }
  assert.ok(regional.visibleCount > 0, 'The regional fixture must render wildlife');
  for (const [id, cell] of regional.cells) assert.deepEqual(cell.motion.poses, oldRegional.cells.get(id).motion.poses, `Regional cell ${id} must preserve movement`);
  for (const [id, pool] of regional.pools) assert.deepEqual(pool.mesh.instanceMatrix.array, oldRegional.pools.get(id).mesh.instanceMatrix.array, `Regional pool ${id} must preserve rendered transforms`);
}
const result = { current: current.timing, reference: reference?.timing, identical: reference ? ['depth communities', 'habitat schools', 'regional wildlife', 'rendered transforms'] : undefined };
await fs.mkdir('tools/shots/motion-perf', { recursive: true });
await fs.writeFile('tools/shots/motion-perf/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
