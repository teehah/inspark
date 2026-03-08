import * as THREE from 'three';
import type { ParticleData } from './firework';
import vertexShader from './shaders/particle.vert?raw';
import fragmentShader from './shaders/particle.frag?raw';

const MAX_PARTICLES = 200_000;

export class ParticleSystem {
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  public points: THREE.Points;

  private posAttr: THREE.BufferAttribute;
  private velAttr: THREE.BufferAttribute;
  private birthAttr: THREE.BufferAttribute;
  private lifeAttr: THREE.BufferAttribute;
  private dragAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;

  private activeCount = 0;

  constructor() {
    this.geometry = new THREE.BufferGeometry();

    // Pre-allocate all buffers
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const vel = new Float32Array(MAX_PARTICLES * 3);
    const birth = new Float32Array(MAX_PARTICLES);
    const life = new Float32Array(MAX_PARTICLES);
    const drag = new Float32Array(MAX_PARTICLES);
    const col = new Float32Array(MAX_PARTICLES * 3);
    const size = new Float32Array(MAX_PARTICLES);

    // Initialize birth times far in the future so particles are hidden
    birth.fill(99999);

    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.velAttr = new THREE.BufferAttribute(vel, 3);
    this.birthAttr = new THREE.BufferAttribute(birth, 1);
    this.lifeAttr = new THREE.BufferAttribute(life, 1);
    this.dragAttr = new THREE.BufferAttribute(drag, 1);
    this.colorAttr = new THREE.BufferAttribute(col, 3);
    this.sizeAttr = new THREE.BufferAttribute(size, 1);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aVelocity', this.velAttr);
    this.geometry.setAttribute('aBirthTime', this.birthAttr);
    this.geometry.setAttribute('aLifespan', this.lifeAttr);
    this.geometry.setAttribute('aDragCoeff', this.dragAttr);
    this.geometry.setAttribute('aColor', this.colorAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;

    // Set draw range to 0 initially
    this.geometry.setDrawRange(0, 0);
  }

  addFirework(data: ParticleData) {
    const offset = this.activeCount;
    if (offset + data.count > MAX_PARTICLES) {
      // Recycle: wrap around to beginning
      this.activeCount = 0;
      this.addFirework(data);
      return;
    }

    const pos = this.posAttr.array as Float32Array;
    const vel = this.velAttr.array as Float32Array;
    const birth = this.birthAttr.array as Float32Array;
    const life = this.lifeAttr.array as Float32Array;
    const drag = this.dragAttr.array as Float32Array;
    const col = this.colorAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;

    pos.set(data.positions, offset * 3);
    vel.set(data.velocities, offset * 3);
    birth.set(data.birthTimes, offset);
    life.set(data.lifespans, offset);
    drag.set(data.dragCoeffs, offset);
    col.set(data.colors, offset * 3);
    size.set(data.sizes, offset);

    this.activeCount = offset + data.count;

    // Mark attributes for upload
    this.posAttr.needsUpdate = true;
    this.velAttr.needsUpdate = true;
    this.birthAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.dragAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;

    this.geometry.setDrawRange(0, this.activeCount);
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time;
  }

  onResize() {
    this.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
  }
}
