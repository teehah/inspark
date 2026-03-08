import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ParticleSystem } from './particleSystem';
import { generateFirework, ALL_SHELL_TYPES, SHELL_SIZES as SHELL_SIZE_DATA } from './firework';
import type { ShellTypeName } from './firework';
import { initAudio, playLaunch, playBurst, updateListener, toggleMute } from './audio';

// --- Scene Setup ---
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;

const scene = new THREE.Scene();
const skyColor = new THREE.Color(0x050a1a);
scene.background = skyColor;
scene.fog = new THREE.FogExp2(skyColor, 0.0015);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
camera.position.set(0, 1.5, 300);
camera.lookAt(0, 150, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 150, 0);
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

// --- Moon (NASA texture) ---
const moonTex = new THREE.TextureLoader().load('/moon.jpg');
moonTex.colorSpace = THREE.SRGBColorSpace;
const moonGeo = new THREE.SphereGeometry(12, 48, 48);
const moonMat = new THREE.MeshBasicMaterial({ map: moonTex, color: new THREE.Color(2, 2, 1.9) });
const moon = new THREE.Mesh(moonGeo, moonMat);
moon.position.set(-400, 350, -500);
scene.add(moon);

// --- Ground (wireframe mesh) ---
const groundGeo = new THREE.PlaneGeometry(2000, 2000, 100, 100);
const groundMat = new THREE.MeshBasicMaterial({ color: 0x555540, wireframe: true });
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

// --- Active burst tracking ---
interface ActiveBurst {
  x: number;
  y: number;
  z: number;
  launchTime: number;
  burstTime: number;
  endTime: number;
  shellType: ShellTypeName;
  size: number;
  soundPlayed: boolean;
}

const activeBursts: ActiveBurst[] = [];

// Spectacle rating per shell type (how visually impressive)
const SPECTACLE: Partial<Record<ShellTypeName, number>> = {
  botan: 1.0,
  kiku: 1.2,
  yanagi: 1.3,
  kamuro: 1.3,
  nishikiKamuro: 1.5,
  ginKamuro: 1.5,
  shiniri: 1.8,
  yaeShingiku: 2.5,
  senrin: 2.0,
  crossette: 1.8,
  palm: 1.4,
  dahlia: 1.3,
  multibreak: 2.0,
  hachi: 1.6,
  tobiyusei: 1.6,
  katamono: 2.5,
  tenmetu: 1.4,
  kowari: 1.8,
};

function trackBurst(x: number, y: number, z: number, launchTime: number, burstTime: number, duration: number, shellType: ShellTypeName, size: number) {
  activeBursts.push({ x, y, z, launchTime, burstTime, endTime: burstTime + duration, shellType, size, soundPlayed: false });
}

function launchRandomFirework() {
  const shellType = ALL_SHELL_TYPES[Math.floor(Math.random() * ALL_SHELL_TYPES.length)];
  const size = SHELL_SIZES[Math.floor(Math.random() * SHELL_SIZES.length)];
  const x = (Math.random() - 0.5) * 200;
  const z = (Math.random() - 0.5) * 100;

  const data = generateFirework(shellType, size, x, z, simTime);
  particles.addFirework(data);

  const shell = SHELL_SIZE_DATA[size] || SHELL_SIZE_DATA[6];
  trackBurst(x, shell.height, z, simTime, simTime + shell.fuseTime, 4, shellType, size);
  playLaunch(x, z, size, shell.fuseTime, camera.position.x, camera.position.y, camera.position.z);
}

// --- Flying Camera ---
type FlyState = 'idle' | 'takeoff' | 'flying' | 'landing';
let flyState: FlyState = 'idle';
let flyProgress = 0;
const FLY_SPEED = 0.035;

// Transition
const TRANSITION_DUR = 2.0; // seconds for takeoff/landing
const RISE_HEIGHT = 1.5; // rise to 3m (from 1.5m)
let transitionTime = 0;
const _transFrom = new THREE.Vector3();
const _transTo = new THREE.Vector3();
const _transLookFrom = new THREE.Vector3();
const _transLookTo = new THREE.Vector3();

const HOME_POS = new THREE.Vector3(0, 1.5, 300);
const HOME_TARGET = new THREE.Vector3(0, 150, 0);

// Looping path through the firework burst zone
const FLIGHT_WAYPOINTS = [
  new THREE.Vector3(-80, 180, 200),
  new THREE.Vector3(-120, 280, 50),
  new THREE.Vector3(-50, 340, -80),
  new THREE.Vector3(60, 300, -60),
  new THREE.Vector3(130, 220, 30),
  new THREE.Vector3(80, 160, 150),
  new THREE.Vector3(20, 250, 250),
  new THREE.Vector3(-60, 320, 100),
  new THREE.Vector3(0, 200, 300),
];

let flightPath: THREE.CatmullRomCurve3 | null = null;
const _flyPos = new THREE.Vector3();
const _flyTarget = new THREE.Vector3(0, 220, 0);
const _currentLookAt = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _toBurst = new THREE.Vector3();

let lockedBurst: ActiveBurst | null = null;

function scoreBurst(b: ActiveBurst): number {
  const age = simTime - b.burstTime;
  const freshness = age < 0.5 ? 2.0 : 1.0 / (1.0 + (age - 0.5));
  const remaining = b.endTime - simTime;
  if (remaining < 1.0) return 0;
  const sizeScore = b.size / 6;
  const spectacle = SPECTACLE[b.shellType] ?? 1.0;
  camera.getWorldDirection(_camForward);
  _toBurst.set(b.x, b.y, b.z).sub(camera.position).normalize();
  const dot = _camForward.dot(_toBurst);
  const visibility = Math.max(0, dot * 0.5 + 0.5);
  return freshness * sizeScore * spectacle * visibility;
}

function pickMVF(): ActiveBurst | null {
  for (let i = activeBursts.length - 1; i >= 0; i--) {
    if (simTime > activeBursts[i].endTime) activeBursts.splice(i, 1);
  }
  const active = activeBursts.filter(b => simTime >= b.burstTime);
  if (active.length === 0) return null;
  let best: ActiveBurst | null = null;
  let bestScore = -1;
  for (const b of active) {
    const s = scoreBurst(b);
    const adjusted = (b === lockedBurst) ? s * 0.8 : s;
    if (adjusted > bestScore) { bestScore = adjusted; best = b; }
  }
  return best;
}

// Smooth ease in-out
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

function startTakeoff() {
  controls.enabled = false;
  flyState = 'takeoff';
  transitionTime = 0;
  _transFrom.copy(camera.position);
  _transTo.copy(camera.position).setY(camera.position.y + RISE_HEIGHT);
  _transLookFrom.copy(controls.target);
  _transLookTo.set(0, 220, 0);
  _currentLookAt.copy(controls.target);
  flyBtn.textContent = '着陸';
  flyBtn.classList.add('flying');
}

function startLanding() {
  flyState = 'landing';
  transitionTime = 0;
  lockedBurst = null;
  _transFrom.copy(camera.position);
  _transTo.copy(HOME_POS);
  _transLookFrom.copy(_currentLookAt);
  _transLookTo.copy(HOME_TARGET);
}

function enterFlying() {
  const points = [camera.position.clone(), ...FLIGHT_WAYPOINTS];
  flightPath = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);
  flyProgress = 0;
  lockedBurst = null;
  flyState = 'flying';
}

function enterIdle() {
  flyState = 'idle';
  camera.position.copy(HOME_POS);
  controls.target.copy(HOME_TARGET);
  camera.lookAt(HOME_TARGET);
  controls.enabled = true;
  flyBtn.textContent = '飛行';
  flyBtn.classList.remove('flying');
}

function updateTransition(dt: number): boolean {
  transitionTime += dt;
  const t = ease(Math.min(transitionTime / TRANSITION_DUR, 1));
  camera.position.lerpVectors(_transFrom, _transTo, t);
  _currentLookAt.lerpVectors(_transLookFrom, _transLookTo, t);
  camera.lookAt(_currentLookAt);
  return transitionTime >= TRANSITION_DUR;
}

function updateFlyingCamera(dt: number) {
  if (!flightPath) return;
  flyProgress = (flyProgress + FLY_SPEED * dt) % 1;
  flightPath.getPointAt(flyProgress, _flyPos);
  camera.position.copy(_flyPos);

  if (lockedBurst && simTime > lockedBurst.endTime) {
    lockedBurst = null;
  }
  if (!lockedBurst) {
    lockedBurst = pickMVF();
  }

  if (lockedBurst) {
    _flyTarget.set(lockedBurst.x, getBurstCurrentY(lockedBurst), lockedBurst.z);
  } else {
    _flyTarget.set(0, 220, 0);
  }

  _currentLookAt.lerp(_flyTarget, 0.8 * dt);
  camera.lookAt(_currentLookAt);
}

// --- Button Icons (inline SVG) ---

const flyBtn = document.getElementById('fly-btn')!;
flyBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  initAudio();
  if (flyState === 'idle') {
    startTakeoff();
  } else if (flyState === 'flying') {
    startLanding();
  }
  // Ignore clicks during transitions
});

function createSvgIcon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.innerHTML = paths;
  return svg;
}

const ICON_SOUND_PATHS = '<path d="M3 9v6h4l5 5V4L7 9H3z" fill="white"/><path d="M16.5 12A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z" fill="white"/><path d="M19 12c0-3-1.7-5.6-4-7v2a7 7 0 0 1 0 10v2c2.3-1.4 4-4 4-7z" fill="white"/>';
const ICON_MUTED_PATHS = '<path d="M3 9v6h4l5 5V4L7 9H3z" fill="white"/><path d="M17 9l6 6" stroke="white" stroke-width="2"/><path d="M23 9l-6 6" stroke="white" stroke-width="2"/>';

const muteBtn = document.getElementById('mute-btn')!;
muteBtn.appendChild(createSvgIcon(ICON_SOUND_PATHS));

muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  initAudio();
  const muted = toggleMute();
  muteBtn.replaceChildren(createSvgIcon(muted ? ICON_MUTED_PATHS : ICON_SOUND_PATHS));
});


// --- Animation Loop ---
const clock = new THREE.Clock();
let frameCount = 0;
let fpsTime = 0;
let fps = 0;

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.033);
  simTime += dt;
  frameCount++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = frameCount / fpsTime;
    frameCount = 0;
    fpsTime = 0;
  }

  if (simTime >= nextLaunchTime) {
    launchRandomFirework();
    nextLaunchTime = simTime + 0.8 + Math.random() * 2.0;
  }

  particles.update(simTime);

  // Trigger burst sounds when burstTime is reached
  for (const b of activeBursts) {
    if (!b.soundPlayed && simTime >= b.burstTime) {
      b.soundPlayed = true;
      playBurst(b.x, b.y, b.z, b.size, b.shellType, camera.position.x, camera.position.y, camera.position.z);
    }
  }

  switch (flyState) {
    case 'idle':
      controls.update();
      break;
    case 'takeoff':
      if (updateTransition(dt)) enterFlying();
      break;
    case 'flying':
      updateFlyingCamera(dt);
      break;
    case 'landing':
      if (updateTransition(dt)) enterIdle();
      break;
  }

  // Sync audio listener to camera
  camera.getWorldDirection(_camForward);
  updateListener(
    camera.position.x, camera.position.y, camera.position.z,
    _camForward.x, _camForward.y, _camForward.z,
  );

  composer.render();
  updateMarkers();
  counterEl.textContent = `${particles.particleCount.toLocaleString()} / ${particles.maxParticles.toLocaleString()} | ${fps.toFixed(1)} fps`;
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
  labelEl: HTMLDivElement;  // screen center label
  arrowEl: HTMLDivElement;  // arrow tracking firework position
  burst: ActiveBurst;
  created: number;
  duration: number;
}

const activeMarkers: Marker[] = [];

function addMarker(label: string, burst: ActiveBurst) {
  const labelEl = document.createElement('div');
  labelEl.className = 'marker-label';
  labelEl.textContent = label;
  markersContainer.appendChild(labelEl);

  const arrowEl = document.createElement('div');
  arrowEl.className = 'marker-arrow';
  arrowEl.textContent = '▽';
  markersContainer.appendChild(arrowEl);

  activeMarkers.push({ labelEl, arrowEl, burst, created: simTime, duration: 6 });
}

function getBurstCurrentY(b: ActiveBurst): number {
  if (simTime < b.burstTime) {
    const t = (simTime - b.launchTime) / (b.burstTime - b.launchTime);
    return (1 - (1 - t) * (1 - t)) * b.y;
  }
  return b.y;
}

function updateMarkers() {
  for (let i = activeMarkers.length - 1; i >= 0; i--) {
    const m = activeMarkers[i];
    if (simTime - m.created > m.duration) {
      m.labelEl.remove();
      m.arrowEl.remove();
      activeMarkers.splice(i, 1);
      continue;
    }
    // Arrow tracks firework position
    _projVec.set(m.burst.x, getBurstCurrentY(m.burst), m.burst.z);
    _projVec.project(camera);
    if (_projVec.z > 1) {
      m.arrowEl.style.display = 'none';
    } else {
      m.arrowEl.style.display = '';
      const ax = (_projVec.x * 0.5 + 0.5) * window.innerWidth;
      const ay = (-_projVec.y * 0.5 + 0.5) * window.innerHeight;
      m.arrowEl.style.left = `${ax}px`;
      m.arrowEl.style.top = `${ay}px`;
    }
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
  hachi: '蜂',
  tobiyusei: '飛遊星',
  katamono: '型物',
  tenmetu: '点滅',
  kowari: '小割',
};

const jogDial = document.getElementById('jog-dial')!;
const launchBtn = document.getElementById('launch-btn')!;
let selectedIndex = 0;
let dialOpen = false;

function toggleDial(open?: boolean) {
  dialOpen = open ?? !dialOpen;
  jogDial.classList.toggle('hidden', !dialOpen);
  launchBtn.classList.toggle('open', dialOpen);
}

launchBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  initAudio();
  toggleDial();
});

// Create items: 3 copies for infinite loop
const ITEM_COUNT = ALL_SHELL_TYPES.length;
const COPIES = 3;
const jogItems: HTMLDivElement[] = [];

// Leading spacer
const leadSpacer = document.createElement('div');
leadSpacer.className = 'jog-spacer';
jogDial.appendChild(leadSpacer);

for (let copy = 0; copy < COPIES; copy++) {
  for (let i = 0; i < ITEM_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'jog-item';
    el.textContent = SHELL_LABELS[ALL_SHELL_TYPES[i]];
    el.dataset.index = String(i);
    el.dataset.copy = String(copy);
    jogDial.appendChild(el);
    jogItems.push(el);
  }
}

// Trailing spacer
const trailSpacer = document.createElement('div');
trailSpacer.className = 'jog-spacer';
jogDial.appendChild(trailSpacer);

function updateSelection() {
  const real = selectedIndex % ITEM_COUNT;
  jogItems.forEach((el) => {
    el.classList.toggle('selected', Number(el.dataset.index) === real);
  });
}

// Scroll to middle copy on init
function scrollToMiddleCopy(realIndex: number) {
  const midStart = ITEM_COUNT; // middle copy starts at index ITEM_COUNT
  const target = jogItems[midStart + realIndex];
  jogDial.style.scrollSnapType = 'none';
  target.scrollIntoView({ inline: 'center', behavior: 'instant' as ScrollBehavior });
  requestAnimationFrame(() => { jogDial.style.scrollSnapType = 'x mandatory'; });
}

// Detect which item is centered after scroll
jogDial.addEventListener('scroll', () => {
  const containerCenter = jogDial.scrollLeft + jogDial.clientWidth / 2;
  let closest = 0;
  let closestDist = Infinity;
  for (let i = 0; i < jogItems.length; i++) {
    const itemCenter = jogItems[i].offsetLeft + jogItems[i].offsetWidth / 2;
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
// Start at middle copy
requestAnimationFrame(() => scrollToMiddleCopy(0));

function launchSelected() {
  const type = ALL_SHELL_TYPES[selectedIndex % ITEM_COUNT];
  const size = 12;
  const shell = SHELL_SIZE_DATA[size] || SHELL_SIZE_DATA[6];
  const data = generateFirework(type, size, 0, 0, simTime);
  particles.addFirework(data);
  trackBurst(0, shell.height, 0, simTime, simTime + shell.fuseTime, 4, type, size);
  playLaunch(0, 0, size, shell.fuseTime, camera.position.x, camera.position.y, camera.position.z);
  const burst = activeBursts[activeBursts.length - 1];
  addMarker(SHELL_LABELS[type as ShellTypeName], burst);

  // Flying中はすぐにロックオン
  if (flyState === 'flying') {
    lockedBurst = burst;
  }

  toggleDial(false);
}

let launchAfterSnap = false;

jogDial.addEventListener('scrollend', () => {
  if (launchAfterSnap) {
    launchAfterSnap = false;
    launchSelected();
  }
  // Infinite loop: if in first or last copy, jump to middle copy
  const real = selectedIndex % ITEM_COUNT;
  const copy = Math.floor(selectedIndex / ITEM_COUNT);
  if (copy !== 1) {
    scrollToMiddleCopy(real);
    selectedIndex = ITEM_COUNT + real;
  }
});

// --- Drag to scroll + tap to launch ---
{
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  let dragMoved = false;
  let tapTarget: HTMLElement | null = null;

  jogDial.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragMoved = false;
    startX = e.clientX;
    startScroll = jogDial.scrollLeft;
    tapTarget = e.target as HTMLElement;
    jogDial.setPointerCapture(e.pointerId);
    jogDial.style.scrollSnapType = 'none';
  });

  jogDial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 3) dragMoved = true;
    jogDial.scrollLeft = startScroll - dx;
  });

  jogDial.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    jogDial.style.scrollSnapType = 'x mandatory';

    if (!dragMoved) {
      // Tap on an item → launch immediately
      const item = tapTarget?.closest('.jog-item') as HTMLElement | null;
      if (item && item.dataset.index != null) {
        const i = Number(item.dataset.index);
        item.scrollIntoView({ inline: 'center', behavior: 'smooth' });
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
    jogDial.style.scrollSnapType = 'x mandatory';
  });
}

// --- Particle Counter ---
const counterEl = document.getElementById('particle-counter')!;

// --- Init audio on first user gesture ---
function initOnGesture() {
  initAudio();
  document.removeEventListener('click', initOnGesture);
  document.removeEventListener('touchstart', initOnGesture);
}
document.addEventListener('click', initOnGesture);
document.addEventListener('touchstart', initOnGesture);

// --- Click canvas to launch random ---
canvas.addEventListener('click', () => {
  launchRandomFirework();
});

animate();
