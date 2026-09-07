import test from 'node:test';
import assert from 'node:assert/strict';
import { validPhoto, photoFrame, readPhoto, savePhoto, PHOTO_LIMIT } from '../src/underwater/JournalPhotos.js';

test('wildlife photographs stay in frame across portrait, wide and edge views', () => {
 for (const [width,height] of [[1280,800],[390,800],[2400,600]]) for (const x of [-.92,0,.92]) for (const y of [-.88,0,.88]) for (const apparent of [.012,.3,2]) {
   const r=photoFrame(width,height,{x,y,apparent});
   assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=width+.001&&r.y+r.height<=height+.001);
   assert.ok(Math.abs(r.width/r.height-4/3)<1e-9);
   const px=(x+1)*width/2,py=(1-y)*height/2;
   assert.ok(px>=r.x&&px<=r.x+r.width&&py>=r.y&&py<=r.y+r.height,'The photographed animal remains inside the crop');
 }
 assert.equal(photoFrame(0,800,{x:0,y:0,apparent:1}),null);
 assert.equal(photoFrame(Infinity,800,{x:0,y:0,apparent:1}),null);
 assert.equal(photoFrame(600,800,{x:NaN,y:0,apparent:1}),null);
});
test('photograph storage is bounded, local and independent of observation records', () => {
 const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
 const photo='data:image/jpeg;base64,/9j/AAAA';
 assert.equal(validPhoto(photo),true);assert.equal(savePhoto(storage,'turtle',photo),true);
 assert.equal(readPhoto(storage,'turtle'),photo);assert.equal(readPhoto(storage,'crab'),null);
 for (const value of ['https://example.com/photo.jpg','data:image/svg+xml;base64,AAAA',photo+'<script>',photo+'A'.repeat(PHOTO_LIMIT)]) assert.equal(validPhoto(value),false);
 assert.equal(savePhoto(storage,'__proto__',photo),false);assert.equal(map.size,1);
 const full={getItem:storage.getItem,setItem:()=>{throw new Error('quota');}};
 assert.equal(savePhoto(full,'turtle',photo+'AA'),false);assert.equal(readPhoto(storage,'turtle'),photo,'Failed replacement preserves the saved photograph');
 assert.equal(readPhoto({getItem:()=>{throw new Error('blocked');}},'turtle'),null);
});

import { ObservationLens } from '../src/game/CrewNaturalist.js';
test('observation optics magnify smoothly and reset without changing the base field of view', () => {
 const a=new ObservationLens(),b=new ObservationLens();a.set(3);b.set(3);
 const first=a.update(1/60);assert.ok(first<68&&first>26,'Zoom eases instead of jumping');
 for(let i=1;i<60;i++)a.update(1/60);for(let i=0;i<120;i++)b.update(1/120);
 assert.ok(Math.abs(a.value-b.value)<1e-9);assert.equal(a.value,3);
 const fov=a.update(0);assert.ok(Math.abs(Math.tan(68*Math.PI/360)/Math.tan(fov*Math.PI/360)-3)<1e-9);
 a.set(99);assert.equal(a.target,3);a.set(NaN);assert.equal(a.target,3);a.set(-2);assert.equal(a.target,1);
 a.reset();assert.equal(a.value,1);assert.ok(Math.abs(a.update(0)-68)<1e-9);
});
