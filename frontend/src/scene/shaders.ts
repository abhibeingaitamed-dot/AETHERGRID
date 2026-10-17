export const nodeVertexShader = /* glsl */ `
  attribute mat4 instanceMatrix;
  attribute vec3 instanceColor;

  uniform float uTime;

  varying vec3 vInstanceColor;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vFlicker;

  void main() {
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vInstanceColor = instanceColor;
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vFlicker = 0.92 + 0.08 * sin(uTime * 4.0 + worldPosition.x * 1.8 + worldPosition.z * 0.7);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const nodeFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uLoad;

  varying vec3 vInstanceColor;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vFlicker;

  vec3 thermalRamp(float heat) {
    vec3 cyan = vec3(0.015, 0.50, 0.92);
    vec3 amber = vec3(1.00, 0.30, 0.035);
    vec3 plasma = vec3(1.00, 0.015, 0.006);
    vec3 result = mix(cyan, amber, smoothstep(0.38, 0.69, heat));
    return mix(result, plasma, smoothstep(0.70, 1.0, heat));
  }

  void main() {
    float localHeat = clamp(vInstanceColor.r * 0.42 + uLoad * 0.70, 0.0, 1.0);
    float shimmer = sin(vWorldPosition.y * 17.0 + uTime * (2.2 + uLoad * 5.0)) * 0.035;
    float edge = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0), 1.8);
    vec3 thermal = thermalRamp(clamp(localHeat + shimmer, 0.0, 1.0));
    float core = 0.44 + localHeat * 1.35;
    vec3 color = thermal * core * vFlicker + thermal * edge * 0.7;
    float alpha = 0.80 + localHeat * 0.20;
    gl_FragColor = vec4(color, alpha);
  }
`;

export const energyVertexShader = /* glsl */ `
  uniform float uTime;
  varying float vFlow;
  varying vec3 vWorldPosition;

  void main() {
    vFlow = uv.x;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const energyFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uLoad;

  varying float vFlow;
  varying vec3 vWorldPosition;

  void main() {
    float velocity = 1.3 + uLoad * 4.2;
    float wave = sin((vFlow * 42.0 - uTime * velocity) * 6.2831853);
    float current = smoothstep(0.12, 0.88, wave * 0.5 + 0.5);
    float harmonic = 0.52 + 0.48 * sin(vWorldPosition.y * 2.4 + uTime * 3.0);
    vec3 base = mix(vec3(0.01, 0.22, 0.62), vec3(0.07, 0.90, 1.0), current);
    vec3 warning = vec3(1.0, 0.17, 0.025);
    base = mix(base, warning, smoothstep(0.82, 1.0, uLoad) * 0.7);
    float intensity = (0.72 + current * 2.2 + uLoad * 1.4) * harmonic;
    gl_FragColor = vec4(base * intensity, 0.94);
  }
`;

export const particleVertexShader = /* glsl */ `
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aLane;

  uniform float uTime;
  uniform float uLoad;

  varying float vPulse;
  varying float vLane;

  void main() {
    float travel = fract(aPhase + uTime * aSpeed);
    vec3 animated = position;
    float wave = sin(travel * 6.2831853 + aPhase * 9.0);
    if (aLane < 0.5) {
      animated.y += wave * 0.045;
      animated.z += sin(travel * 12.56637 + aPhase) * 0.12;
    } else {
      animated.y += wave * (0.10 + uLoad * 0.2);
      animated.x += cos(travel * 6.2831853) * 0.16;
    }

    vec4 viewPosition = modelViewMatrix * vec4(animated, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = aSize * (220.0 / max(-viewPosition.z, 1.0)) * (1.0 + uLoad * 0.3);
    vPulse = 0.45 + 0.55 * sin(travel * 6.2831853);
    vLane = aLane;
  }
`;

export const particleFragmentShader = /* glsl */ `
  precision highp float;

  varying float vPulse;
  varying float vLane;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float distanceToCore = length(centered);
    if (distanceToCore > 0.5) discard;
    float glow = pow(1.0 - distanceToCore * 2.0, 2.4) * (0.65 + vPulse * 0.7);
    vec3 coolant = vec3(0.05, 0.72, 1.0);
    vec3 transmission = vec3(1.0, 0.30, 0.04);
    vec3 color = mix(coolant, transmission, step(0.5, vLane));
    gl_FragColor = vec4(color * glow * 2.0, glow);
  }
`;

export const heatShimmerVertexShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vHeight;

  void main() {
    vUv = uv;
    vec3 displaced = position;
    displaced.x += sin(position.y * 4.0 + uTime * 1.7) * 0.12;
    displaced.z += cos(position.x * 0.22 + uTime * 1.3) * 0.08;
    vHeight = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

export const heatShimmerFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uLoad;

  varying vec2 vUv;
  varying float vHeight;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 drift = vUv * vec2(8.0, 3.0) + vec2(uTime * 0.16, -uTime * 0.55);
    float noise = hash(floor(drift)) * 0.4 + hash(floor(drift * 2.0)) * 0.6;
    float plume = smoothstep(0.05, 0.54, vUv.x) * smoothstep(1.0, 0.1, vUv.x);
    float shimmer = smoothstep(0.28, 0.9, noise + sin(vUv.y * 9.0 + uTime * 2.0) * 0.18);
    float density = plume * shimmer * (0.06 + uLoad * 0.22) * smoothstep(0.0, 0.4, vHeight);
    vec3 color = mix(vec3(0.03, 0.52, 0.95), vec3(1.0, 0.17, 0.015), smoothstep(0.62, 1.0, uLoad));
    gl_FragColor = vec4(color * (0.55 + density * 2.0), density);
  }
`;

export const chromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: 0.0015 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec2 direction = vUv - vec2(0.5);
      float edge = dot(direction, direction) * 2.0;
      vec2 offset = direction * uStrength * edge;
      float red = texture2D(tDiffuse, vUv + offset).r;
      float green = texture2D(tDiffuse, vUv).g;
      float blue = texture2D(tDiffuse, vUv - offset).b;
      gl_FragColor = vec4(red, green, blue, 1.0);
    }
  `,
};
