varying float vAge;
varying float vLifespan;
varying vec3 vColor;

void main() {
  // Circular point sprite
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;

  float lifeRatio = vAge / vLifespan;

  // Color transition: white flash -> main color -> orange -> dim red -> out
  vec3 white = vec3(1.0, 0.95, 0.8);
  vec3 orange = vec3(1.0, 0.4, 0.05);
  vec3 dimRed = vec3(0.3, 0.05, 0.0);

  vec3 color;
  if (lifeRatio < 0.05) {
    // Initial white flash
    color = mix(white * 6.0, vColor * 5.0, lifeRatio / 0.05);
  } else if (lifeRatio < 0.6) {
    // Main color burn (HDR)
    float fade = (lifeRatio - 0.05) / 0.55;
    color = vColor * mix(5.0, 2.0, fade);
  } else if (lifeRatio < 0.85) {
    // Fade to orange
    float fade = (lifeRatio - 0.6) / 0.25;
    color = mix(vColor * 2.0, orange * 1.5, fade);
  } else {
    // Dim red ember
    float fade = (lifeRatio - 0.85) / 0.15;
    color = mix(orange * 1.5, dimRed, fade);
  }

  // Soft edge
  float alpha = 1.0 - smoothstep(0.3, 0.5, dist);

  // Overall fade near end of life
  float lifeFade = 1.0 - smoothstep(0.7, 1.0, lifeRatio);
  alpha *= lifeFade;

  gl_FragColor = vec4(color * alpha, alpha);
}
