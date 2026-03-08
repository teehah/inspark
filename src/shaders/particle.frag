varying float vAge;
varying float vLifespan;
varying vec3 vColor;
varying vec3 vColor2;
varying float vFlicker;
varying float vRandom;

void main() {
  // Circular point sprite
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;

  float lifeRatio = vAge / vLifespan;

  // Color transition: relatively abrupt layer-change, not smooth blend
  // Real stars: constant color within each phase, brief transition between layers
  vec3 mainColor;
  float transitionPoint = 0.45 + vRandom * 0.1; // slight variation per star
  float transitionWidth = 0.05; // narrow transition band
  float colorMix = smoothstep(transitionPoint - transitionWidth, transitionPoint + transitionWidth, lifeRatio);
  mainColor = mix(vColor, vColor2, colorMix);

  // Brightness profile: white flash -> constant bright color -> brief dim -> extinction
  vec3 white = vec3(1.0, 0.95, 0.8);
  vec3 dimEmber = vec3(0.4, 0.12, 0.02);

  vec3 color;
  float brightness;

  if (lifeRatio < 0.03) {
    // Brief ignition flash (prime layer)
    float flash = lifeRatio / 0.03;
    color = mix(white * 6.0, mainColor, flash);
    brightness = mix(6.0, 4.5, flash);
  } else if (lifeRatio < 0.85) {
    // Main burn: relatively constant brightness (real stars are steady)
    color = mainColor;
    brightness = mix(4.5, 3.5, (lifeRatio - 0.03) / 0.82); // very gentle decline
  } else {
    // End of burn: brief dim phase before extinction
    float endFade = (lifeRatio - 0.85) / 0.15;
    color = mix(mainColor, dimEmber, endFade * endFade);
    brightness = mix(3.5, 0.3, endFade);
  }

  // Glitter / Strobe effects
  if (vFlicker > 0.0) {
    // Random glitter for kamuro/nishiki stars
    float rate = 15.0 + vRandom * 25.0;
    float h = fract(sin(floor(vAge * rate) + vRandom * 1000.0) * 43758.5453);
    float glitter = step(0.55 - vFlicker * 0.35, h);
    brightness *= mix(0.05, 1.0, glitter);
  } else if (vFlicker < 0.0) {
    // Regular strobe (tenmetu) — slow, dramatic on/off
    float strobeRate = 1.5 + vRandom * 1.0; // 1.5-2.5 Hz
    float strobe = step(0.4, fract(vAge * strobeRate));
    brightness *= strobe; // fully off when strobe=0
  }

  color *= brightness;

  // Hot core + soft glow (feeds bloom)
  float core = exp(-dist * dist * 18.0);
  float glow = exp(-dist * dist * 4.0) * 0.3;
  float alpha = core + glow;

  // Extinction fade (last 15% of life)
  float lifeFade = 1.0 - smoothstep(0.85, 1.0, lifeRatio);
  alpha *= lifeFade;

  gl_FragColor = vec4(color * alpha, alpha);
}
