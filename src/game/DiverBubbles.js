import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { BubbleTrail, bubblePose, BUBBLE_LIMIT } from './BubbleTrail.js';

export class DiverBubbles {
  constructor(app) {
    this.app = app; this.trail = new BubbleTrail(); this.previousTime = null; this.mouth = new THREE.Vector3();
    const geometry = this.geometry = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['aPrevious', 3], ['aRadius', 1], ['aOpacity', 1]]) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(BUBBLE_LIMIT * size), size).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = this.material = new THREE.ShaderMaterial({ name: 'diver-bubbles', glslVersion: THREE.GLSL3, uniforms: { ...U }, transparent: true, depthWrite: false,
      vertexShader: `attribute vec3 aPrevious; attribute float aRadius,aOpacity;
        uniform vec3 uCamPos; uniform vec2 uResolution; uniform mat4 uViewProjNJ,uPrevViewProjNJ;
        varying vec3 vWorld,vRight,vUp; varying vec4 vClip,vPrevious; varying float vAlpha,vDistance;
        void main(){
          vec4 p=viewMatrix*vec4(position,1.);vWorld=position;vDistance=length(position-uCamPos);
          vRight=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
          vUp=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
          vClip=uViewProjNJ*vec4(position,1.);vPrevious=uPrevViewProjNJ*vec4(aPrevious,1.);
          gl_Position=projectionMatrix*p;
          gl_PointSize=clamp(aRadius*projectionMatrix[1][1]*uResolution.y/max(.1,-p.z),1.,64.);
          vAlpha=aOpacity*smoothstep(.45,1.1,vDistance)*(1.-smoothstep(22.,40.,vDistance));
        }`,
      fragmentShader: `uniform vec3 uCamPos,uSunDir,uSunColor,uExtinction,uWaterTint,uDiveForward;
        uniform float uSunIntensity,uLamp,uEnvMaxLod; uniform sampler2D uEnvMap;
        varying vec3 vWorld,vRight,vUp; varying vec4 vClip,vPrevious; varying float vAlpha,vDistance;
        layout(location=0) out vec4 outColor; layout(location=1) out vec4 outVelocity;
        void main(){
          vec2 q=gl_PointCoord*2.-1.;float r=dot(q,q);if(r>=1.||vAlpha<.001)discard;
          float z=sqrt(1.-r);vec3 V=normalize(uCamPos-vWorld),N=normalize(q.x*vRight-q.y*vUp+z*V);
          vec3 reflected=reflect(-V,N);vec2 uv=vec2(atan(reflected.z,reflected.x)/6.283185+.5,acos(clamp(reflected.y,-1.,1.))/3.141593);
          vec3 light=exp(-uExtinction*max(0.,-vWorld.y)/max(.25,uSunDir.y));
          vec3 c=textureLod(uEnvMap,uv,min(1.,uEnvMaxLod)).rgb*light*.75;
          c+=uSunColor*uSunIntensity*pow(max(dot(N,normalize(V+uSunDir)),0.),70.)*light*.2;
          float beam=smoothstep(.85,.97,dot(-V,uDiveForward))*uLamp/(1.+vDistance*vDistance*.025);
          c+=vec3(.65,.8,.82)*beam*(.12+pow(max(dot(N,V),0.),60.));
          c=mix(uWaterTint*.35*light,c,exp(-uExtinction*vDistance));
          float rim=.04+.7*pow(1.-z,2.);float edge=1.-smoothstep(1.-max(fwidth(r),.025),1.,r);
          float alpha=vAlpha*rim*edge;
          outColor=vec4(c,alpha);outVelocity=vec4((vClip.xy/vClip.w-vPrevious.xy/vPrevious.w)*.5,vDistance,alpha);
        }` });
    this.air = new THREE.Points(geometry, material); this.air.name = 'Diver exhalation'; this.air.frustumCulled = false; this.air.renderOrder = 11;
    this.water = this.air.clone(); app.scene.add(this.air); app.underwater.scene.add(this.water);
  }
  update(world, models) {
    const emitters = Object.values(world.players).flatMap((p, i) => {
      if (!p.connected || p.mode !== 'diver' || p.y > -.4) return [];
      models.crewRigs[i].head.localToWorld(this.mouth.set(0, .14, .235));
      return [{ id: p.id, x: this.mouth.x, y: this.mouth.y, z: this.mouth.z }];
    });
    const bubbles = this.trail.update(emitters, world.time, world.storm), camera = this.app.camera.position;
    const previous = this.previousTime === null || world.time < this.previousTime || world.time - this.previousTime > 1 ? world.time : this.previousTime;
    this.previousTime = world.time;
    const particles = bubbles.map(b => ({ b, pose: bubblePose(b, world.time) }));
    particles.sort((a, b) => Math.hypot(b.pose.x - camera.x, b.pose.y - camera.y, b.pose.z - camera.z) - Math.hypot(a.pose.x - camera.x, a.pose.y - camera.y, a.pose.z - camera.z));
    const attrs = this.geometry.attributes;
    particles.forEach(({ b, pose }, i) => {
      const old = bubblePose(b, Math.max(b.born, previous));
      attrs.position.setXYZ(i, pose.x, pose.y, pose.z); attrs.aPrevious.setXYZ(i, old.x, old.y, old.z);
      attrs.aRadius.setX(i, pose.radius); attrs.aOpacity.setX(i, pose.opacity);
    });
    for (const attr of Object.values(attrs)) attr.needsUpdate = true;
    this.geometry.setDrawRange(0, particles.length); this.air.visible = this.water.visible = particles.length > 0;
  }
}
