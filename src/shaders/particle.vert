uniform float uTime;
uniform float uPixelRatio;

attribute vec3 aVelocity;
attribute float aBirthTime;
attribute float aLifespan;
attribute float aDragCoeff;
attribute vec3 aColor;
attribute vec3 aColor2;
attribute float aSize;
attribute float aFlicker;
attribute float aRandom;

varying float vAge;
varying float vLifespan;
varying vec3 vColor;
varying vec3 vColor2;
varying float vFlicker;
varying float vRandom;

void main() {
  float t = uTime - aBirthTime;

  // Not yet born or already dead
  if (t < 0.0 || t > aLifespan) {
    gl_Position = vec4(0.0, 0.0, -999.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vAge = t;
  vLifespan = aLifespan;
  vColor = aColor;
  vColor2 = aColor2;
  vFlicker = aFlicker;
  vRandom = aRandom;

  // Physics: exponential drag approximation
  vec3 gravity = vec3(0.0, -9.81, 0.0);
  vec3 pos;

  float k = aDragCoeff;
  if (k < 0.001) {
    pos = position + aVelocity * t + 0.5 * gravity * t * t;
  } else {
    float expKt = exp(-k * t);
    pos = position
        + (aVelocity / k) * (1.0 - expKt)
        + 0.5 * gravity * t * t;
  }

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

  // Size attenuation
  float lifeRatio = t / aLifespan;
  float sizeFade = 1.0 - lifeRatio * lifeRatio;
  gl_PointSize = aSize * sizeFade * uPixelRatio * (300.0 / -mvPosition.z);

  gl_Position = projectionMatrix * mvPosition;
}
