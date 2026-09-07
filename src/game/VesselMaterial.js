import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { SHADING_GLSL } from '../gfx/ShadingGLSL.js';

const cache = new Map();
const finishes = { paint: [.48, .15, .12], metal: [.28, .8, .06], rubber: [.88, 0, .12], glass: [.12, .45, 0], wood: [.85, 0, .2], rust: [.94, .12, .85], lamp: [.3, .1, 0] };

// Ship surfaces must write the ocean renderer's two buffers and remain in its
// linear HDR lighting space. Stock scene materials don't satisfy that contract.
export function material(color, glow = 0, finish = 'paint') {
  const key = `${color}:${glow}:${finish}`;
  if (cache.has(key)) return cache.get(key);
  const [roughness, metalness, weathering] = finishes[finish];
  const result = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
    uniforms: { ...U, color: { value: new THREE.Color(color) }, glow: { value: glow },
      uPrevModelMatrix: { value: new THREE.Matrix4() },
      roughness: { value: roughness }, metalness: { value: metalness }, weathering: { value: weathering }, timber: { value: finish === 'wood' ? 1 : 0 }, workLamp: { value: finish === 'lamp' ? 1 : 0 } },
    vertexShader: `out vec3 world; out vec3 local; out vec3 norm; out vec4 clip; out vec4 prev;
      uniform mat4 uViewProjNJ,uPrevViewProjNJ,uPrevModelMatrix;
      void main(){vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;local=position;
        norm=transpose(inverse(mat3(modelMatrix)))*normal;
        clip=uViewProjNJ*p;prev=uPrevViewProjNJ*uPrevModelMatrix*vec4(position,1.);gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader: `in vec3 world;in vec3 local;in vec3 norm;in vec4 clip;in vec4 prev;
      uniform vec3 color,uCamPos,uSunDir,uSunColor,uAmbientColor,uExtinction,uWaterTint,uDiveForward;
      uniform vec3 uVesselWorkLight0,uVesselWorkLight1,uVesselWorkDirection;
      uniform vec4 uVesselDeckPlane;
      uniform float uVesselLightLevel,workLamp;
      uniform sampler2D uEnvMap,uVesselShadow;
      uniform mat4 uVesselShadowMatrix;
      uniform float glow,roughness,metalness,weathering,timber,uStormFactor,uSunIntensity,uEnvMaxLod,uLamp;
      layout(location=0) out vec4 outColor;layout(location=1) out vec4 outVelocity;
      #define luminance vesselLuminance
      ${SHADING_GLSL}
      #undef luminance
      float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      float shipShade(vec3 p,float nl){
        vec3 q=(uVesselShadowMatrix*vec4(p,1.)).xyz;
        if(any(lessThan(q,vec3(0.)))||any(greaterThan(q,vec3(1.))))return 1.;
        // Compare at each depth texel's center on the receiving surface.
        // A single center depth across the filter footprint falsely shadows
        // sloping panels, especially at low sun, leaving diagonal bands.
        vec3 qx=dFdx(q),qy=dFdy(q);float det=qx.x*qy.y-qx.y*qy.x;
        vec2 slope=abs(det)>1e-12?vec2(qy.y*qx.z-qx.y*qy.z,qx.x*qy.z-qy.x*qx.z)/det:vec2(0.);
        vec2 size=vec2(textureSize(uVesselShadow,0));
        // Bilinear interpolation of a 3x3 comparison filter uses a 4x4
        // footprint; fractional weights prevent visible nine-level bands.
        vec2 pixel=q.xy*size-.5,base=floor(pixel),fraction=fract(pixel);
        float sum=0.,bias=.00006+.00012*(1.-nl);
        for(int y=-1;y<=2;y++)for(int x=-1;x<=2;x++){
          vec2 uv=(base+vec2(float(x),float(y))+.5)/size;
          float receiver=q.z+clamp(dot(slope,uv-q.xy),-.01,.01);
          float weightX=x==-1?1.-fraction.x:x==2?fraction.x:1.;
          float weightY=y==-1?1.-fraction.y:y==2?fraction.y:1.;
          sum+=weightX*weightY*step(receiver-bias,textureLod(uVesselShadow,uv,0.).r);
        }
        return sum/9.;
      }
      vec3 workLight(vec3 source,vec3 N,vec3 albedo){
        // The solid deck stops these broad flood lights from lighting the
        // hull underside or submerged salvage through the ship itself.
        if(dot(uVesselDeckPlane,vec4(world,1.))<0.)return vec3(0.);
        vec3 offset=world-source;float d=length(offset);
        vec3 ray=offset/max(.001,d);
        float cone=smoothstep(.65,.92,dot(ray,uVesselWorkDirection));
        float power=cone*(1.-smoothstep(8.,14.,d))*max(0.,dot(N,-ray))*uVesselLightLevel*6./(1.+d*d*.18);
        return albedo*vec3(1.,.76,.49)*power;
      }
      void main(){
        float d=length(world-uCamPos);vec3 N=normalize(norm)*(gl_FrontFacing?1.:-1.);vec3 V=normalize(uCamPos-world);
        vec3 L=normalize(uSunDir),H=normalize(V+L);float nv=max(dot(N,V),.001),nl=max(dot(N,L),0.);
        float patina=noise3(local*vec3(5.,.7,5.));
        float corroded=smoothstep(.3,.8,weathering);
        float scaleNoise=0.;
        if(corroded>.5){scaleNoise=noise3(local*2.3)*.65+noise3(local*11.)*.35;patina=scaleNoise;}
        float relief=noise3(local*9.)*weathering*mix(.025,.008,corroded);
        vec3 dx=dFdx(world),dy=dFdy(world),r1=cross(dy,N),r2=cross(N,dx);float det=dot(dx,r1);
        N=normalize(abs(det)*N-sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2));
        nl=max(dot(N,L),0.);nv=max(dot(N,V),.001);
        vec3 albedo=color*(1.-weathering*.28*patina);
        albedo=mix(albedo,vec3(.19,.065,.018),smoothstep(.5,.8,patina)*max(0.,weathering-.3));
        if(corroded>.5)albedo*=1.-corroded*(.16*noise3(local*37.)+.12*smoothstep(.58,.72,scaleNoise));
        float grain=sin(local.x*110.+noise3(local*vec3(3.,1.,.3))*12.);
        albedo*=1.-timber*.1*(.5+.5*grain);
        float rough=max(.09,roughness-uStormFactor*.13);
        vec3 f0=mix(vec3(.04),albedo,metalness),F=f0+(1.-f0)*pow(1.-max(dot(V,H),0.),5.);
        vec3 spec=F*ggxD(max(dot(N,H),0.),rough*rough)*smithGGXCorrelated(nv,nl,rough*rough);
        vec3 env=textureLod(uEnvMap,dirToEquirect(reflect(-V,N)),rough*uEnvMaxLod).rgb;
        vec3 amb=textureLod(uEnvMap,dirToEquirect(normalize(vec3(N.x,max(.2,N.y),N.z))),max(0.,uEnvMaxLod-1.)).rgb;
        vec3 transmission=exp(-uExtinction*max(0.,-world.y)/max(.25,L.y));
        vec3 sun=uSunColor*uSunIntensity*(1.-uStormFactor*.85)*shipShade(world,nl)*transmission;
        amb*=sqrt(transmission);env*=transmission;
        vec3 c=albedo*(1.-metalness)*(amb*.6+uAmbientColor*.2)+(albedo*(1.-metalness)/PI_S+spec)*sun*nl;
        c+=env*(f0+(1.-f0)*pow(1.-nv,5.))*(1.-rough*.6)+albedo*glow*mix(1.,uVesselLightLevel,workLamp);
        if(uVesselLightLevel>.001)c+=workLight(uVesselWorkLight0,N,albedo)+workLight(uVesselWorkLight1,N,albedo);
        // Wavelength-dependent absorption ties submerged metal to the reef;
        // the diver's existing lamp also reveals salvage at close range.
        float water=d*clamp(-min(world.y,uCamPos.y)/max(.1,abs(world.y-uCamPos.y)),0.,1.);
        if(world.y<0.||uCamPos.y<0.){
          float beam=smoothstep(.85,.97,dot(-V,uDiveForward))*uLamp/(1.+d*d*.025);
          c+=albedo*beam*2.;c=mix(uWaterTint*.5,c,exp(-uExtinction*water));
        }else c=mix(c,amb,1.-exp(-d*(.00015+uStormFactor*.001)));
        outColor=vec4(c,min(d/400.,.999));outVelocity=vec4((clip.xy/clip.w-prev.xy/prev.w)*.5,d,1.);
      }` });
  cache.set(key, result); return result;
}

export function trackMotion(mesh) {
  let lastFrame = -1;
  const lastWorld = new THREE.Matrix4(), previous = new THREE.Matrix4();
  mesh.onBeforeRender = (renderer, scene, camera, geometry, drawMaterial) => {
    if (!drawMaterial.uniforms?.uPrevModelMatrix) return; // Depth-only shadow pass.
    const frame = U.uFrame.value;
    if (lastFrame !== frame) {
      // New or reappearing objects have no usable history. Multiple draws in
      // one frame must keep the same previous transform for both water passes.
      previous.copy(lastFrame >= 0 && lastFrame === frame - 1 ? lastWorld : mesh.matrixWorld);
      lastWorld.copy(mesh.matrixWorld); lastFrame = frame;
    }
    drawMaterial.uniforms.uPrevModelMatrix.value.copy(previous);
    drawMaterial.uniformsNeedUpdate = true;
  };
  return mesh;
}
