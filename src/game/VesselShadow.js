import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';

// A small local sun map supplies cabin/rail contact shadows without enabling
// Three's light system in the custom ocean renderer.
export class VesselShadow {
  constructor(renderer, root) {
    this.renderer = renderer; this.scene = new THREE.Scene(); this.root = root.clone(true); this.scene.add(this.root);
    this.scene.overrideMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    this.source = []; this.copy = []; root.traverse(o => this.source.push(o)); this.root.traverse(o => this.copy.push(o));
    // The cutter fits inside this radius through heading, pitch and roll.
    // Concentrate the existing texture on it instead of empty surrounding sea.
    this.camera = new THREE.OrthographicCamera(-16, 16, 16, -16, 1, 180);
    this.target = new THREE.WebGLRenderTarget(1024, 1024, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.target.depthTexture = new THREE.DepthTexture(1024, 1024, THREE.UnsignedIntType);
    U.uVesselShadow.value = this.target.depthTexture;
    this.bias = new THREE.Matrix4().set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1);
  }
  update(ship, force = false) {
    // The hull moves on every render frame. Reusing a three-frame-old depth
    // map makes shadows slide across it, then snap back on the refresh frame.
    for (let i=0;i<this.source.length;i++) { const a=this.source[i],b=this.copy[i];b.position.copy(a.position);b.quaternion.copy(a.quaternion);b.scale.copy(a.scale);b.visible=a.visible; }
    const target = ship.position.clone(); target.y = 1;
    this.camera.position.copy(target).addScaledVector(U.uSunDir.value, 85); this.camera.lookAt(target); this.camera.updateMatrixWorld();
    U.uVesselShadowMatrix.value.copy(this.bias).multiply(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
    const previous=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.target);this.renderer.clear();this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(previous);
  }
}
