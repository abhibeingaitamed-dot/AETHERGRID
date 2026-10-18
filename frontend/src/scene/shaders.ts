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
  uniform float uScanPosition;

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
    float scanDistance = abs(vWorldPosition.x - uScanPosition);
    float scanGlow = 1.0 - smoothstep(0.0, 1.35, scanDistance);
    vec3 color = thermal * core * vFlicker + thermal * edge * 0.7;
    color += vec3(0.02, 0.78, 1.0) * scanGlow * (0.7 + uLoad * 0.6);
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
    float travel = fract(aPhase + uTime * aSpeed * (1.0 + uLoad * 1.8));
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

  uniform float uLoad;

  varying float vPulse;
  varying float vLane;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float distanceToCore = length(centered);
    if (distanceToCore > 0.5) discard;
    float glow = pow(1.0 - distanceToCore * 2.0, 2.4) * (0.65 + vPulse * 0.7);
    vec3 coolant = mix(vec3(0.05, 0.72, 1.0), vec3(0.12, 0.92, 0.76), smoothstep(0.55, 0.92, vPulse));
    coolant = mix(coolant, vec3(1.0, 0.42, 0.08), smoothstep(0.72, 1.0, uLoad) * 0.55);
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

export const coolantFloorVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uLoad;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const coolantFloorFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uLoad;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    float streamA = sin(vUv.x * 46.0 - uTime * (2.0 + uLoad * 4.0) + sin(vUv.y * 12.0) * 0.8);
    float streamB = sin(vUv.y * 32.0 + uTime * (1.2 + uLoad * 2.2) + vUv.x * 4.0);
    float flow = smoothstep(0.58, 0.95, streamA * 0.5 + 0.5) * 0.55 + smoothstep(0.7, 1.0, streamB * 0.5 + 0.5) * 0.35;
    vec3 cool = vec3(0.01, 0.32, 0.62);
    vec3 warm = vec3(0.96, 0.22, 0.035);
    vec3 color = mix(cool, warm, smoothstep(0.58, 1.0, uLoad));
    float grid = step(0.965, fract(vUv.x * 32.0)) + step(0.965, fract(vUv.y * 18.0));
    gl_FragColor = vec4(color * (0.22 + flow * 1.6) + vec3(0.02, 0.15, 0.22) * grid, 0.18 + flow * 0.23);
  }
`;

export const lidarScanVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const lidarScanFragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uLoad;
  varying vec2 vUv;

  void main() {
    float line = 1.0 - smoothstep(0.0, 0.12, abs(vUv.x - fract(uTime * 0.055)));
    float secondary = 1.0 - smoothstep(0.0, 0.025, abs(vUv.x - fract(uTime * 0.055 + 0.12)));
    float grid = step(0.985, fract(vUv.y * 26.0)) * 0.28;
    vec3 color = mix(vec3(0.02, 0.7, 1.0), vec3(1.0, 0.26, 0.05), smoothstep(0.68, 1.0, uLoad));
    gl_FragColor = vec4(color, (line * 0.35 + secondary * 0.12 + grid) * (0.65 + uLoad * 0.5));
  }
`;

export const godRayVertexShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 displaced = position;
    displaced.x += sin(uTime * 0.35 + position.y * 0.08) * 0.12;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

export const godRayFragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uLoad;
  varying vec2 vUv;
  void main() {
    float edgeFade = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    float depthFade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.22, vUv.y);
    float shimmer = 0.75 + 0.25 * sin(uTime * 0.8 + vUv.y * 9.0);
    vec3 color = mix(vec3(0.06, 0.36, 0.72), vec3(0.2, 0.85, 1.0), smoothstep(0.65, 1.0, uLoad));
    gl_FragColor = vec4(color, edgeFade * depthFade * shimmer * 0.08);
  }
`;
