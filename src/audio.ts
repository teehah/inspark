import type { ShellTypeName } from './firework';

const SPEED_OF_SOUND = 343;
const MAX_VOICES = 30;
// Voice budget: explosion always plays, others have lower limits
const VOICE_LIMIT_EXPLOSION = 30;
const VOICE_LIMIT_SUSTAINED = 24;
const VOICE_LIMIT_THUMP     = 18;
const VOICE_LIMIT_ASCENDING = 14;

let ctx: AudioContext | null = null;
let masterGain: GainNode;
let compressor: DynamicsCompressorNode;
let noiseBuffer: AudioBuffer;
let pinkBuffer: AudioBuffer;
let crackleBuffer: AudioBuffer;
let distortionCurve: Float32Array;
let activeVoices = 0;

// --- Init ---

export function initAudio() {
  if (ctx) return;
  ctx = new AudioContext();

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -3;
  compressor.knee.value = 6;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  compressor.connect(ctx.destination);

  masterGain = ctx.createGain();
  masterGain.gain.value = 2.0;
  masterGain.connect(compressor);

  noiseBuffer = makeNoise(ctx, 2);
  pinkBuffer = makePinkNoise(ctx, 4);
  crackleBuffer = makeCrackle(ctx, 3);
  distortionCurve = makeDistortionCurve(8);
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

function makePinkNoise(c: AudioContext, dur: number): AudioBuffer {
  const len = c.sampleRate * dur;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  // Paul Kellet's refined pink noise generator
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

function makeCrackle(c: AudioContext, dur: number): AudioBuffer {
  const len = c.sampleRate * dur;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  const count = Math.floor(dur * 80);
  for (let i = 0; i < count; i++) {
    const t = Math.pow(Math.random(), 1.5);
    const pos = Math.floor(t * len);
    const impLen = Math.floor(c.sampleRate * (0.0005 + Math.random() * 0.002));
    const amp = 0.15 + Math.random() * 0.35;
    for (let j = 0; j < impLen && pos + j < len; j++) {
      d[pos + j] += amp * (Math.random() * 2 - 1) * (1 - j / impLen);
    }
  }
  // Clamp to prevent stacked spikes
  for (let i = 0; i < len; i++) d[i] = Math.max(-0.5, Math.min(0.5, d[i]));
  return buf;
}

function makeDistortionCurve(amount: number): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// --- Helpers ---

function dist(x: number, y: number, z: number, lx: number, ly: number, lz: number): number {
  const dx = x - lx, dy = y - ly, dz = z - lz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function panner(c: AudioContext, x: number, y: number, z: number): PannerNode {
  const p = c.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = 50;
  p.maxDistance = 5000;
  p.rolloffFactor = 0.3;
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
  if (!c || activeVoices >= VOICE_LIMIT_EXPLOSION) return;

  const t0 = c.currentTime + delay;
  const s = size / 6;

  // --- Layer 1: fundamental pulse "どんっ" ---
  const freq = 150 + s * 30;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.05);

  const postLP = c.createBiquadFilter();
  postLP.type = 'lowpass';
  postLP.frequency.value = 200;
  postLP.Q.value = 0.5;

  const oscGain = c.createGain();
  const oscVol = 5.0 + s * 3.5;
  oscGain.gain.setValueAtTime(oscVol, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);

  osc.connect(postLP).connect(oscGain).connect(pan);
  osc.start(t0);
  osc.stop(t0 + 0.25);
  voice();
  osc.onended = unvoice;

  // --- Layer 1b: octave harmonic (missing fundamental effect) ---
  if (activeVoices >= VOICE_LIMIT_EXPLOSION) return;
  const osc2 = c.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(freq * 2, t0);
  osc2.frequency.exponentialRampToValueAtTime(90, t0 + 0.05);

  const lp2 = c.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = 400;
  lp2.Q.value = 0.5;

  const g2 = c.createGain();
  const vol2 = oscVol * 0.35;
  g2.gain.setValueAtTime(vol2, t0);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);

  osc2.connect(lp2).connect(g2).connect(pan);
  osc2.start(t0);
  osc2.stop(t0 + 0.2);
  voice();
  osc2.onended = unvoice;

  // --- Layer 2: noise rumble tail ---
  if (activeVoices >= MAX_VOICES) return;
  const tailDur = 0.3 + s * 0.4;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(250, t0);
  lp.frequency.exponentialRampToValueAtTime(60, t0 + tailDur);
  lp.Q.value = 0.5;

  const g = c.createGain();
  const nVol = 3.0 + s * 2.0;
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(nVol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + tailDur);

  src.connect(lp).connect(g).connect(pan);
  src.start(t0);
  src.stop(t0 + tailDur + 0.05);
  voice();
  src.onended = unvoice;
}

// --- Phase 1: Launch thump ---

function playThump(x: number, z: number, size: number, delay: number) {
  const c = ac();
  if (!c || activeVoices >= VOICE_LIMIT_THUMP) return;

  const t0 = c.currentTime + delay;
  const s = size / 6;

  const p = panner(c, x, 0, z);

  // --- Layer 1: distorted sine "bon" (mortar thump) ---
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180 + s * 40, t0);
  osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.04);

  const drive = c.createGain();
  drive.gain.value = 2.0;

  const shaper = c.createWaveShaper();
  shaper.curve = distortionCurve;
  shaper.oversample = '2x';

  // Keep only the low-end body
  const postLP = c.createBiquadFilter();
  postLP.type = 'lowpass';
  postLP.frequency.value = 200;
  postLP.Q.value = 0.5;

  const oscGain = c.createGain();
  const oscVol = 0.4 + s * 0.3;
  oscGain.gain.setValueAtTime(oscVol, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);

  osc.connect(drive).connect(shaper).connect(postLP).connect(oscGain).connect(p).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + 0.2);
  voice();
  osc.onended = unvoice;

  // --- Layer 2: brief noise transient for attack texture ---
  const nSrc = c.createBufferSource();
  nSrc.buffer = noiseBuffer;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1000;
  lp.Q.value = 0.5;

  const nGain = c.createGain();
  const nVol = 0.1 + s * 0.05;
  nGain.gain.setValueAtTime(0.001, t0);
  nGain.gain.linearRampToValueAtTime(nVol, t0 + 0.003);
  nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);

  nSrc.connect(lp).connect(nGain).connect(p);
  nSrc.start(t0);
  nSrc.stop(t0 + 0.1);
  voice();
  nSrc.onended = unvoice;
}

// --- Ascending whoosh (air resistance sound, decelerating shell) ---

function playAscending(x: number, z: number, size: number, fuseTime: number, delay: number) {
  const c = ac();
  if (!c || activeVoices >= VOICE_LIMIT_ASCENDING) return;

  const t0 = c.currentTime + delay;
  const s = size / 6;
  const dur = fuseTime * 0.9;

  // Thermoacoustic whistle (笛/曲導): resonant tube with pulsed combustion
  // ~30% of shells carry a whistle
  if (Math.random() > 0.3) return;

  const osc = c.createOscillator();
  osc.type = 'triangle';
  // Pitch descends as burning composition lengthens the resonant cavity
  const baseFreq = 1500 + Math.random() * 600;
  osc.frequency.setValueAtTime(baseFreq, t0);
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.65, t0 + dur);

  // Tremolo: multiply approach (LFO modulates a separate gain node)
  const tremNode = c.createGain();
  tremNode.gain.value = 1.0;

  const trem = c.createOscillator();
  trem.type = 'sine';
  trem.frequency.value = 15 + Math.random() * 10;

  const tremDepth = c.createGain();
  tremDepth.gain.value = 0.3; // ±0.3 around 1.0 → range 0.7-1.3
  trem.connect(tremDepth).connect(tremNode.gain);

  const g = c.createGain();
  const vol = 0.003 + s * 0.002;
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.1);
  g.gain.setValueAtTime(vol, t0 + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

  const p = panner(c, x, 0, z);
  osc.connect(tremNode).connect(g).connect(p).connect(masterGain);

  osc.start(t0);
  trem.start(t0);
  osc.stop(t0 + dur);
  trem.stop(t0 + dur);
  voice();
  osc.onended = unvoice;
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

  // Ambient (non-spatialized) path for immersion when close
  const ambient = c.createGain();
  ambient.gain.value = 0.08;
  ambient.connect(masterGain);

  if (prof.type === 'crackle') {
    if (activeVoices >= VOICE_LIMIT_SUSTAINED) return;
    const src = c.createBufferSource();
    src.buffer = crackleBuffer;
    src.loop = true;

    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000 + Math.random() * 2000;
    bp.Q.value = 0.5;

    const g = c.createGain();
    const vol = 0.06 * prof.intensity * s;
    g.gain.setValueAtTime(vol, t0);
    g.gain.setValueAtTime(vol, t0 + prof.duration * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + prof.duration);

    src.connect(bp).connect(g);
    g.connect(pan);      // spatialized
    g.connect(ambient);  // non-spatialized
    src.start(t0);
    src.stop(t0 + prof.duration);
    voice();
    src.onended = unvoice;

  } else if (prof.type === 'sizzle') {
    if (activeVoices >= VOICE_LIMIT_SUSTAINED) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;

    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    hp.Q.value = 0.5;

    const g = c.createGain();
    const vol = 0.035 * prof.intensity * s;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + prof.duration);

    src.connect(hp).connect(g);
    g.connect(pan);
    g.connect(ambient);
    src.start(t0);
    src.stop(t0 + prof.duration);
    voice();
    src.onended = unvoice;

  } else if (prof.type === 'pops') {
    const popCount = Math.floor(3 + s * 4);
    for (let i = 0; i < popCount && activeVoices < VOICE_LIMIT_SUSTAINED; i++) {
      const popDelay = delay + 0.1 + Math.random() * prof.duration;
      const popTime = c.currentTime + popDelay;

      const src = c.createBufferSource();
      src.buffer = noiseBuffer;

      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600 + Math.random() * 400;
      lp.Q.value = 0.5;

      const g = c.createGain();
      const vol = 0.12 * prof.intensity * (0.5 + Math.random() * 0.5);
      g.gain.setValueAtTime(0.001, popTime);
      g.gain.linearRampToValueAtTime(vol, popTime + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, popTime + 0.15);

      src.connect(lp).connect(g);
      g.connect(pan);
      g.connect(ambient);
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
  x: number, z: number, size: number, fuseTime: number,
  lx: number, ly: number, lz: number,
) {
  const d = dist(x, 0, z, lx, ly, lz);
  const delay = d / SPEED_OF_SOUND;
  playThump(x, z, size, delay);
  playAscending(x, z, size, fuseTime, delay);
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
