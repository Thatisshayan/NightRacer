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
} from '@workspace/render-frame';
import { ApexVehicleVisual } from './apex-vehicle-visual';

const VIEWPORT_WIDTH = 420;
const VIEWPORT_HEIGHT = 800;
const MAX_VEHICLE_SLOTS = 10;

const color = (hex: string) => Color3.FromHexString(hex);

interface RoadVisual {
  root: TransformNode;
  plane: Mesh;
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
  private readonly steamSystem: ParticleSystem;
  private readonly billboardReflections: Mesh[] = [];
  private readonly tunnelRoot: TransformNode;
  private readonly asphaltMaterial: StandardMaterial;
  private readonly concreteMaterial: StandardMaterial;
  private readonly demo: boolean;
  private destroyed = false;

  private constructor(host: HTMLElement, width: number, height: number, options?: { demo?: boolean }) {
    this.demo = options?.demo ?? false;
    this.canvas = this.createCanvas(host, width, height);
    this.engine = new Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
    });
    this.scene = this.createScene();
    this.camera = this.createCamera();
    this.setupLights();

    const roadMaterials = this.createRoadMaterials();
    this.asphaltTexture = roadMaterials.asphaltTexture;
    this.asphaltMaterial = roadMaterials.asphaltMaterial;
    this.concreteMaterial = roadMaterials.concreteMaterial;

    this.roadVisuals = this.createRoad();
    this.createCity();
    this.tunnelRoot = this.createTunnel();
    this.vehicleVisuals = Array.from({ length: MAX_VEHICLE_SLOTS }, (_, index) => new ApexVehicleVisual(this.scene, index));

    const flash = this.createFlashPlane();
    this.flashMaterial = flash.material;
    this.flashPlane = flash.plane;

    this.lightningLight = new PointLight('apex-lightning-light', new Vector3(0, 10, 30), this.scene);
    this.lightningLight.intensity = 0;
    this.lightningLight.diffuse = color('#d7f5ff');

    this.rainSystem = this.createRain();
    this.steamSystem = this.createSteam();
    this.createBillboards();

    this.engine.runRenderLoop(() => {
      if (!this.destroyed) this.scene.render();
    });
  }

  private createCanvas(host: HTMLElement, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.className = 'block w-full h-full pointer-events-none';
    canvas.setAttribute('aria-hidden', 'true');
    host.replaceChildren(canvas);
    return canvas;
  }

  private createScene(): Scene {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color4(0.018, 0.045, 0.088, 1);
    scene.ambientColor = color('#0a1520');
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.012;
    scene.fogColor = color('#112941');
    return scene;
  }

  private createCamera(): FreeCamera {
    // Deliberately shallow rear chase: the vehicle rear and wheel line remain
    // visible while the physical road, rather than a lane-grid projection, owns depth.
    const camera = new FreeCamera('apex-storm-camera', new Vector3(0, 2.55, -14.5), this.scene);
    camera.fov = 0.82;
    camera.minZ = 0.1;
    camera.maxZ = 130;
    camera.setTarget(new Vector3(3.45, 5.80, 24));
    return camera;
  }

  private setupLights(): void {
    const skyFill = new HemisphericLight('apex-sky-fill', new Vector3(0, 1, 0), this.scene);
    skyFill.diffuse = color('#5779a9');
    skyFill.groundColor = color('#0b1728');
    skyFill.intensity = 0.95;
    const moonKey = new DirectionalLight('apex-moon-key', new Vector3(-0.35, -1, 0.35), this.scene);
    moonKey.diffuse = color('#b8dcff');
    moonKey.intensity = 1.35;
  }

  private createRoadMaterials(): { asphaltTexture: Texture; asphaltMaterial: StandardMaterial; concreteMaterial: StandardMaterial } {
    const asphaltTexture = new Texture(`${import.meta.env.BASE_URL}apex/wet-asphalt-tile.jpg`, this.scene, true, false);
    asphaltTexture.uScale = 2.2;
    asphaltTexture.vScale = 6.5;

    const asphaltMaterial = new StandardMaterial('apex-asphalt-mat', this.scene);
    asphaltMaterial.diffuseTexture = asphaltTexture;
    asphaltMaterial.diffuseColor = color('#405672');
    asphaltMaterial.emissiveColor = color('#071625');
    asphaltMaterial.specularColor = color('#b5dbff');
    asphaltMaterial.specularPower = 128;

    const concreteTexture = new Texture(`${import.meta.env.BASE_URL}apex/concrete-tunnel-tile.jpg`, this.scene, true, false);
    concreteTexture.uScale = 2.2;
    concreteTexture.vScale = 6.5;
    const concreteMaterial = new StandardMaterial('apex-concrete-mat', this.scene);
    concreteMaterial.diffuseTexture = concreteTexture;
    concreteMaterial.diffuseColor = color('#505a66');
    concreteMaterial.emissiveColor = color('#0a0f18');
    concreteMaterial.specularColor = color('#8ba7c8');
    concreteMaterial.specularPower = 64;

    return { asphaltTexture, asphaltMaterial, concreteMaterial };
  }

  private createFlashPlane(): { material: StandardMaterial; plane: Mesh } {
    const material = new StandardMaterial('apex-flash', this.scene);
    material.disableLighting = true;
    material.emissiveColor = color('#ffffff');
    material.alpha = 0;

    const plane = MeshBuilder.CreatePlane('apex-flash-plane', { width: 10, height: 10 }, this.scene);
    plane.parent = this.camera;
    plane.position.z = 1;
    plane.material = material;
    plane.isPickable = false;

    return { material, plane };
  }

  static async create(host: HTMLElement, width = VIEWPORT_WIDTH, height = VIEWPORT_HEIGHT, options?: { demo?: boolean }) {
    return new ApexStormRenderer(host, width, height, options);
  }

  private createRoad(): RoadVisual[] {
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
      asphaltMesh.material = this.asphaltMaterial;

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

      return { root, plane: asphaltMesh };
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

  private createSteam(): ParticleSystem {
    const system = new ParticleSystem('apex-steam', 400, this.scene);
    system.particleTexture = new Texture('/apex/steam-puff.png', this.scene);
    system.minEmitBox = new Vector3(-1, 0, -1);
    system.maxEmitBox = new Vector3(1, 0, 1);
    system.color1 = new Color4(1, 1, 1, 0.2);
    system.color2 = new Color4(0.8, 0.9, 1, 0.1);
    system.minSize = 1.5;
    system.maxSize = 3.5;
    system.minLifeTime = 1.5;
    system.maxLifeTime = 3.0;
    system.emitRate = 0; // Triggered by vents
    system.gravity = new Vector3(0, 0.5, 0);
    system.direction1 = new Vector3(-0.2, 1, -0.2);
    system.direction2 = new Vector3(0.2, 1, 0.2);
    system.updateSpeed = 0.016;
    system.start();
    return system;
  }

  private createTunnel(): TransformNode {
    const root = new TransformNode('apex-tunnel-root', this.scene);
    root.setEnabled(false);

    const wallMat = new StandardMaterial('apex-tunnel-wall-mat', this.scene);
    wallMat.diffuseColor = color('#1a2a3a');
    wallMat.emissiveColor = color('#050a15');

    // Simple overhead ribs
    for (let i = 0; i < 15; i++) {
      const rib = MeshBuilder.CreateBox(`apex-tunnel-rib-${i}`, { width: 16, height: 0.8, depth: 1.2 }, this.scene);
      rib.parent = root;
      rib.position.set(0, 8, APEX_STORM_ROAD.nearZ + i * 6);
      rib.material = wallMat;

      const light = MeshBuilder.CreatePlane(`apex-tunnel-light-${i}`, { width: 4, height: 0.2 }, this.scene);
      light.parent = rib;
      light.position.set(0, -0.41, 0);
      light.rotation.x = Math.PI / 2;
      const lightMat = new StandardMaterial(`apex-tunnel-light-mat-${i}`, this.scene);
      lightMat.emissiveColor = color('#ffaa00');
      lightMat.disableLighting = true;
      light.material = lightMat;
    }

    return root;
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

  private updateRoad(road: readonly ApexRoadSegment[], roadPhase: number, biome: string) {
    road.forEach((segment, index) => {
      const visual = this.roadVisuals[index];
      const dx = segment.end.x - segment.start.x;
      const dz = segment.end.z - segment.start.z;
      const length = Math.hypot(dx, dz);
      visual.root.position.set((segment.start.x + segment.end.x) / 2, 0, (segment.start.z + segment.end.z) / 2);
      visual.root.rotation.y = Math.atan2(dx, dz);
      visual.root.scaling.z = length;

      if (visual.plane) {
        visual.plane.material = biome === 'tunnel' ? this.concreteMaterial : this.asphaltMaterial;
      }
    });
    this.asphaltTexture.vOffset = -(roadPhase % 1);
    const concreteTexture = this.concreteMaterial.diffuseTexture as Texture | null;
    if (concreteTexture) {
      concreteTexture.vOffset = -(roadPhase % 1);
    }
  }

  sync(state: GameState, _cameraY: number, screenShake: number): void {
    if (this.destroyed) return;
    const frame = buildApexStormFrame(state, { demo: this.demo });
    this.updateRoad(frame.road, frame.roadPhase, frame.biome);

    // Biome effects
    if (frame.biome === 'tunnel') {
      this.tunnelRoot.setEnabled(true);
      this.rainSystem.stop();
      this.steamSystem.emitRate = 40;
      // Position steam vents
      if (frame.steamVents.length > 0) {
        this.steamSystem.emitter = new Vector3(frame.steamVents[0].x, 0, frame.steamVents[0].z);
      }
    } else {
      this.tunnelRoot.setEnabled(false);
      this.rainSystem.start();
      this.steamSystem.emitRate = 0;
    }
    const selectedCarColor = state.selectedCar === 'PHANTOM' ? '#167c9b' : '#1557a8';

    // Speed-based FOV for sense of speed
    const speedFactor = state.speedMultiplier;
    this.camera.fov = 0.85 + (speedFactor - 1) * 0.08;

    // Lightning flash
    this.lightningLight.intensity = frame.lightningIntensity * 12;
    this.scene.ambientColor = color('#0a1520').scale(1 + frame.lightningIntensity * 4);

    // Apply screen shake to camera position. Uses deterministic high-frequency
    // noise (not Math.random) so repeated captures of the same frame are
    // reproducible.
    if (screenShake > 0) {
      const shake = screenShake * 0.05;
      const now = performance.now();
      this.camera.position.x = Math.sin(now * 0.083) * shake * 0.5;
      this.camera.position.y = 2.55 + Math.sin(now * 0.071 + 1.7) * shake * 0.5;
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
