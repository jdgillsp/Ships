import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { oceanFloor } from '../src/underwater/OceanDomain.js';

const referencePath = process.argv.find(a => a.startsWith('--reference='))?.slice(12);
if (!referencePath) throw new Error('Supply --reference=path/to/OceanDomain.js captured before changing the terrain sampler.');
const source = (await fs.readFile(referencePath, 'utf8')).replace(/from (['"])([^'"]+)\1/g, (_match, _quote, spec) => `from ${JSON.stringify(new URL(spec, pathToFileURL(`${process.cwd()}/src/underwater/OceanDomain.js`)).href)}`);
const { oceanFloor: before } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let seed = 713; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const recipes = [{ seed: 713 }, { seed: 12, relief: .3, habitatScale: .65 }, { worldSeed: 997, relief: 2, habitatScale: 1.5 }];
const points = Array.from({ length: 20000 }, () => [(random() - .5) * 4400, (random() - .5) * 4400]);
for (const [x,z] of [[-140,140],[150,110],[0,-170],[0,-760]]) for (let i=0;i<1000;i++) { const angle=random()*Math.PI*2, radius=i%2 ? random()*95 : 95+(random()-.5)*1e-8; points.push([x+Math.cos(angle)*radius,z+Math.sin(angle)*radius]); }
for (const recipe of recipes) for (const [x,z] of points) assert.equal(oceanFloor(x,z,recipe),before(x,z,recipe),'Every sampled depth must remain exactly identical');
const hot = points.slice(20000), timing = { before: [], after: [] }; let sink = 0;
const run = (fn, list=hot) => { const start=performance.now();for(let n=0;n<12;n++)for(const [x,z] of list)sink+=fn(x,z,recipes[0]);return performance.now()-start; };
run(before);run(oceanFloor);
for(let i=0;i<9;i++){if(i%2){timing.after.push(run(oceanFloor));timing.before.push(run(before));}else{timing.before.push(run(before));timing.after.push(run(oceanFloor));}}
const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const result = { exactDepths: points.length * recipes.length, callsPerSample: hot.length * 12, beforeMs: median(timing.before), afterMs: median(timing.after) }; result.speedup = result.beforeMs / result.afterMs;
const wide=points.slice(0,20000), wideBefore=[], wideAfter=[];
for(let i=0;i<7;i++){if(i%2){wideAfter.push(run(oceanFloor,wide));wideBefore.push(run(before,wide));}else{wideBefore.push(run(before,wide));wideAfter.push(run(oceanFloor,wide));}}
result.wideWorld={callsPerSample:wide.length*12,beforeMs:median(wideBefore),afterMs:median(wideAfter)};
assert.ok(Number.isFinite(sink)); await fs.mkdir('tools/shots/terrain-perf',{recursive:true}); await fs.writeFile('tools/shots/terrain-perf/result.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
if(process.argv.includes('--expect-faster'))assert.ok(result.speedup>1.15,'Habitat floor sampling should improve by at least 15% in this local benchmark');
