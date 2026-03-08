import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ParticleSystem } from './particleSystem';
import { generateFirework, COLORS } from './firework';
import type { BurstPattern } from './firework';

// --- Scene Setup ---
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
camera.position.set(0, 150, 400);
camera.lookAt(0, 200, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 200, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 800;

// --- Post Processing ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5,  // strength
  0.4,  // radius
  0.1,  // threshold
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// --- Ground reference (subtle grid for spatial orientation) ---
const groundGeo = new THREE.PlaneGeometry(2000, 2000);
const groundMat = new THREE.MeshBasicMaterial({
  color: 0x111122,
  transparent: true,
  opacity: 0.3,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Particle System ---
const particles = new ParticleSystem();
scene.add(particles.points);

// --- Firework Launcher ---
const PATTERNS: BurstPattern[] = ['peony', 'chrysanthemum', 'willow', 'crossette', 'multibreak'];
const SHELL_SIZES = [3, 4, 5, 6, 8];

let simTime = 0;
let nextLaunchTime = 0.5;

function launchRandomFirework() {
  const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
  const size = SHELL_SIZES[Math.floor(Math.random() * SHELL_SIZES.length)];
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const x = (Math.random() - 0.5) * 200;
  const z = (Math.random() - 0.5) * 100;

  const data = generateFirework(pattern, size, x, z, simTime, color);
  particles.addFirework(data);
}

// --- Animation Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.033); // clamp to ~30fps min
  simTime += dt;

  // Launch fireworks at intervals
  if (simTime >= nextLaunchTime) {
    launchRandomFirework();
    nextLaunchTime = simTime + 0.8 + Math.random() * 2.0; // 0.8-2.8s between launches
  }

  particles.update(simTime);
  controls.update();
  composer.render();
}

// --- Resize Handler ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.resolution.set(w, h);
  particles.onResize();
});

// --- Click to launch ---
canvas.addEventListener('click', () => {
  launchRandomFirework();
});

animate();
