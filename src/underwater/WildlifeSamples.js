import * as THREE from 'three';

export function readPosition(s){
  if(s.mesh){const p=s.mesh.position;s.x=p.x+s.origin[0];s.y=p.y;s.z=p.z+s.origin[1];}
  else if(s.pose){s.x=s.pose.x;s.y=s.pose.y+(s.centerY||0);s.z=s.pose.z;}
  return s;
}

export function collectWildlife(world) {
  const result=[];
  for(const a of world.fauna.population)result.push(readPosition({...a,id:`fauna-${a.id}`,pose:world.fauna.poses[a.id]}));
  for(const a of world.regionalLife?.observables||[])result.push(readPosition({...a,id:`regional-${a.uid}`}));
  for(const [id,site] of world.sites){
    if(!site.group.visible)continue;
    for(const a of site.life.animals){
      const g=a.mesh.geometry;if(!g.boundingBox)g.computeBoundingBox();
      const size=g.boundingBox.getSize(new THREE.Vector3());
      result.push(readPosition({...a,id:`${id}-${a.type}-${a.index}`,origin:site.habitat.origin,span:Math.max(size.x,size.y,size.z)*a.mesh.scale.x}));
    }
    // A few actual members let the shoal be observed without asking the picker
    // to walk thousands of indistinguishable fish on every UI refresh.
    for(let i=0;i<Math.min(10,site.life.fishData.length);i++){
      const a=site.life.fishData[i];
      result.push(readPosition({...a,id:`${id}-shoal-${i}`,type:'shoal',span:a.scale*2,pose:site.life.schoolMotion.poses[i]}));
    }
  }
  for(const s of world.pelagic.observables||[])if(s.visible)result.push({...s});
  return result;
}
