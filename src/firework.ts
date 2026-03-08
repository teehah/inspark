// Firework shell simulation based on real internal structures
// Japanese: warimono (割物), pokamono (ポカ物)
// Western: cylinder shells

// --- Physical constants per shell size ---

export interface ShellSize {
  inches: number;
  height: number;     // burst height (m)
  fuseTime: number;   // launch to burst (s)
  launchVelocity: number; // m/s
  ejectVelocity: number;  // star radial velocity (m/s)
  starCount: number;  // base star count for single-layer
}

// Launch velocity computed from: v0 = (height + 0.5 * g * fuseTime²) / fuseTime
// This ensures shell reaches exact burst height with no-drag ballistic trajectory
function calcLaunchVelocity(height: number, fuseTime: number): number {
  return (height + 0.5 * 9.81 * fuseTime * fuseTime) / fuseTime;
}

export const SHELL_SIZES: Record<number, ShellSize> = {
  3:  { inches: 3,  height: 120, fuseTime: 3.0, launchVelocity: calcLaunchVelocity(120, 3.0), ejectVelocity: 30, starCount: 100 },
  4:  { inches: 4,  height: 150, fuseTime: 3.5, launchVelocity: calcLaunchVelocity(150, 3.5), ejectVelocity: 33, starCount: 125 },
  5:  { inches: 5,  height: 180, fuseTime: 4.0, launchVelocity: calcLaunchVelocity(180, 4.0), ejectVelocity: 35, starCount: 145 },
  6:  { inches: 6,  height: 210, fuseTime: 5.0, launchVelocity: calcLaunchVelocity(210, 5.0), ejectVelocity: 38, starCount: 150 },
  8:  { inches: 8,  height: 270, fuseTime: 6.0, launchVelocity: calcLaunchVelocity(270, 6.0), ejectVelocity: 42, starCount: 155 },
  10: { inches: 10, height: 320, fuseTime: 6.5, launchVelocity: calcLaunchVelocity(320, 6.5), ejectVelocity: 45, starCount: 250 },
  12: { inches: 12, height: 350, fuseTime: 7.0, launchVelocity: calcLaunchVelocity(350, 7.0), ejectVelocity: 48, starCount: 400 },
};

// --- Colors (normalized, will be scaled to HDR in shader) ---

export interface FireworkColor {
  name: string;
  r: number; g: number; b: number;
}

export const COLORS: FireworkColor[] = [
  { name: 'red',    r: 1.0, g: 0.06, b: 0.02 },
  { name: 'green',  r: 0.06, g: 1.0, b: 0.06 },
  { name: 'blue',   r: 0.04, g: 0.08, b: 1.0 },
  { name: 'yellow', r: 1.0, g: 0.9,  b: 0.1 },
  { name: 'orange', r: 1.0, g: 0.4,  b: 0.04 },
  { name: 'white',  r: 1.0, g: 0.92, b: 0.83 },
  { name: 'gold',   r: 0.8, g: 0.5,  b: 0.1 },
  { name: 'purple', r: 0.6, g: 0.06, b: 0.8 },
  { name: 'silver', r: 0.9, g: 0.9,  b: 0.95 },
];

// --- Star type: defines individual star behavior ---

interface StarType {
  burnTime: number;     // base burn time (s)
  drag: number;         // air drag coefficient
  trailEchoes: number;  // number of trail echo particles (0 = no trail, like botan)
  trailInterval: number; // seconds between echoes
  pointSize: number;    // render size
}

const STAR_TYPES = {
  // 牡丹 (Botan) - no trail, clean color points
  botan: { burnTime: 2.0, drag: 0.2, trailEchoes: 0, trailInterval: 0, pointSize: 2.2 },
  // 菊 (Kiku) - comet tail, visible trails
  kiku: { burnTime: 3.0, drag: 0.4, trailEchoes: 6, trailInterval: 0.01, pointSize: 2.5 },
  // 柳 (Yanagi) - very long burn, heavy droop
  yanagi: { burnTime: 8.0, drag: 0.8, trailEchoes: 8, trailInterval: 0.012, pointSize: 1.8 },
  // 冠 (Kamuro) - long burn, dense glitter trail
  kamuro: { burnTime: 6.0, drag: 0.6, trailEchoes: 8, trailInterval: 0.01, pointSize: 2.0 },
  // 錦 (Nishiki/Brocade) - dim star body, bright trail
  nishiki: { burnTime: 5.0, drag: 0.5, trailEchoes: 8, trailInterval: 0.01, pointSize: 1.2 },
  // Crossette - splits into 4 after delay
  crossette: { burnTime: 2.5, drag: 0.3, trailEchoes: 4, trailInterval: 0.01, pointSize: 2.2 },
  // Dahlia - fewer, larger, bolder stars
  dahlia: { burnTime: 3.5, drag: 0.25, trailEchoes: 4, trailInterval: 0.01, pointSize: 3.5 },
} as const satisfies Record<string, StarType>;

// --- Shell type: defines internal structure ---

// Named firework types based on real internal construction
export type ShellTypeName =
  | 'botan'        // 牡丹 - spherical, no trails
  | 'kiku'         // 菊 - spherical, comet trails
  | 'yanagi'       // 柳 - spherical, very long burn, willow droop
  | 'kamuro'       // 冠 - spherical, long burn, golden cascade
  | 'nishikiKamuro'// 錦冠 - golden brocade kamuro
  | 'ginKamuro'    // 銀冠 - silver kamuro
  | 'shiniri'      // 芯入り - concentric rings (2-3 layers)
  | 'yaeShingiku'  // 八重芯菊 - multi-core chrysanthemum
  | 'senrin'       // 千輪 - cluster of small bursts
  | 'crossette'    // クロセット - splitting stars
  | 'palm'         // 椰子 - few large drooping arms + rising tail
  | 'dahlia'       // ダリア - fewer, larger stars
  | 'multibreak';  // 多段 - sequential bursts

interface ShellTypeConfig {
  // Star arrangement
  arrangement: 'spherical' | 'concentric' | 'subshells';
  starType: keyof typeof STAR_TYPES;
  // For concentric: layer definitions
  layers?: Array<{
    starType: keyof typeof STAR_TYPES;
    starCountRatio: number; // fraction of base star count
    velocityRatio: number;  // fraction of base eject velocity
    colorIndex?: number;    // which color from the color array to use (0-based)
  }>;
  // For subshells (senrin)
  subShellCount?: number;
  // For crossette: split behavior
  splitDelay?: number;  // seconds after burst
  splitCount?: number;  // fragments per star
  // For multi-break
  breakCount?: number;
  // For palm: rising tail
  risingTail?: boolean;
  // Star count multiplier (vs base count for shell size)
  starCountMult?: number;
  // Default colors
  defaultColors: Array<{ outer: string; inner?: string }>;
}

const SHELL_TYPES: Record<ShellTypeName, ShellTypeConfig> = {
  botan: {
    arrangement: 'spherical',
    starType: 'botan',
    defaultColors: [
      { outer: 'red' }, { outer: 'blue' }, { outer: 'green' },
      { outer: 'yellow' }, { outer: 'purple' }, { outer: 'white' },
    ],
  },
  kiku: {
    arrangement: 'spherical',
    starType: 'kiku',
    defaultColors: [
      { outer: 'red', inner: 'green' }, { outer: 'green', inner: 'red' },
      { outer: 'blue', inner: 'white' }, { outer: 'gold', inner: 'red' },
      { outer: 'purple', inner: 'silver' }, { outer: 'white' },
    ],
  },
  yanagi: {
    arrangement: 'spherical',
    starType: 'yanagi',
    defaultColors: [{ outer: 'gold' }, { outer: 'silver' }],
  },
  kamuro: {
    arrangement: 'spherical',
    starType: 'kamuro',
    defaultColors: [{ outer: 'gold' }, { outer: 'silver' }],
  },
  nishikiKamuro: {
    arrangement: 'spherical',
    starType: 'kamuro',
    defaultColors: [{ outer: 'gold', inner: 'gold' }],
  },
  ginKamuro: {
    arrangement: 'spherical',
    starType: 'kamuro',
    defaultColors: [{ outer: 'silver', inner: 'silver' }],
  },
  shiniri: {
    arrangement: 'concentric',
    starType: 'kiku',
    layers: [
      { starType: 'botan', starCountRatio: 0.3, velocityRatio: 0.4, colorIndex: 1 },
      { starType: 'kiku', starCountRatio: 1.0, velocityRatio: 1.0, colorIndex: 0 },
    ],
    defaultColors: [
      { outer: 'red', inner: 'green' }, { outer: 'blue', inner: 'yellow' },
      { outer: 'green', inner: 'purple' }, { outer: 'gold', inner: 'red' },
    ],
  },
  yaeShingiku: {
    arrangement: 'concentric',
    starType: 'kiku',
    layers: [
      { starType: 'botan', starCountRatio: 0.15, velocityRatio: 0.25, colorIndex: 2 },
      { starType: 'botan', starCountRatio: 0.25, velocityRatio: 0.5, colorIndex: 1 },
      { starType: 'kiku', starCountRatio: 1.0, velocityRatio: 1.0, colorIndex: 0 },
    ],
    defaultColors: [
      { outer: 'red', inner: 'green' }, { outer: 'blue', inner: 'yellow' },
    ],
  },
  senrin: {
    arrangement: 'subshells',
    starType: 'botan',
    subShellCount: 12,
    starCountMult: 0.15, // each sub-shell is small
    defaultColors: [
      { outer: 'red' }, { outer: 'green' }, { outer: 'blue' },
      { outer: 'yellow' }, { outer: 'white' }, { outer: 'purple' },
    ],
  },
  crossette: {
    arrangement: 'spherical',
    starType: 'crossette',
    splitDelay: 1.5,
    splitCount: 4,
    defaultColors: [
      { outer: 'gold' }, { outer: 'silver' }, { outer: 'red' }, { outer: 'green' },
    ],
  },
  palm: {
    arrangement: 'spherical',
    starType: 'kamuro',
    risingTail: true,
    starCountMult: 0.12, // few large stars
    defaultColors: [{ outer: 'gold' }, { outer: 'orange' }],
  },
  dahlia: {
    arrangement: 'spherical',
    starType: 'dahlia',
    starCountMult: 0.3, // fewer, bolder
    defaultColors: [
      { outer: 'red' }, { outer: 'blue' }, { outer: 'green' },
      { outer: 'purple' }, { outer: 'white' },
    ],
  },
  multibreak: {
    arrangement: 'spherical',
    starType: 'kiku',
    breakCount: 2,
    defaultColors: [{ outer: 'red', inner: 'green' }, { outer: 'blue', inner: 'gold' }],
  },
};

// --- Particle output ---

export interface ParticleData {
  positions: Float32Array;
  velocities: Float32Array;
  birthTimes: Float32Array;
  lifespans: Float32Array;
  dragCoeffs: Float32Array;
  colors: Float32Array;
  colors2: Float32Array;
  flickers: Float32Array;
  randoms: Float32Array;
  sizes: Float32Array;
  count: number;
}

// --- Helpers ---

function randomOnSphere(): [number, number, number] {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
}

function colorByName(name: string): FireworkColor {
  return COLORS.find(c => c.name === name) || COLORS[0];
}

function posAtTime(
  start: [number, number, number],
  vel: [number, number, number],
  k: number, t: number,
): [number, number, number] {
  const g = -9.81;
  if (k < 0.001) {
    return [start[0] + vel[0] * t, start[1] + vel[1] * t + 0.5 * g * t * t, start[2] + vel[2] * t];
  }
  const e = Math.exp(-k * t);
  return [
    start[0] + (vel[0] / k) * (1 - e),
    start[1] + (vel[1] / k) * (1 - e) + 0.5 * g * t * t,
    start[2] + (vel[2] / k) * (1 - e),
  ];
}

// --- Particle buffer builder ---

class ParticleBuilder {
  private positions: Float32Array;
  private velocities: Float32Array;
  private birthTimes: Float32Array;
  private lifespans: Float32Array;
  private dragCoeffs: Float32Array;
  private colors: Float32Array;
  private colors2: Float32Array;
  private flickers: Float32Array;
  private randoms: Float32Array;
  private sizes: Float32Array;
  idx = 0;

  constructor(maxParticles: number) {
    this.positions = new Float32Array(maxParticles * 3);
    this.velocities = new Float32Array(maxParticles * 3);
    this.birthTimes = new Float32Array(maxParticles);
    this.lifespans = new Float32Array(maxParticles);
    this.dragCoeffs = new Float32Array(maxParticles);
    this.colors = new Float32Array(maxParticles * 3);
    this.colors2 = new Float32Array(maxParticles * 3);
    this.flickers = new Float32Array(maxParticles);
    this.randoms = new Float32Array(maxParticles);
    this.sizes = new Float32Array(maxParticles);
  }

  add(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    birth: number, life: number, drag: number,
    c1: FireworkColor, c2: FireworkColor,
    size: number,
  ) {
    const i3 = this.idx * 3;
    this.positions[i3] = px; this.positions[i3 + 1] = py; this.positions[i3 + 2] = pz;
    this.velocities[i3] = vx; this.velocities[i3 + 1] = vy; this.velocities[i3 + 2] = vz;
    this.birthTimes[this.idx] = birth;
    this.lifespans[this.idx] = life;
    this.dragCoeffs[this.idx] = drag;
    this.colors[i3] = c1.r; this.colors[i3 + 1] = c1.g; this.colors[i3 + 2] = c1.b;
    this.colors2[i3] = c2.r; this.colors2[i3 + 1] = c2.g; this.colors2[i3 + 2] = c2.b;
    this.flickers[this.idx] = 0;
    this.randoms[this.idx] = Math.random();
    this.sizes[this.idx] = size;
    this.idx++;
  }

  addWithTrail(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    birth: number, life: number, drag: number,
    c1: FireworkColor, c2: FireworkColor,
    size: number, star: StarType,
  ) {
    this.add(px, py, pz, vx, vy, vz, birth, life, drag, c1, c2, size);
    for (let t = 1; t <= star.trailEchoes; t++) {
      const frac = t / (star.trailEchoes + 1);
      const dimC1 = { ...c1, r: c1.r * (1 - frac * 0.5), g: c1.g * (1 - frac * 0.5), b: c1.b * (1 - frac * 0.5) };
      const dimC2 = { ...c2, r: c2.r * (1 - frac * 0.5), g: c2.g * (1 - frac * 0.5), b: c2.b * (1 - frac * 0.5) };
      this.add(px, py, pz, vx, vy, vz,
        birth + t * star.trailInterval,
        life - t * star.trailInterval,
        drag, dimC1, dimC2,
        size * (1 - frac * 0.6));
    }
  }

  build(): ParticleData {
    const n = this.idx;
    return {
      positions: this.positions.subarray(0, n * 3),
      velocities: this.velocities.subarray(0, n * 3),
      birthTimes: this.birthTimes.subarray(0, n),
      lifespans: this.lifespans.subarray(0, n),
      dragCoeffs: this.dragCoeffs.subarray(0, n),
      colors: this.colors.subarray(0, n * 3),
      colors2: this.colors2.subarray(0, n * 3),
      flickers: this.flickers.subarray(0, n),
      randoms: this.randoms.subarray(0, n),
      sizes: this.sizes.subarray(0, n),
      count: n,
    };
  }
}

// --- Burst generators ---

function emitSphericalBurst(
  b: ParticleBuilder, star: StarType,
  cx: number, cy: number, cz: number,
  burstTime: number, ejectSpeed: number, count: number,
  c1: FireworkColor, c2: FireworkColor,
) {
  for (let i = 0; i < count; i++) {
    const [dx, dy, dz] = randomOnSphere();
    const sv = 0.8 + Math.random() * 0.4;
    const lv = 0.8 + Math.random() * 0.4;
    b.addWithTrail(cx, cy, cz,
      dx * ejectSpeed * sv, dy * ejectSpeed * sv, dz * ejectSpeed * sv,
      burstTime, star.burnTime * lv, star.drag,
      c1, c2, star.pointSize, star);
  }
}

function emitCrossetteBurst(
  b: ParticleBuilder, star: StarType,
  cx: number, cy: number, cz: number,
  burstTime: number, ejectSpeed: number, count: number,
  c1: FireworkColor, c2: FireworkColor,
  splitDelay: number,
) {
  const childStar = STAR_TYPES.kiku;
  for (let i = 0; i < count; i++) {
    const [dx, dy, dz] = randomOnSphere();
    const sv = 0.8 + Math.random() * 0.4;
    const vx = dx * ejectSpeed * sv;
    const vy = dy * ejectSpeed * sv;
    const vz = dz * ejectSpeed * sv;
    const lv = 0.8 + Math.random() * 0.4;

    // Parent star
    b.addWithTrail(cx, cy, cz, vx, vy, vz,
      burstTime, star.burnTime * lv, star.drag,
      c1, c2, star.pointSize, star);

    // Compute split position
    const delay = splitDelay * (0.8 + Math.random() * 0.4);
    const sp = posAtTime([cx, cy, cz], [vx, vy, vz], star.drag, delay);

    // Perpendicular frame from velocity direction
    const vmag = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const n = vmag > 0.01 ? [vx / vmag, vy / vmag, vz / vmag] : [0, 1, 0];
    const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const p1 = cross(n, up);
    normalize(p1);
    const p2 = cross(n, p1);

    const childSpeed = ejectSpeed * 0.5;
    const childBirth = burstTime + delay;
    const childLife = star.burnTime * 0.5;
    const dirs = [p1, [-p1[0], -p1[1], -p1[2]], p2, [-p2[0], -p2[1], -p2[2]]];
    for (const d of dirs) {
      b.addWithTrail(sp[0], sp[1], sp[2],
        d[0] * childSpeed, d[1] * childSpeed, d[2] * childSpeed,
        childBirth, childLife, star.drag * 0.8,
        c1, c2, childStar.pointSize, childStar);
    }
  }
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: number[]) {
  const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (m > 0) { v[0] /= m; v[1] /= m; v[2] /= m; }
}

// --- Main generator ---

export function generateFirework(
  shellType: ShellTypeName,
  shellSize: number,
  launchX: number,
  launchZ: number,
  launchTime: number,
  colorOverrides?: FireworkColor[],
): ParticleData {
  const shell = SHELL_SIZES[shellSize] || SHELL_SIZES[6];
  const type = SHELL_TYPES[shellType];
  const star = STAR_TYPES[type.starType];
  const burstTime = launchTime + shell.fuseTime;
  const burstY = shell.height;

  // Pick colors from overrides or defaults
  const colorSet = type.defaultColors[Math.floor(Math.random() * type.defaultColors.length)];
  const c1 = colorOverrides?.[0] || colorByName(colorSet.outer);
  const c2 = colorOverrides?.[1] || (colorSet.inner ? colorByName(colorSet.inner) : c1);

  const baseCount = Math.round(shell.starCount * (type.starCountMult ?? 1));
  const trailMult = 1 + star.trailEchoes;

  // Estimate max particles
  const sizeScaleEst = (shellSize || 6) / 6;
  const ascTrailEst = Math.round(3 + sizeScaleEst * 5);
  const ascMult = 1 + ascTrailEst;
  let maxParticles = ascMult; // ascending shell
  if (type.risingTail) {
    const tailCountEst = Math.round(6 + sizeScaleEst * 4);
    maxParticles += tailCountEst * ascMult;
  }

  if (type.arrangement === 'concentric' && type.layers) {
    for (const layer of type.layers) {
      const layerStar = STAR_TYPES[layer.starType];
      maxParticles += Math.round(baseCount * layer.starCountRatio) * (1 + layerStar.trailEchoes);
    }
  } else if (type.arrangement === 'subshells') {
    const subCount = type.subShellCount || 8;
    const subStarCount = Math.max(15, baseCount);
    maxParticles += subCount * subStarCount * trailMult;
  } else {
    maxParticles += baseCount * trailMult;
    if (type.splitCount) maxParticles += baseCount * type.splitCount * trailMult;
  }
  if (type.breakCount && type.breakCount > 1) {
    maxParticles += baseCount * trailMult * (type.breakCount - 1);
  }

  const b = new ParticleBuilder(maxParticles + 100);

  // 1. Ascending shell — scale trail with shell size
  const sizeScale = shell.inches / 6; // normalized to 6-inch
  const ascTrailCount = Math.round(3 + sizeScale * 3); // 4 (3") to 9 (12")
  const ascPointSize = 1.5 + sizeScale * 0.8; // 1.5 (3") to 3.1 (12")
  // Ascending trail burns out just before burst (comet timed to match fuse)
  const ascBurnRatio = 0.90 + Math.random() * 0.07; // 90-97% of fuse time
  const ascStar: StarType = {
    burnTime: shell.fuseTime * ascBurnRatio,
    drag: 0,
    trailEchoes: ascTrailCount,
    trailInterval: 0.012,
    pointSize: ascPointSize,
  };
  const goldColor = colorByName('gold');
  b.addWithTrail(launchX, 0, launchZ, 0, shell.launchVelocity, 0,
    launchTime, shell.fuseTime * ascBurnRatio, 0, goldColor, goldColor, ascPointSize, ascStar);

  // 1b. Rising tail (palm) — thick visible trunk
  if (type.risingTail) {
    const tailCount = Math.round(6 + sizeScale * 4);
    for (let i = 0; i < tailCount; i++) {
      const delay = Math.random() * shell.fuseTime * 0.8;
      const spread = (Math.random() - 0.5) * 3 * sizeScale;
      b.addWithTrail(launchX, 0, launchZ,
        spread, shell.launchVelocity * 0.95, spread,
        launchTime + delay, shell.fuseTime - delay, 0,
        goldColor, goldColor, ascPointSize * 0.8, ascStar);
    }
  }

  // 2. Burst based on arrangement
  if (type.arrangement === 'spherical') {
    if (type.splitCount) {
      // Crossette
      emitCrossetteBurst(b, star, launchX, burstY, launchZ,
        burstTime, shell.ejectVelocity, baseCount, c1, c2, type.splitDelay || 1.5);
    } else {
      emitSphericalBurst(b, star, launchX, burstY, launchZ,
        burstTime, shell.ejectVelocity, baseCount, c1, c2);
    }
  } else if (type.arrangement === 'concentric' && type.layers) {
    // 芯入り / 八重芯 - concentric layers
    const layerColors = colorOverrides || [c1, c2];
    for (let li = 0; li < type.layers.length; li++) {
      const layer = type.layers[li];
      const layerStar = STAR_TYPES[layer.starType];
      const count = Math.round(baseCount * layer.starCountRatio);
      const vel = shell.ejectVelocity * layer.velocityRatio;
      // Pick color: use colorIndex, or cycle through available colors
      const ci = layer.colorIndex ?? li;
      const lc1 = layerColors[ci % layerColors.length] || c1;
      const lc2 = layerColors[(ci + 1) % layerColors.length] || lc1;
      // Inner layers burst slightly earlier (closer to charge)
      const layerDelay = li * 0.05; // 50ms between layers
      emitSphericalBurst(b, layerStar, launchX, burstY, launchZ,
        burstTime + layerDelay, vel, count, lc1, lc2);
    }
  } else if (type.arrangement === 'subshells') {
    // 千輪 (Senrin) - sub-shells scatter then burst
    const subCount = type.subShellCount || 8;
    const subStarCount = Math.max(15, baseCount);
    const scatterSpeed = shell.ejectVelocity * 0.3;
    const subDelay = 0.3 + Math.random() * 0.2; // sub-shells burst after short delay

    for (let s = 0; s < subCount; s++) {
      const [dx, dy, dz] = randomOnSphere();
      const subPos = posAtTime(
        [launchX, burstY, launchZ],
        [dx * scatterSpeed, dy * scatterSpeed, dz * scatterSpeed],
        0.2, subDelay);
      // Each sub-shell picks a random color
      const subColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      const subStar = STAR_TYPES.botan;
      emitSphericalBurst(b, subStar, subPos[0], subPos[1], subPos[2],
        burstTime + subDelay, shell.ejectVelocity * 0.5, subStarCount,
        subColor, subColor);
    }
  }

  // 3. Multi-break: additional breaks
  if (type.breakCount && type.breakCount > 1) {
    for (let br = 1; br < type.breakCount; br++) {
      const breakDelay = shell.fuseTime * 0.4 * br;
      const breakTime = burstTime + breakDelay;
      const breakY = burstY + 30 * br + Math.random() * 20;
      const breakColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      const breakColor2 = COLORS[Math.floor(Math.random() * COLORS.length)];
      emitSphericalBurst(b, star, launchX, breakY, launchZ,
        breakTime, shell.ejectVelocity * 0.8, baseCount,
        breakColor, breakColor2);
    }
  }

  return b.build();
}

// --- Convenience: list of all shell types for random selection ---
export const ALL_SHELL_TYPES: ShellTypeName[] = Object.keys(SHELL_TYPES) as ShellTypeName[];
