import type { ShellTypeName } from './firework';

const SPEED_OF_SOUND = 343;
const MAX_VOICES = 20;

let ctx: AudioContext | null = null;
let masterGain: GainNode;
let compressor: DynamicsCompressorNode;
let noiseBuffer: AudioBuffer;
let crackleBuffer: AudioBuffer;
let activeVoices = 0;

// --- Init ---

export function initAudio() {
  if (ctx) return;
  ctx = new AudioContext();

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  compressor.connect(ctx.destination);

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(compressor);

  noiseBuffer = makeNoise(ctx, 2);
  crackleBuffer = makeCrackle(ctx, 3);
}

function ac(): AudioContext | null {
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// --- Buffer generation ---

function makeNoise(c: AudioContext, dur: number): AudioBuffer {
  const len = c.sampleRate * dur;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeCrackle(c: AudioContext, dur: number): AudioBuffer {
  const len = c.sampleRate * dur;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  const count = Math.floor(dur * 150);
  for (let i = 0; i < count; i++) {
    const t = Math.pow(Math.random(), 1.5);
    const pos = Math.floor(t * len);
    const impLen = Math.floor(c.sampleRate * (0.001 + Math.random() * 0.004));
    const amp = 0.3 + Math.random() * 0.7;
    for (let j = 0; j < impLen && pos + j < len; j++) {
      d[pos + j] += amp * (Math.random() * 2 - 1) * (1 - j / impLen);
    }
  }
  return buf;
}

// --- Helpers ---

function dist(x: number, y: number, z: number, lx: number, ly: number, lz: number): number {
  const dx = x - lx, dy = y - ly, dz = z - lz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function panner(c: AudioContext, x: number, y: number, z: number): PannerNode {
  const p = c.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = 50;
  p.maxDistance = 5000;
  p.rolloffFactor = 1;
  p.positionX.value = x;
  p.positionY.value = y;
  p.positionZ.value = z;
  return p;
}

function voice() { activeVoices++; }
function unvoice() { activeVoices = Math.max(0, activeVoices - 1); }

// --- Phase 1: Explosion ---

function playExplosion(size: number, delay: number, pan: PannerNode) {
  const c = ac();
  if (!c || activeVoices >= MAX_VOICES) return;

  const t0 = c.currentTime + delay;
  const s = size / 6;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(400 - s * 150, t0);
  lp.frequency.exponentialRampToValueAtTime(40, t0 + 0.5 + s * 0.5);
  lp.Q.value = 1.0;

  const g = c.createGain();
  const vol = 0.3 + s * 0.4;
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5 + s * 1.0);

  src.connect(lp).connect(g).connect(pan);
  src.start(t0);
  src.stop(t0 + 1.5 + s);
  voice();
  src.onended = unvoice;
}

// --- Phase 1: Launch thump ---

function playThump(x: number, z: number, size: number, delay: number) {
  const c = ac();
  if (!c || activeVoices >= MAX_VOICES) return;

  const t0 = c.currentTime + delay;
  const s = size / 6;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 120 + s * 30;
  lp.Q.value = 0.7;

  const g = c.createGain();
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(0.15 + s * 0.15, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);

  const p = panner(c, x, 0, z);
  src.connect(lp).connect(g).connect(p).connect(masterGain);
  src.start(t0);
  src.stop(t0 + 0.2);
  voice();
  src.onended = unvoice;
}

// --- Phase 3: Type-specific sustained sounds ---

interface SoundProfile {
  type: 'crackle' | 'sizzle' | 'pops';
  intensity: number;
  duration: number;
}

const PROFILES: Partial<Record<ShellTypeName, SoundProfile>> = {
  kiku:          { type: 'crackle', intensity: 0.6, duration: 2.5 },
  kamuro:        { type: 'crackle', intensity: 1.0, duration: 3.5 },
  nishikiKamuro: { type: 'crackle', intensity: 1.0, duration: 3.5 },
  ginKamuro:     { type: 'crackle', intensity: 0.9, duration: 3.0 },
  yanagi:        { type: 'sizzle',  intensity: 0.5, duration: 5.0 },
  crossette:     { type: 'pops',    intensity: 0.7, duration: 1.5 },
  senrin:        { type: 'pops',    intensity: 0.8, duration: 2.0 },
  multibreak:    { type: 'pops',    intensity: 0.6, duration: 3.0 },
};

function playSustained(size: number, shellType: ShellTypeName, delay: number, pan: PannerNode) {
  const c = ac();
  if (!c) return;

  const prof = PROFILES[shellType];
  if (!prof) return;

  const t0 = c.currentTime + delay;
  const s = size / 6;

  if (prof.type === 'crackle') {
    if (activeVoices >= MAX_VOICES) return;
    const src = c.createBufferSource();
    src.buffer = crackleBuffer;

    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000 + Math.random() * 2000;
    bp.Q.value = 2;

    const g = c.createGain();
    const vol = 0.15 * prof.intensity * s;
    g.gain.setValueAtTime(vol, t0);
    g.gain.setValueAtTime(vol, t0 + prof.duration * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + prof.duration);

    src.connect(bp).connect(g).connect(pan);
    src.start(t0);
    src.stop(t0 + prof.duration);
    voice();
    src.onended = unvoice;

  } else if (prof.type === 'sizzle') {
    if (activeVoices >= MAX_VOICES) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;

    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    hp.Q.value = 0.5;

    const g = c.createGain();
    const vol = 0.08 * prof.intensity * s;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + prof.duration);

    src.connect(hp).connect(g).connect(pan);
    src.start(t0);
    src.stop(t0 + prof.duration);
    voice();
    src.onended = unvoice;

  } else if (prof.type === 'pops') {
    const popCount = Math.floor(3 + s * 4);
    for (let i = 0; i < popCount && activeVoices < MAX_VOICES; i++) {
      const popDelay = delay + 0.1 + Math.random() * prof.duration;
      const popTime = c.currentTime + popDelay;

      const src = c.createBufferSource();
      src.buffer = noiseBuffer;

      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300 + Math.random() * 200;
      lp.Q.value = 0.7;

      const g = c.createGain();
      const vol = 0.1 * prof.intensity * (0.5 + Math.random() * 0.5);
      g.gain.setValueAtTime(0.001, popTime);
      g.gain.linearRampToValueAtTime(vol, popTime + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, popTime + 0.15);

      src.connect(lp).connect(g).connect(pan);
      src.start(popTime);
      src.stop(popTime + 0.2);
      voice();
      src.onended = unvoice;
    }
  }
}

// --- Public API ---

export function playBurst(
  x: number, y: number, z: number,
  size: number, shellType: ShellTypeName,
  lx: number, ly: number, lz: number,
) {
  const c = ac();
  if (!c) return;

  const d = dist(x, y, z, lx, ly, lz);
  const delay = d / SPEED_OF_SOUND;

  // Shared panner for explosion + sustained effect
  const pan = panner(c, x, y, z);

  // Atmospheric absorption: lowpass based on distance
  const atmo = c.createBiquadFilter();
  atmo.type = 'lowpass';
  atmo.frequency.value = Math.max(300, 20000 - d * 15);
  atmo.Q.value = 0.5;

  pan.connect(atmo).connect(masterGain);

  playExplosion(size, delay, pan);
  playSustained(size, shellType, delay, pan);
}

export function playLaunch(
  x: number, z: number, size: number,
  lx: number, ly: number, lz: number,
) {
  const d = dist(x, 0, z, lx, ly, lz);
  const delay = d / SPEED_OF_SOUND;
  playThump(x, z, size, delay);
}

export function updateListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number) {
  if (!ctx) return;
  const L = ctx.listener;
  L.positionX.value = px;
  L.positionY.value = py;
  L.positionZ.value = pz;
  L.forwardX.value = fx;
  L.forwardY.value = fy;
  L.forwardZ.value = fz;
  L.upX.value = 0;
  L.upY.value = 1;
  L.upZ.value = 0;
}
