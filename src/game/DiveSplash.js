import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { DiveSplashTrail, splashPose, SPLASH_LIMIT } from './DiveSplashTrail.js';

export class DiveSplash {
  constructor(app) {
    this.app = app; this.trail = new DiveSplashTrail(); this.previousTime = null;
    this.geometry = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['aPrevious', 3], ['aRadius', 1], ['aOpacity', 1]]) this.geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(SPLASH_LIMIT * size), size).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({ name: 'dive-entry-spray', glslVersion: THREE.GLSL3, uniforms: { ...U }, transparent: true, depthWrite: false,
      vertexShader: `attribute vec3 aPrevious; attribute float aRadius,aOpacity;
        uniform vec3 uCamPos; uniform vec2 uResolution; uniform mat4 uViewProjNJ,uPrevViewProjNJ;
        varying vec3 vWorld,vRight,vUp; varying vec4 vClip,vPrevious; varying float vAlpha,vDistance;
        void main(){
          vec4 p=viewMatrix*vec4(position,1.);vWorld=position;vDistance=length(position-uCamPos);
          vRight=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
          vUp=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
          vClip=uViewProjNJ*vec4(position,1.);vPrevious=uPrevViewProjNJ*vec4(aPrevious,1.);
          gl_Position=projectionMatrix*p;
          gl_PointSize=clamp(aRadius*projectionMatrix[1][1]*uResolution.y/max(.1,-p.z),1.,48.);
          vAlpha=aOpacity*smoothstep(.6,1.4,vDistance)*(1.-smoothstep(28.,50.,vDistance));
        }`,
      fragmentShader: `uniform vec3 uCamPos,uSunDir,uSunColor,uExtinction,uWaterTint;
        uniform float uSunIntensity,uEnvMaxLod; uniform sampler2D uEnvMap;
        varying vec3 vWorld,vRight,vUp; varying vec4 vClip,vPrevious; varying float vAlpha,vDistance;
        layout(location=0) out vec4 outColor; layout(location=1) out vec4 outVelocity;
        void main(){
          vec2 q=gl_PointCoord*2.-1.;float r=dot(q,q);if(r>=1.||vAlpha<.001)discard;
          float z=sqrt(1.-r);vec3 V=normalize(uCamPos-vWorld),N=normalize(q.x*vRight-q.y*vUp+z*V);
          vec3 reflected=reflect(-V,N);vec2 uv=vec2(atan(reflected.z,reflected.x)/6.283185+.5,acos(clamp(reflected.y,-1.,1.))/3.141593);
          vec3 c=textureLod(uEnvMap,uv,min(2.,uEnvMaxLod)).rgb*1.2;
          c+=uSunColor*uSunIntensity*(.055+.22*pow(max(dot(N,normalize(V+uSunDir)),0.),50.));
          float submerged=clamp(-uCamPos.y/max(.01,vWorld.y-uCamPos.y),0.,1.);
          vec3 transmission=exp(-uExtinction*vDistance*submerged);
          c=c*transmission+uWaterTint*.15*(1.-transmission);
          float alpha=vAlpha*.6*(1.-smoothstep(.15,1.,r));
          outColor=vec4(c,alpha);outVelocity=vec4((vClip.xy/vClip.w-vPrevious.xy/vPrevious.w)*.5,vDistance,alpha);
        }` });
    this.air = new THREE.Points(this.geometry, this.material); this.air.name = 'Dive entry spray'; this.air.frustumCulled = false; this.air.renderOrder = 12;
    this.water = this.air.clone(); this.air.visible = this.water.visible = false;
    app.scene.add(this.air); app.underwater.scene.add(this.water);
  }
  update(world) {
    const drops = this.trail.update(Object.values(world.players), world.time, world.storm), camera = this.app.camera.position;
    const previous = this.previousTime === null || world.time < this.previousTime || world.time - this.previousTime > 1 ? world.time : this.previousTime;
    this.previousTime = world.time;
    const particles = drops.map(drop => ({ drop, pose: splashPose(drop, world.time) }));
    const distance = p => (p.x - camera.x) ** 2 + (p.y - camera.y) ** 2 + (p.z - camera.z) ** 2;
    particles.sort((a, b) => distance(b.pose) - distance(a.pose));
    const attrs = this.geometry.attributes;
    particles.forEach(({ drop, pose }, i) => {
      const old = splashPose(drop, Math.max(drop.born, previous));
      attrs.position.setXYZ(i, pose.x, pose.y, pose.z); attrs.aPrevious.setXYZ(i, old.x, old.y, old.z);
      attrs.aRadius.setX(i, pose.radius); attrs.aOpacity.setX(i, pose.opacity);
    });
    if (particles.length) for (const attr of Object.values(attrs)) attr.needsUpdate = true;
    this.geometry.setDrawRange(0, particles.length); this.air.visible = this.water.visible = particles.length > 0;
  }
}
