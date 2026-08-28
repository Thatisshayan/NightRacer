import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { GameRenderer, GameState } from '@workspace/game-core';
import {
  APEX_STORM_ROAD,
  buildApexStormFrame,
  type ApexRoadSegment,
  type ApexVehiclePose,
} from './apex-storm-frame';

const VIEWPORT_WIDTH = 420;
const VIEWPORT_HEIGHT = 800;
const MAX_VEHICLE_SLOTS = 10;

const color = (hex: string) => Color3.FromHexString(hex);

interface RoadVisual {
  root: TransformNode;
}

class ApexVehicleVisual {
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly shadow: Mesh;
  private readonly reflection: Mesh;
  private readonly lamps: Mesh[] = [];
  private readonly playerMaterial: StandardMaterial;
  private readonly trafficMaterial: StandardMaterial;
  private readonly lightMaterial: StandardMaterial;
  private readonly shadowMaterial: StandardMaterial;
  private readonly reflectionMaterial: StandardMaterial;
  private readonly bodyPlane: Mesh;

  constructor(scene: Scene, index: number) {
    this.root = new TransformNode(`apex-vehicle-root-${index}`, scene);
    this.root.setEnabled(false);
    this.body = new TransformNode(`apex-vehicle-body-${index}`, scene);
    this.body.parent = this.root;
    this.playerMaterial = this.createVehicleMaterial(scene, index, 'player');
    this.trafficMaterial = this.createVehicleMaterial(scene, index, 'traffic');
    this.lightMaterial = this.createLightMaterial(scene, index);
    this.shadowMaterial = this.createShadowMaterial(scene, index);
    this.reflectionMaterial = this.createReflectionMaterial(scene, index);
    this.reflection = this.createReflection(scene, index);
    this.shadow = this.createShadow(scene, index);
    this.bodyPlane = this.createBody(scene, index);
    this.createWheelSet(scene, index);
    this.createLamps(scene, index);
  }

  private createVehicleMaterial(scene: Scene, index: number, kind: 'player' | 'traffic') {
    const material = new StandardMaterial(`apex-vehicle-${kind}-${index}`, scene);
    const texturePath = kind === 'player' ? '/apex/player-vehicle-texture.png' : '/apex/traffic-vehicle-texture.png';
    material.diffuseTexture = new Texture(texturePath, scene);
    material.diffuseTexture.hasAlpha = true;
    material.useAlphaFromDiffuseTexture = true;
    material.specularColor = Color3.Black();
    material.emissiveColor = Color3.White();
    material.disableLighting = true; // Use emissive for full brightness
    return material;
  }

  private createLightMaterial(scene: Scene, index: number) {
    const material = new StandardMaterial(`apex-light-${index}`, scene);
    material.disableLighting = true;
    material.emissiveColor = color('#ff3f53');
    return material;
  }

  private createShadowMaterial(scene: Scene, index: number) {
    const material = new StandardMaterial(`apex-shadow-${index}`, scene);
    material.diffuseColor = Color3.Black();
    material.alpha = 0.25;
    material.disableLighting = true;
    return material;
  }

  private createReflectionMaterial(scene: Scene, index: number) {
    const material = new StandardMaterial(`apex-reflection-${index}`, scene);
    material.disableLighting = true;
    material.emissiveColor = color('#ff3f53');
    material.alpha = 0.2;
    return material;
  }

  private createReflection(scene: Scene, index: number): Mesh {
    const reflection = MeshBuilder.CreatePlane(`apex-reflection-${index}`, { width: 0.5, height: 4.6 }, scene);
    reflection.parent = this.root;
    reflection.rotation.x = Math.PI / 2;
    reflection.position.set(0, 0.012, -2.2);
    reflection.material = this.reflectionMaterial;
    return reflection;
  }

  private createShadow(scene: Scene, index: number): Mesh {
    const shadow = MeshBuilder.CreateDisc(`apex-shadow-${index}`, { radius: 1, tessellation: 24 }, scene);
    shadow.parent = this.root;
    shadow.rotation.x = Math.PI / 2;
    shadow.position.set(0, 0.018, 0);
    shadow.material = this.shadowMaterial;
    return shadow;
  }

  private createBody(scene: Scene, index: number): Mesh {
    const plane = MeshBuilder.CreatePlane(`apex-body-plane-${index}`, { width: 2.3, height: 2.3 }, scene);
    plane.parent = this.body;
    plane.material = this.playerMaterial;
    return plane;
  }

  private createWheelSet(_scene: Scene, _index: number) {
    // Legacy procedural wheels hidden in favor of high-quality vehicle textures
  }

  private createLamps(_scene: Scene, _index: number) {
    // Legacy procedural lamps hidden in favor of high-quality vehicle textures
  }

  update(pose: ApexVehiclePose, _selectedCarColor: string) {
    this.root.setEnabled(true);
    const scaleX = pose.width / 2.3;
    const scaleZ = pose.length / 4.5;
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.set(0, pose.heading, 0);
    this.root.scaling.set(scaleX, 0.95, scaleZ);
    this.body.position.y = pose.y;

    // Update body visual
    this.bodyPlane.material = pose.kind === 'player' ? this.playerMaterial : this.trafficMaterial;
    this.bodyPlane.scaling.set(1, 0.8, 1);
    this.bodyPlane.alphaIndex = 10;

    this.shadow.scaling.set(pose.shadow.radiusX / scaleX, pose.shadow.radiusZ / scaleZ, 1);
    this.reflection.scaling.set(
      (pose.width * 0.20) / (0.5 * scaleX),
      (pose.reflection.length * 1.3) / (4.6 * scaleZ),
      1,
    );
    this.reflection.position.z = (-pose.reflection.length * 0.76) / scaleZ;

    this.playerMaterial.alpha = pose.alpha;
    this.trafficMaterial.alpha = pose.alpha;
    this.lightMaterial.emissiveColor = color(pose.lights.color);
    this.lightMaterial.alpha = pose.alpha;
    this.shadowMaterial.alpha = pose.shadow.alpha * pose.alpha;
    this.reflectionMaterial.emissiveColor = color(pose.lights.color);
    this.reflectionMaterial.alpha = pose.reflection.alpha * pose.alpha * 0.28;
  }

  hide() {
    this.root.setEnabled(false);
  }

  dispose() {
    this.root.dispose(false, true);
  }
}

/**
 * Web-only Apex Storm proof renderer. The simulation owns input and timing;
 * this adapter owns a bounded three-dimensional picture of the supplied state.
 */
export class ApexStormRenderer implements GameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly roadVisuals: RoadVisual[];
  private readonly vehicleVisuals: ApexVehicleVisual[];
  private readonly asphaltTexture: Texture;
  private readonly flashMaterial: StandardMaterial;
  private readonly flashPlane: Mesh;
  private readonly lightningLight: PointLight;
  private readonly rainSystem: ParticleSystem;
  private readonly billboardReflections: Mesh[] = [];
  private readonly demo: boolean;
  private destroyed = false;

  private constructor(host: HTMLElement, width: number, height: number, options?: { demo?: boolean }) {
    this.demo = options?.demo ?? false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.className = 'block w-full h-full pointer-events-none';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.replaceChildren(this.canvas);

    this.engine = new Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.018, 0.045, 0.088, 1);
    this.scene.ambientColor = color('#0a1520');
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.012;
    this.scene.fogColor = color('#112941');

    // Deliberately shallow rear chase: the vehicle rear and wheel line remain
    // visible while the physical road, rather than a lane-grid projection, owns depth.
    this.camera = new FreeCamera('apex-storm-camera', new Vector3(0, 2.55, -14.5), this.scene);
    this.camera.fov = 0.82;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 130;
    this.camera.setTarget(new Vector3(3.45, 5.80, 24));

    const skyFill = new HemisphericLight('apex-sky-fill', new Vector3(0, 1, 0), this.scene);
    skyFill.diffuse = color('#5779a9');
    skyFill.groundColor = color('#0b1728');
    skyFill.intensity = 0.95;
    const moonKey = new DirectionalLight('apex-moon-key', new Vector3(-0.35, -1, 0.35), this.scene);
    moonKey.diffuse = color('#b8dcff');
    moonKey.intensity = 1.35;

    this.asphaltTexture = new Texture(`${import.meta.env.BASE_URL}apex/wet-asphalt-tile.jpg`, this.scene, true, false);
    this.asphaltTexture.uScale = 2.2;
    this.asphaltTexture.vScale = 6.5;
    this.roadVisuals = this.createRoad();
    this.createCity();
    this.vehicleVisuals = Array.from({ length: MAX_VEHICLE_SLOTS }, (_, index) => new ApexVehicleVisual(this.scene, index));

    this.flashMaterial = new StandardMaterial('apex-flash', this.scene);
    this.flashMaterial.disableLighting = true;
    this.flashMaterial.emissiveColor = color('#ffffff');
    this.flashMaterial.alpha = 0;

    this.flashPlane = MeshBuilder.CreatePlane('apex-flash-plane', { width: 10, height: 10 }, this.scene);
    this.flashPlane.parent = this.camera;
    this.flashPlane.position.z = 1;
    this.flashPlane.material = this.flashMaterial;
    this.flashPlane.isPickable = false;

    this.lightningLight = new PointLight('apex-lightning-light', new Vector3(0, 10, 30), this.scene);
    this.lightningLight.intensity = 0;
    this.lightningLight.diffuse = color('#d7f5ff');

    this.rainSystem = this.createRain();
    this.createBillboards();

    this.engine.runRenderLoop(() => {
      if (!this.destroyed) this.scene.render();
    });
  }

  static async create(host: HTMLElement, width = VIEWPORT_WIDTH, height = VIEWPORT_HEIGHT, options?: { demo?: boolean }) {
    return new ApexStormRenderer(host, width, height, options);
  }

  private createRoad(): RoadVisual[] {
    const asphalt = new StandardMaterial('apex-asphalt', this.scene);
    asphalt.diffuseTexture = this.asphaltTexture;
    asphalt.diffuseColor = color('#405672');
    asphalt.emissiveColor = color('#071625');
    asphalt.specularColor = color('#b5dbff');
    asphalt.specularPower = 128;

    const rail = new StandardMaterial('apex-cyan-rail', this.scene);
    rail.diffuseColor = color('#124259');
    rail.emissiveColor = color('#0a9cbe');
    rail.specularColor = color('#9ceeff');

    const lane = new StandardMaterial('apex-amber-lane', this.scene);
    lane.disableLighting = true;
    lane.emissiveColor = color('#f4b43f');

    return Array.from({ length: APEX_STORM_ROAD.segmentCount }, (_, index) => {
      const root = new TransformNode(`apex-road-segment-${index}`, this.scene);
      const asphaltMesh = MeshBuilder.CreateBox(`apex-road-asphalt-${index}`, {
        width: APEX_STORM_ROAD.halfWidth * 2,
        height: 0.12,
        depth: 1,
      }, this.scene);
      asphaltMesh.parent = root;
      asphaltMesh.position.y = -0.06;
      asphaltMesh.material = asphalt;

      for (const side of [-1, 1]) {
        const barrier = MeshBuilder.CreateBox(`apex-rail-${index}-${side}`, { width: 0.18, height: 0.58, depth: 1 }, this.scene);
        barrier.parent = root;
        barrier.position.set(side * (APEX_STORM_ROAD.halfWidth - 0.08), 0.24, 0);
        barrier.material = rail;
      }

      const centreLine = MeshBuilder.CreateBox(`apex-centre-line-${index}`, { width: 0.12, height: 0.025, depth: 0.36 }, this.scene);
      centreLine.parent = root;
      centreLine.position.set(0, 0.014, 0);
      centreLine.material = lane;

      for (const side of [-1, 1]) {
        const divider = MeshBuilder.CreateBox(`apex-divider-${index}-${side}`, { width: 0.045, height: 0.018, depth: 0.34 }, this.scene);
        divider.parent = root;
        divider.position.set(side * APEX_STORM_ROAD.halfWidth * 0.48, 0.012, 0);
        divider.material = rail;
      }

      return { root };
    });
  }

  private createRain(): ParticleSystem {
    const system = new ParticleSystem('apex-rain', 1200, this.scene);
    system.particleTexture = new Texture('/apex/rain-streak.png', this.scene);

    const emitter = MeshBuilder.CreateBox('apex-rain-emitter', { size: 0.01 }, this.scene);
    emitter.parent = this.camera;
    emitter.isVisible = false;
    system.emitter = emitter;

    system.minEmitBox = new Vector3(-15, 10, -5);
    system.maxEmitBox = new Vector3(15, 15, 40);
    system.color1 = new Color4(0.7, 0.9, 1.0, 0.35);
    system.color2 = new Color4(0.5, 0.8, 1.0, 0.25);
    system.minSize = 0.05;
    system.maxSize = 0.12;
    system.minLifeTime = 0.4;
    system.maxLifeTime = 0.8;
    system.emitRate = 800;
    system.gravity = new Vector3(0, -45, 0);
    system.direction1 = new Vector3(0, -1, 0.1);
    system.direction2 = new Vector3(0, -1, 0.2);
    system.minAngularSpeed = 0;
    system.maxAngularSpeed = 0;
    system.minEmitPower = 1;
    system.maxEmitPower = 2;
    system.updateSpeed = 0.016;
    system.start();
    return system;
  }

  private createBillboards() {
    const material = new StandardMaterial('apex-billboard-mat', this.scene);
    material.diffuseTexture = new Texture('/apex/neon-billboard.png', this.scene);
    material.emissiveColor = Color3.White();
    material.disableLighting = true;

    const reflectionMaterial = new StandardMaterial('apex-billboard-refl-mat', this.scene);
    reflectionMaterial.diffuseTexture = material.diffuseTexture;
    reflectionMaterial.emissiveColor = Color3.White();
    reflectionMaterial.alpha = 0.18;
    reflectionMaterial.disableLighting = true;

    // Fixed anchors matching frame builder
    const anchors = [
      { x: -12, z: 35, side: -1, w: 8, h: 4 },
      { x: 12, z: 55, side: 1, w: 6, h: 9 },
    ];

    anchors.forEach((a, i) => {
      const billboard = MeshBuilder.CreatePlane(`apex-billboard-${i}`, { width: a.w, height: a.h }, this.scene);
      billboard.position.set(a.x, a.h / 2 + 2, a.z);
      billboard.rotation.y = a.side > 0 ? -Math.PI / 4 : Math.PI / 4;
      billboard.material = material;

      const reflection = MeshBuilder.CreatePlane(`apex-billboard-refl-${i}`, { width: a.w, height: a.w * 1.5 }, this.scene);
      reflection.position.set(a.x * 0.6, 0.01, a.z);
      reflection.rotation.x = Math.PI / 2;
      reflection.rotation.z = a.side > 0 ? -Math.PI / 4 : Math.PI / 4;
      reflection.material = reflectionMaterial;
      this.billboardReflections.push(reflection);
    });
  }

  private createCity() {
    const cityMaterial = new StandardMaterial('apex-city-base', this.scene);
    cityMaterial.diffuseColor = color('#162942');
    cityMaterial.emissiveColor = color('#030b18');
    cityMaterial.specularColor = color('#284a72');

    const windowMaterial = new StandardMaterial('apex-city-windows', this.scene);
    windowMaterial.disableLighting = true;
    windowMaterial.emissiveColor = color('#347fba');
    windowMaterial.alpha = 0.48;

    for (let index = 0; index < 22; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = 18 + Math.floor(index / 2) * 7.4;
      const height = 5 + ((index * 13) % 17);
      const width = 2.6 + ((index * 7) % 4) * 0.7;
      const building = MeshBuilder.CreateBox(`apex-city-building-${index}`, { width, height, depth: 3.5 }, this.scene);
      building.position.set(side * (APEX_STORM_ROAD.halfWidth + 3.6 + (index % 3)), height / 2 - 1.2, z);
      building.material = cityMaterial;

      if (index % 3 !== 1) {
        const windows = MeshBuilder.CreatePlane(`apex-city-windows-${index}`, { width: width * 0.58, height: height * 0.72 }, this.scene);
        windows.position.set(
          side * (APEX_STORM_ROAD.halfWidth + 3.6 + (index % 3) - side * (width / 2 + 0.02)),
          height * 0.62 - 1.2,
          z + 0.55,
        );
        windows.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        windows.material = windowMaterial;
      }
    }

    const voidPlane = MeshBuilder.CreateGround('apex-city-void', { width: 160, height: 160 }, this.scene);
    voidPlane.position.y = -5.2;
    const voidMaterial = new StandardMaterial('apex-city-void-mat', this.scene);
    voidMaterial.diffuseColor = color('#071526');
    voidMaterial.specularColor = Color3.Black();
    voidPlane.material = voidMaterial;
  }

  private updateRoad(road: readonly ApexRoadSegment[], roadPhase: number) {
    road.forEach((segment, index) => {
      const visual = this.roadVisuals[index];
      const dx = segment.end.x - segment.start.x;
      const dz = segment.end.z - segment.start.z;
      const length = Math.hypot(dx, dz);
      visual.root.position.set((segment.start.x + segment.end.x) / 2, 0, (segment.start.z + segment.end.z) / 2);
      visual.root.rotation.y = Math.atan2(dx, dz);
      visual.root.scaling.z = length;
    });
    this.asphaltTexture.vOffset = -(roadPhase % 1);
  }

  sync(state: GameState, _cameraY: number, screenShake: number): void {
    if (this.destroyed) return;
    const frame = buildApexStormFrame(state, { demo: this.demo });
    this.updateRoad(frame.road, frame.roadPhase);
    const selectedCarColor = state.selectedCar === 'PHANTOM' ? '#167c9b' : '#1557a8';

    // Speed-based FOV for sense of speed
    const speedFactor = state.speedMultiplier;
    this.camera.fov = 0.85 + (speedFactor - 1) * 0.08;

    // Lightning flash
    this.lightningLight.intensity = frame.lightningIntensity * 12;
    this.scene.ambientColor = color('#0a1520').scale(1 + frame.lightningIntensity * 4);

    // Apply screen shake to camera position
    if (screenShake > 0) {
      const shake = screenShake * 0.05;
      this.camera.position.x = (Math.random() - 0.5) * shake;
      this.camera.position.y = 2.55 + (Math.random() - 0.5) * shake;
      this.flashMaterial.alpha = Math.min(0.8, screenShake * 0.15);
    } else {
      this.camera.position.x = 0;
      this.camera.position.y = 2.55;
      this.flashMaterial.alpha = 0;
    }

    this.vehicleVisuals.forEach((slot, index) => {
      const pose = frame.vehicles[index];
      if (!pose || pose.alpha <= 0) {
        slot.hide();
        return;
      }
      slot.update(pose, selectedCarColor);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.vehicleVisuals.forEach((slot) => slot.dispose());
    this.asphaltTexture.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}
