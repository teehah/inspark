// Firework shell definitions based on real-world data

export interface ShellConfig {
  size: number;       // inches
  height: number;     // burst height in meters
  burstRadius: number; // meters
  starCount: number;
  fuseTime: number;   // seconds
  starBurnTime: number; // seconds
  launchVelocity: number; // m/s
  starEjectVelocity: number; // m/s
}

export const SHELL_CONFIGS: Record<number, ShellConfig> = {
  3:  { size: 3,  height: 120, burstRadius: 20, starCount: 100, fuseTime: 3.0, starBurnTime: 2.0, launchVelocity: 45, starEjectVelocity: 30 },
  4:  { size: 4,  height: 150, burstRadius: 27, starCount: 125, fuseTime: 3.5, starBurnTime: 2.5, launchVelocity: 48, starEjectVelocity: 33 },
  5:  { size: 5,  height: 180, burstRadius: 34, starCount: 145, fuseTime: 4.0, starBurnTime: 3.0, launchVelocity: 50, starEjectVelocity: 35 },
  6:  { size: 6,  height: 210, burstRadius: 41, starCount: 150, fuseTime: 5.0, starBurnTime: 3.5, launchVelocity: 52, starEjectVelocity: 38 },
  8:  { size: 8,  height: 270, burstRadius: 55, starCount: 155, fuseTime: 6.0, starBurnTime: 4.0, launchVelocity: 55, starEjectVelocity: 42 },
  10: { size: 10, height: 320, burstRadius: 69, starCount: 250, fuseTime: 6.5, starBurnTime: 5.0, launchVelocity: 58, starEjectVelocity: 45 },
  12: { size: 12, height: 350, burstRadius: 82, starCount: 400, fuseTime: 7.0, starBurnTime: 6.0, launchVelocity: 60, starEjectVelocity: 48 },
};

export type BurstPattern = 'peony' | 'chrysanthemum' | 'willow' | 'crossette' | 'multibreak';

export interface FireworkColor {
  name: string;
  r: number;
  g: number;
  b: number;
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
];

// Drag coefficients per burst pattern
const DRAG: Record<BurstPattern, number> = {
  peony: 0.2,
  chrysanthemum: 0.4,
  willow: 0.8,
  crossette: 0.3,
  multibreak: 0.2,
};

export interface ParticleData {
  positions: Float32Array;  // xyz
  velocities: Float32Array; // xyz
  birthTimes: Float32Array;
  lifespans: Float32Array;
  dragCoeffs: Float32Array;
  colors: Float32Array;     // rgb
  sizes: Float32Array;
  count: number;
}

function randomOnSphere(): [number, number, number] {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const x = Math.sin(phi) * Math.cos(theta);
  const y = Math.sin(phi) * Math.sin(theta);
  const z = Math.cos(phi);
  return [x, y, z];
}

// Compute position at time t using drag approximation
function posAtTime(
  start: [number, number, number],
  vel: [number, number, number],
  k: number,
  t: number
): [number, number, number] {
  const g = -9.81;
  if (k < 0.001) {
    return [
      start[0] + vel[0] * t,
      start[1] + vel[1] * t + 0.5 * g * t * t,
      start[2] + vel[2] * t,
    ];
  }
  const expKt = Math.exp(-k * t);
  return [
    start[0] + (vel[0] / k) * (1 - expKt),
    start[1] + (vel[1] / k) * (1 - expKt) + 0.5 * g * t * t,
    start[2] + (vel[2] / k) * (1 - expKt),
  ];
}

export function generateFirework(
  pattern: BurstPattern,
  shellSize: number,
  launchX: number,
  launchZ: number,
  launchTime: number,
  color: FireworkColor,
): ParticleData {
  const config = SHELL_CONFIGS[shellSize] || SHELL_CONFIGS[6];
  const drag = DRAG[pattern];
  const burstTime = launchTime + config.fuseTime;
  const burstY = config.height;

  // Trail echo count per star (birthTime-offset ghosts that form a tail)
  const trailCount = pattern === 'peony' ? 2 : pattern === 'chrysanthemum' ? 3 : pattern === 'willow' ? 4 : 2;
  const trailInterval = 0.04; // seconds between echoes

  // Estimate total particles
  let totalParticles = (1 + trailCount) + config.starCount * (1 + trailCount); // shell + stars with trails
  if (pattern === 'crossette') {
    totalParticles += config.starCount * 4 * (1 + trailCount);
  }
  if (pattern === 'multibreak') {
    totalParticles += config.starCount * (1 + trailCount);
  }

  const positions = new Float32Array(totalParticles * 3);
  const velocities = new Float32Array(totalParticles * 3);
  const birthTimes = new Float32Array(totalParticles);
  const lifespans = new Float32Array(totalParticles);
  const dragCoeffs = new Float32Array(totalParticles);
  const colors = new Float32Array(totalParticles * 3);
  const sizes = new Float32Array(totalParticles);

  let idx = 0;

  function addParticle(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    birth: number, life: number, dk: number,
    cr: number, cg: number, cb: number,
    size: number,
  ) {
    const i3 = idx * 3;
    positions[i3] = px;
    positions[i3 + 1] = py;
    positions[i3 + 2] = pz;
    velocities[i3] = vx;
    velocities[i3 + 1] = vy;
    velocities[i3 + 2] = vz;
    birthTimes[idx] = birth;
    lifespans[idx] = life;
    dragCoeffs[idx] = dk;
    colors[i3] = cr;
    colors[i3 + 1] = cg;
    colors[i3 + 2] = cb;
    sizes[idx] = size;
    idx++;
  }

  // Add a particle plus its trail echoes
  function addWithTrail(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    birth: number, life: number, dk: number,
    cr: number, cg: number, cb: number,
    size: number,
    trails: number,
  ) {
    // Main particle
    addParticle(px, py, pz, vx, vy, vz, birth, life, dk, cr, cg, cb, size);
    // Trail echoes: same trajectory, delayed birth, shorter life, smaller & dimmer
    for (let t = 1; t <= trails; t++) {
      const frac = t / (trails + 1);
      addParticle(
        px, py, pz, vx, vy, vz,
        birth + t * trailInterval,
        life - t * trailInterval,
        dk,
        cr * (1 - frac * 0.5), cg * (1 - frac * 0.5), cb * (1 - frac * 0.5),
        size * (1 - frac * 0.6),
      );
    }
  }

  // 1. Ascending shell (comet trail particle)
  addWithTrail(
    launchX, 0, launchZ,
    0, config.launchVelocity, 0,
    launchTime, config.fuseTime, 0.1,
    1.0, 0.8, 0.4,
    3.0,
    trailCount,
  );

  // 2. Burst stars
  const ejectSpeed = config.starEjectVelocity;
  const starLife = pattern === 'willow' ? config.starBurnTime * 2.5 : config.starBurnTime;
  const starSize = pattern === 'willow' ? 2.0 : pattern === 'chrysanthemum' ? 2.5 : 2.0;

  for (let i = 0; i < config.starCount; i++) {
    const [dx, dy, dz] = randomOnSphere();
    const speedVariation = 0.8 + Math.random() * 0.4;
    const vx = dx * ejectSpeed * speedVariation;
    const vy = dy * ejectSpeed * speedVariation;
    const vz = dz * ejectSpeed * speedVariation;
    const lifeVariation = 0.8 + Math.random() * 0.4;

    addWithTrail(
      launchX, burstY, launchZ,
      vx, vy, vz,
      burstTime, starLife * lifeVariation, drag,
      color.r, color.g, color.b,
      starSize,
      trailCount,
    );
  }

  // 3. Crossette: split after ~1.5s
  if (pattern === 'crossette') {
    const splitDelay = 1.2 + Math.random() * 0.6; // 1.2-1.8s
    for (let i = 0; i < config.starCount; i++) {
      const starIdx = 1 + i; // skip ascending shell
      const si3 = starIdx * 3;
      const sv = [velocities[si3], velocities[si3 + 1], velocities[si3 + 2]] as [number, number, number];
      const sp = [positions[si3], positions[si3 + 1], positions[si3 + 2]] as [number, number, number];

      // Position of parent star at split time
      const splitPos = posAtTime(sp, sv, drag, splitDelay);
      const childSpeed = ejectSpeed * 0.5;
      const childBirth = burstTime + splitDelay;
      const childLife = starLife * 0.5;

      // 4 perpendicular directions
      // Find a coordinate frame from parent velocity direction
      const vmag = Math.sqrt(sv[0] * sv[0] + sv[1] * sv[1] + sv[2] * sv[2]);
      let nx = 0, ny = 1, nz = 0;
      if (vmag > 0.01) {
        nx = sv[0] / vmag;
        ny = sv[1] / vmag;
        nz = sv[2] / vmag;
      }
      // Find two perpendicular vectors
      let ax: number, ay: number, az: number;
      if (Math.abs(ny) < 0.9) {
        ax = 0; ay = 1; az = 0;
      } else {
        ax = 1; ay = 0; az = 0;
      }
      // Cross product: perp1 = n x a
      const p1x = ny * az - nz * ay;
      const p1y = nz * ax - nx * az;
      const p1z = nx * ay - ny * ax;
      const p1mag = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z);
      const p1 = [p1x / p1mag, p1y / p1mag, p1z / p1mag];
      // Cross product: perp2 = n x perp1
      const p2 = [
        ny * p1[2] - nz * p1[1],
        nz * p1[0] - nx * p1[2],
        nx * p1[1] - ny * p1[0],
      ];

      const dirs = [p1, [-p1[0], -p1[1], -p1[2]], p2, [-p2[0], -p2[1], -p2[2]]];
      for (const d of dirs) {
        addWithTrail(
          splitPos[0], splitPos[1], splitPos[2],
          d[0] * childSpeed, d[1] * childSpeed, d[2] * childSpeed,
          childBirth, childLife, drag * 0.8,
          color.r, color.g, color.b,
          1.5,
          trailCount,
        );
      }
    }
  }

  // 4. Multi-break: second burst higher
  if (pattern === 'multibreak') {
    const break2Delay = config.fuseTime * 0.4; // second break offset
    const break2Time = burstTime + break2Delay;
    const break2Y = burstY + 30 + Math.random() * 20;

    const color2 = COLORS[Math.floor(Math.random() * COLORS.length)];
    for (let i = 0; i < config.starCount; i++) {
      const [dx, dy, dz] = randomOnSphere();
      const speedVariation = 0.8 + Math.random() * 0.4;
      const vx = dx * ejectSpeed * 0.8 * speedVariation;
      const vy = dy * ejectSpeed * 0.8 * speedVariation;
      const vz = dz * ejectSpeed * 0.8 * speedVariation;

      addWithTrail(
        launchX, break2Y, launchZ,
        vx, vy, vz,
        break2Time, config.starBurnTime * 0.8, drag,
        color2.r, color2.g, color2.b,
        2.0,
        trailCount,
      );
    }
  }

  return {
    positions: positions.subarray(0, idx * 3),
    velocities: velocities.subarray(0, idx * 3),
    birthTimes: birthTimes.subarray(0, idx),
    lifespans: lifespans.subarray(0, idx),
    dragCoeffs: dragCoeffs.subarray(0, idx),
    colors: colors.subarray(0, idx * 3),
    sizes: sizes.subarray(0, idx),
    count: idx,
  };
}
