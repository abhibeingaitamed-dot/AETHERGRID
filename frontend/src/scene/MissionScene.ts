import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { CameraMode } from '../lib/telemetry';
import {
  chromaticAberrationShader,
  energyFragmentShader,
  energyVertexShader,
  heatShimmerFragmentShader,
  heatShimmerVertexShader,
  nodeFragmentShader,
  nodeVertexShader,
  particleFragmentShader,
  particleVertexShader,
} from './shaders';

type UniformMap = Record<string, { value: unknown }>;

interface CameraPose {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
}

const CORRIDORS = [-15, -9, -3, 3, 9, 15];
const RACKS_PER_CORRIDOR = 8;
const RACK_SPACING = 5.2;

const CAMERA_POSES: Record<CameraMode, CameraPose> = {
  overview: {
    position: new THREE.Vector3(43, 30, 44),
    lookAt: new THREE.Vector3(2, 2.4, 0),
    fov: 42,
  },
  canyon: {
    position: new THREE.Vector3(-22, 2.9, -15.8),
    lookAt: new THREE.Vector3(15, 2.3, -15),
    fov: 54,
  },
  inspection: {
    position: new THREE.Vector3(24.5, 8.2, 15.5),
    lookAt: new THREE.Vector3(30.5, 2.2, 0),
    fov: 37,
  },
};

export class MissionScene {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 220);
  private readonly cameraHelper = new THREE.PerspectiveCamera();
  private readonly renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private aberrationPass!: ShaderPass;
  private bokehPass!: BokehPass;
  private readonly clock = new THREE.Clock();
  private readonly nodeMaterial: THREE.ShaderMaterial;
  private readonly energyMaterials: THREE.ShaderMaterial[] = [];
  private readonly heatMaterials: THREE.ShaderMaterial[] = [];
  private readonly particleMaterials: THREE.ShaderMaterial[] = [];
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetLookAt = new THREE.Vector3();
  private readonly pointer = new THREE.Vector2();
  private mode: CameraMode = 'overview';
  private load = 0.62;
  private animationFrame = 0;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color(0x03050d);
    this.scene.fog = new THREE.FogExp2(0x03050d, 0.012);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'mission-canvas';
    container.appendChild(this.renderer.domElement);

    this.nodeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLoad: { value: this.load },
      },
      vertexShader: nodeVertexShader,
      fragmentShader: nodeFragmentShader,
      transparent: true,
      depthWrite: true,
    });

    const initialPose = CAMERA_POSES[this.mode];
    this.camera.position.copy(initialPose.position);
    this.targetPosition.copy(initialPose.position);
    this.targetLookAt.copy(initialPose.lookAt);

    this.buildLighting();
    this.buildFacility();
    this.buildSubstation();
    this.buildPostProcessing();

    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.animate();
  }

  setLoad(load: number): void {
    this.load = THREE.MathUtils.clamp(load, 0, 1);
  }

  setCameraMode(mode: CameraMode): void {
    this.mode = mode;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerleave', this.onPointerLeave);
    cancelAnimationFrame(this.animationFrame);
    this.renderer.dispose();
    this.composer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      }
    });
    this.container.removeChild(this.renderer.domElement);
  }

  private buildLighting(): void {
    const ambient = new THREE.HemisphereLight(0x1c5982, 0x02040a, 1.8);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0x90dfff, 2.3);
    key.position.set(-22, 34, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 110;
    key.shadow.camera.left = -52;
    key.shadow.camera.right = 52;
    key.shadow.camera.top = 42;
    key.shadow.camera.bottom = -32;
    this.scene.add(key);

    const substationLight = new THREE.PointLight(0xff4a1f, 18, 28, 2);
    substationLight.position.set(30, 7, 0);
    this.scene.add(substationLight);

    const coolingLight = new THREE.PointLight(0x087dff, 14, 24, 2);
    coolingLight.position.set(-15, 2, -12);
    this.scene.add(coolingLight);
  }

  private buildFacility(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 78),
      new THREE.MeshStandardMaterial({ color: 0x050912, metalness: 0.8, roughness: 0.64 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.34;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(100, 50, 0x14526f, 0x0a2334);
    grid.position.y = -0.31;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.44;
    this.scene.add(grid);

    const perimeter = new THREE.Mesh(
      new THREE.RingGeometry(35, 35.12, 96),
      new THREE.MeshBasicMaterial({ color: 0x0d9dca, transparent: true, opacity: 0.56, side: THREE.DoubleSide }),
    );
    perimeter.rotation.x = -Math.PI / 2;
    perimeter.position.y = -0.28;
    this.scene.add(perimeter);

    this.buildRacks();
    this.buildCoolingConduits();
    this.buildParticles();
    this.buildFacilityMarkers();
  }

  private buildRacks(): void {
    const nodeGeometry = new THREE.BoxGeometry(0.205, 0.14, 0.11);
    const nodeCount = CORRIDORS.length * RACKS_PER_CORRIDOR * 5 * 10 * 5;
    const nodes = new THREE.InstancedMesh(nodeGeometry, this.nodeMaterial, nodeCount);
    nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const colorData = new Float32Array(nodeCount * 3);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    let instanceIndex = 0;

    CORRIDORS.forEach((corridorZ, corridorIndex) => {
      for (let rackIndex = 0; rackIndex < RACKS_PER_CORRIDOR; rackIndex += 1) {
        const rackX = (rackIndex - (RACKS_PER_CORRIDOR - 1) / 2) * RACK_SPACING;
        const rack = new THREE.Mesh(
          new THREE.BoxGeometry(1.56, 2.68, 1.04),
          new THREE.MeshBasicMaterial({ color: 0x0c2f43, wireframe: true, transparent: true, opacity: 0.42 }),
        );
        rack.position.set(rackX, 1.02, corridorZ);
        this.scene.add(rack);

        const base = new THREE.Mesh(
          new THREE.BoxGeometry(1.7, 0.12, 1.12),
          new THREE.MeshStandardMaterial({ color: 0x091722, metalness: 0.9, roughness: 0.45 }),
        );
        base.position.set(rackX, -0.22, corridorZ);
        base.castShadow = true;
        base.receiveShadow = true;
        this.scene.add(base);

        const statusStrip = new THREE.Mesh(
          new THREE.BoxGeometry(0.026, 2.4, 0.025),
          new THREE.MeshBasicMaterial({ color: corridorIndex % 2 === 0 ? 0x00bfff : 0x8d28ff, transparent: true, opacity: 0.9 }),
        );
        statusStrip.position.set(rackX - 0.76, 1.03, corridorZ - 0.55);
        this.scene.add(statusStrip);

        for (let depth = 0; depth < 5; depth += 1) {
          for (let level = 0; level < 10; level += 1) {
            for (let column = 0; column < 5; column += 1) {
              const heat = THREE.MathUtils.clamp(
                0.08 + corridorIndex * 0.055 + (level / 9) * 0.18 + ((rackIndex * 3 + column) % 7) * 0.012,
                0,
                1,
              );
              const x = rackX + (column - 2) * 0.265;
              const y = 0.03 + level * 0.22;
              const z = corridorZ + (depth - 2) * 0.17;
              matrix.compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(1, 1, 1));
              nodes.setMatrixAt(instanceIndex, matrix);
              colorData[instanceIndex * 3] = heat;
              colorData[instanceIndex * 3 + 1] = corridorIndex / Math.max(CORRIDORS.length - 1, 1);
              colorData[instanceIndex * 3 + 2] = rackIndex / Math.max(RACKS_PER_CORRIDOR - 1, 1);
              instanceIndex += 1;
            }
          }
        }
      }
    });

    nodeGeometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorData, 3));
    nodes.castShadow = true;
    nodes.receiveShadow = true;
    this.scene.add(nodes);

    for (const corridorZ of CORRIDORS) {
      const haze = new THREE.Mesh(
        new THREE.PlaneGeometry(43, 3.5, 32, 10),
        new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uLoad: { value: this.load } },
          vertexShader: heatShimmerVertexShader,
          fragmentShader: heatShimmerFragmentShader,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      haze.position.set(0, 1.7, corridorZ - 0.58);
      haze.renderOrder = 3;
      this.heatMaterials.push(haze.material as THREE.ShaderMaterial);
      this.scene.add(haze);
    }
  }

  private buildCoolingConduits(): void {
    for (const [index, corridorZ] of CORRIDORS.entries()) {
      const route = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-23, -0.1, corridorZ - 0.72),
        new THREE.Vector3(-11, 0.05, corridorZ - 0.76),
        new THREE.Vector3(0, -0.02, corridorZ - 0.67),
        new THREE.Vector3(12, 0.06, corridorZ - 0.74),
        new THREE.Vector3(23, -0.04, corridorZ - 0.66),
      ]);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(route, 64, 0.055, 8, false),
        this.createEnergyMaterial(0.52 + index * 0.03),
      );
      this.scene.add(tube);
    }

    const mainBusRoute = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-24, 3.7, -18.5),
      new THREE.Vector3(-8, 4.15, -18.5),
      new THREE.Vector3(8, 3.8, -18.5),
      new THREE.Vector3(23, 4.35, -18.5),
      new THREE.Vector3(31, 6.1, -8),
      new THREE.Vector3(31, 6.4, 0),
    ]);
    const mainBus = new THREE.Mesh(
      new THREE.TubeGeometry(mainBusRoute, 128, 0.13, 10, false),
      this.createEnergyMaterial(0.8),
    );
    this.scene.add(mainBus);

    for (const z of [-4, 0, 4]) {
      const transmission = new THREE.CatmullRomCurve3([
        new THREE.Vector3(23.5, 6.25, z),
        new THREE.Vector3(27, 7.4, z),
        new THREE.Vector3(31.5, 7.65, z),
        new THREE.Vector3(37, 7.0, z),
      ]);
      const line = new THREE.Mesh(
        new THREE.TubeGeometry(transmission, 64, 0.075, 8, false),
        this.createEnergyMaterial(0.92),
      );
      this.scene.add(line);
    }
  }

  private buildParticles(): void {
    const coolingCount = 1560;
    const transmissionCount = 960;
    const count = coolingCount + transmissionCount;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const lanes = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
      const isTransmission = index >= coolingCount;
      const localIndex = isTransmission ? index - coolingCount : index;
      const t = (localIndex % 260) / 259;
      const lane = isTransmission ? 1 : 0;
      const corridorIndex = Math.floor(localIndex / 260) % CORRIDORS.length;
      const x = isTransmission ? 23 + t * 15 : -22 + t * 44;
      const y = isTransmission
        ? 6.1 + Math.sin(t * Math.PI * 2 + localIndex * 0.03) * 1.3
        : 0.11 + (localIndex % 5) * 0.035;
      const z = isTransmission
        ? -4 + (localIndex % 3) * 4
        : CORRIDORS[corridorIndex] + Math.sin(t * Math.PI * 4 + corridorIndex) * 0.54;
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      phases[index] = (localIndex * 0.037) % 1;
      speeds[index] = isTransmission ? 0.12 + (localIndex % 13) * 0.007 : 0.20 + (localIndex % 17) * 0.006;
      sizes[index] = isTransmission ? 1.8 + (localIndex % 4) * 0.55 : 1.25 + (localIndex % 5) * 0.32;
      lanes[index] = lane;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aLane', new THREE.BufferAttribute(lanes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLoad: { value: this.load } },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.particleMaterials.push(material);
    this.scene.add(new THREE.Points(geometry, material));
  }

  private buildFacilityMarkers(): void {
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x19c5ff, transparent: true, opacity: 0.8 });
    for (const x of [-23, 0, 23]) {
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 5.6, 8), markerMaterial);
      beacon.position.set(x, 2.5, -19.5);
      this.scene.add(beacon);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), markerMaterial);
      cap.position.set(x, 5.35, -19.5);
      this.scene.add(cap);
    }
  }

  private buildSubstation(): void {
    const substation = new THREE.Group();
    substation.position.set(30.5, 0, 0);

    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x101a28, metalness: 0.88, roughness: 0.28 });
    const transformer = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.7, 3.4), darkMetal);
    transformer.position.y = 1.2;
    transformer.castShadow = true;
    transformer.receiveShadow = true;
    substation.add(transformer);

    for (let index = -3; index <= 3; index += 1) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.35, 3.75), darkMetal);
      fin.position.set(index * 0.55, 1.25, 0);
      substation.add(fin);
    }

    const copper = new THREE.MeshStandardMaterial({ color: 0x87361d, emissive: 0x5d1608, emissiveIntensity: 1.6, metalness: 0.7, roughness: 0.25 });
    for (const z of [-1.1, 0, 1.1]) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 10, 32), copper);
      coil.rotation.x = Math.PI / 2;
      coil.position.set(0, 3.05, z);
      substation.add(coil);
    }

    const insulator = new THREE.MeshStandardMaterial({ color: 0x9fd8e5, emissive: 0x0c6a7a, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.18 });
    for (const z of [-4, 0, 4]) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 3.6, 10), insulator);
      stem.position.set(0, 4.4, z);
      substation.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), insulator);
      cap.position.set(0, 6.2, z);
      substation.add(cap);
    }

    const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2d3b, metalness: 0.74, roughness: 0.45 });
    for (const x of [-7, 7]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, 10, 6), towerMaterial);
      tower.position.set(x, 4.7, 0);
      substation.add(tower);
      for (const y of [2, 4, 6, 8]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.08), towerMaterial);
        arm.position.set(x, y, 0);
        substation.add(arm);
      }
    }

    const warning = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 0.04, 4.8),
      new THREE.MeshBasicMaterial({ color: 0xff2e1b, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }),
    );
    warning.position.y = 0.05;
    substation.add(warning);
    this.scene.add(substation);
  }

  private createEnergyMaterial(load: number): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLoad: { value: load },
      },
      vertexShader: energyVertexShader,
      fragmentShader: energyFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.energyMaterials.push(material);
    return material;
  }

  private buildPostProcessing(): void {
    const renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.15, 0.72, 0.16);
    this.aberrationPass = new ShaderPass(chromaticAberrationShader);
    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: 34,
      aperture: 0.000035,
      maxblur: 0.008,
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.aberrationPass);
    this.composer.addPass(this.bokehPass);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta() || 0.016, 0.1);
    const elapsed = this.clock.elapsedTime;
    const pose = CAMERA_POSES[this.mode];
    const damping = 1 - Math.exp(-delta * 3.4);

    this.targetPosition.lerp(pose.position, damping);
    this.targetLookAt.lerp(pose.lookAt, damping);
    const pointerOffset = new THREE.Vector3(this.pointer.x * 0.65, this.pointer.y * 0.28, 0);
    const desiredPosition = this.targetPosition.clone().add(pointerOffset);
    this.camera.position.lerp(desiredPosition, damping);
    const desiredLookAt = this.targetLookAt.clone().add(new THREE.Vector3(this.pointer.x * 0.8, this.pointer.y * 0.4, 0));
    this.cameraHelper.position.copy(this.camera.position);
    this.cameraHelper.lookAt(desiredLookAt);
    this.camera.quaternion.slerp(this.cameraHelper.quaternion, damping);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, pose.fov, damping);
    this.camera.updateProjectionMatrix();

    this.nodeMaterial.uniforms.uTime.value = elapsed;
    this.nodeMaterial.uniforms.uLoad.value = this.load;
    for (const material of this.energyMaterials) {
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uLoad.value = this.load;
    }
    for (const material of this.heatMaterials) {
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uLoad.value = this.load;
    }
    for (const material of this.particleMaterials) {
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uLoad.value = this.load;
    }

    this.bloomPass.strength = 0.88 + this.load * 0.72;
    this.aberrationPass.uniforms.uStrength.value = 0.0009 + Math.max(this.load - 0.72, 0) * 0.012;
    const bokehUniforms = this.bokehPass.uniforms as unknown as Record<string, { value: number }>;
    bokehUniforms.focus.value = this.mode === 'inspection' ? 25 : this.mode === 'canyon' ? 17 : 36;
    this.composer.render();
  };

  private onResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const bounds = this.container.getBoundingClientRect();
    this.pointer.x = THREE.MathUtils.clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
    this.pointer.y = THREE.MathUtils.clamp(-(((event.clientY - bounds.top) / bounds.height) * 2 - 1), -1, 1);
  };

  private onPointerLeave = (): void => {
    this.pointer.multiplyScalar(0.25);
  };
}
