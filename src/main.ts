import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ParticleSystem } from './particleSystem';
import { generateFirework, ALL_SHELL_TYPES } from './firework';
import type { ShellTypeName } from './firework';

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

// --- Ground reference ---
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
const SHELL_SIZES = [3, 4, 5, 6, 8, 10, 12];

let simTime = 0;
let nextLaunchTime = 0.5;

function launchRandomFirework() {
  const shellType = ALL_SHELL_TYPES[Math.floor(Math.random() * ALL_SHELL_TYPES.length)];
  const size = SHELL_SIZES[Math.floor(Math.random() * SHELL_SIZES.length)];
  const x = (Math.random() - 0.5) * 200;
  const z = (Math.random() - 0.5) * 100;

  const data = generateFirework(shellType, size, x, z, simTime);
  particles.addFirework(data);
}

// --- Animation Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.033);
  simTime += dt;

  if (simTime >= nextLaunchTime) {
    launchRandomFirework();
    nextLaunchTime = simTime + 0.8 + Math.random() * 2.0;
  }

  particles.update(simTime);
  controls.update();
  composer.render();
  updateMarkers();
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

// --- Markers (track manual launches) ---
const markersContainer = document.getElementById('markers')!;
const _projVec = new THREE.Vector3();

interface Marker {
  el: HTMLDivElement;
  pos: THREE.Vector3; // 3D world position to track
  created: number;    // simTime when created
  duration: number;
}

const activeMarkers: Marker[] = [];

function addMarker(label: string, x: number, burstY: number, z: number) {
  const el = document.createElement('div');
  el.className = 'marker';
  el.textContent = `▽ ${label}`;
  markersContainer.appendChild(el);
  activeMarkers.push({
    el,
    pos: new THREE.Vector3(x, burstY + 40, z),
    created: simTime,
    duration: 6,
  });
}

function updateMarkers() {
  for (let i = activeMarkers.length - 1; i >= 0; i--) {
    const m = activeMarkers[i];
    if (simTime - m.created > m.duration) {
      m.el.remove();
      activeMarkers.splice(i, 1);
      continue;
    }
    // Project 3D → screen
    _projVec.copy(m.pos);
    _projVec.project(camera);
    const x = ( _projVec.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_projVec.y * 0.5 + 0.5) * window.innerHeight;
    m.el.style.left = `${x}px`;
    m.el.style.top = `${y}px`;
  }
}

// --- Jog Dial (CSS scroll-snap carousel) ---
const SHELL_LABELS: Record<ShellTypeName, string> = {
  botan: '牡丹',
  kiku: '菊',
  yanagi: '柳',
  kamuro: '冠菊',
  nishikiKamuro: '錦冠菊',
  ginKamuro: '銀冠菊',
  shiniri: '芯入',
  yaeShingiku: '八重芯菊',
  senrin: '千輪',
  crossette: '十字',
  palm: '椰子',
  dahlia: 'ダリア',
  multibreak: '段咲き',
};

const jogDial = document.getElementById('jog-dial')!;
const ITEM_H = 40;
let selectedIndex = 0;

// Top spacer so first item can center
const topSpacer = document.createElement('div');
topSpacer.className = 'jog-spacer';
jogDial.appendChild(topSpacer);

// Create items
const jogItems: HTMLDivElement[] = [];
for (let i = 0; i < ALL_SHELL_TYPES.length; i++) {
  const el = document.createElement('div');
  el.className = 'jog-item';
  el.textContent = SHELL_LABELS[ALL_SHELL_TYPES[i]];
  el.dataset.index = String(i);
  jogDial.appendChild(el);
  jogItems.push(el);
}

// Bottom spacer so last item can center
const bottomSpacer = document.createElement('div');
bottomSpacer.className = 'jog-spacer';
jogDial.appendChild(bottomSpacer);

function updateSelection() {
  jogItems.forEach((el, i) => {
    el.classList.toggle('selected', i === selectedIndex);
  });
}

// Detect which item is centered after scroll
jogDial.addEventListener('scroll', () => {
  const containerCenter = jogDial.scrollTop + jogDial.clientHeight / 2;
  let closest = 0;
  let closestDist = Infinity;
  for (let i = 0; i < jogItems.length; i++) {
    const itemCenter = jogItems[i].offsetTop + ITEM_H / 2;
    const dist = Math.abs(itemCenter - containerCenter);
    if (dist < closestDist) {
      closestDist = dist;
      closest = i;
    }
  }
  if (closest !== selectedIndex) {
    selectedIndex = closest;
    updateSelection();
  }
});

updateSelection();

function launchSelected() {
  const type = ALL_SHELL_TYPES[selectedIndex];
  const data = generateFirework(type, 12, 0, 0, simTime);
  particles.addFirework(data);
  addMarker(SHELL_LABELS[type], 0, 350, 0);
}

let launchAfterSnap = false;

jogDial.addEventListener('scrollend', () => {
  if (launchAfterSnap) {
    launchAfterSnap = false;
    launchSelected();
  }
});

// --- Drag to scroll + tap to launch ---
{
  let dragging = false;
  let startY = 0;
  let startScroll = 0;
  let dragMoved = false;
  let tapTarget: HTMLElement | null = null;

  jogDial.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragMoved = false;
    startY = e.clientY;
    startScroll = jogDial.scrollTop;
    tapTarget = e.target as HTMLElement;
    jogDial.setPointerCapture(e.pointerId);
    jogDial.style.scrollSnapType = 'none';
  });

  jogDial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 3) dragMoved = true;
    jogDial.scrollTop = startScroll - dy;
  });

  jogDial.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    jogDial.style.scrollSnapType = 'y mandatory';

    if (!dragMoved) {
      // Tap on an item → launch immediately
      const item = tapTarget?.closest('.jog-item') as HTMLElement | null;
      if (item && item.dataset.index != null) {
        const i = Number(item.dataset.index);
        item.scrollIntoView({ block: 'center', behavior: 'smooth' });
        selectedIndex = i;
        updateSelection();
        launchSelected();
      }
    } else {
      // Drag release → launch after snap settles
      launchAfterSnap = true;
    }
    tapTarget = null;
  });

  jogDial.addEventListener('pointercancel', () => {
    dragging = false;
    tapTarget = null;
    jogDial.style.scrollSnapType = 'y mandatory';
  });
}

// --- Click canvas to launch random ---
canvas.addEventListener('click', () => {
  launchRandomFirework();
});

animate();
