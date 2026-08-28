import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
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
  private readonly bodyMaterial: StandardMaterial;
  private readonly lightMaterial: StandardMaterial;
  private readonly shadowMaterial: StandardMaterial;
  private readonly reflectionMaterial: StandardMaterial;

  constructor(scene: Scene, index: number) {
    this.root = new TransformNode(`apex-vehicle-root-${index}`, scene);
    this.root.setEnabled(false);
    this.body = new TransformNode(`apex-vehicle-body-${index}`, scene);
    this.body.parent = this.root;
    this.bodyMaterial = this.createBodyMaterial(scene, index);
    this.lightMaterial = this.createLightMaterial(scene, index);
    this.shadowMaterial = this.createShadowMaterial(scene, index);
    this.reflectionMaterial = this.createReflectionMaterial(scene, index);
    this.reflection = this.createReflection(scene, index);
    this.shadow = this.createShadow(scene, index);
    this.createBody(scene, index);
    this.createWheelSet(scene, index);
    this.createLamps(scene, index);
  }

  private createBodyMaterial(scene: Scene, index: number) {
    const material = new StandardMaterial(`apex-body-${index}`, scene);
    material.diffuseColor = color('#1b365f');
    material.specularColor = color('#7fb8ff');
    material.specularPower = 96;
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

  private createBody(scene: Scene, index: number) {
    const chassis = MeshBuilder.CreateBox(`apex-chassis-${index}`, { width: 2.3, height: 0.42, depth: 4.5 }, scene);
    chassis.parent = this.body;
    chassis.material = this.bodyMaterial;

    const hood = MeshBuilder.CreateBox(`apex-hood-${index}`, { width: 2.08, height: 0.18, depth: 1.35 }, scene);
    hood.parent = this.body;
    hood.position.set(0, 0.24, 1.25);
    hood.material = this.bodyMaterial;

    const cabin = MeshBuilder.CreateBox(`apex-cabin-${index}`, { width: 1.55, height: 0.52, depth: 1.9 }, scene);
    cabin.parent = this.body;
    cabin.position.set(0, 0.41, -0.1);
    cabin.material = this.bodyMaterial;

    const bumper = MeshBuilder.CreateBox(`apex-bumper-${index}`, { width: 1.58, height: 0.16, depth: 0.24 }, scene);
    bumper.parent = this.body;
    bumper.position.set(0, 0.03, -2.22);
    bumper.material = this.bodyMaterial;
  }

  private createWheelSet(scene: Scene, index: number) {
    for (const side of [-1, 1]) {
      for (const fore of [-1, 1]) this.createWheel(scene, index, side, fore);
    }
  }

  private createWheel(scene: Scene, index: number, side: number, fore: number) {
    const wheel = MeshBuilder.CreateCylinder(`apex-wheel-${index}-${side}-${fore}`, { diameter: 0.66, height: 0.28, tessellation: 12 }, scene);
    wheel.parent = this.root;
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.28, 0.31, fore * 1.42);
    const wheelMaterial = new StandardMaterial(`apex-wheel-mat-${index}-${side}-${fore}`, scene);
    wheelMaterial.diffuseColor = color('#0a101a');
    wheelMaterial.specularColor = color('#8ba7c8');
    wheelMaterial.specularPower = 80;
    wheel.material = wheelMaterial;

    const rim = MeshBuilder.CreateCylinder(`apex-rim-${index}-${side}-${fore}`, { diameter: 0.28, height: 0.292, tessellation: 12 }, scene);
    rim.parent = this.root;
    rim.rotation.z = Math.PI / 2;
    rim.position.set(side * 1.28, 0.31, fore * 1.42);
    const rimMaterial = new StandardMaterial(`apex-rim-mat-${index}-${side}-${fore}`, scene);
    rimMaterial.diffuseColor = color('#4e6985');
    rimMaterial.emissiveColor = color('#102338');
    rim.material = rimMaterial;
  }

  private createLamps(scene: Scene, index: number) {
    for (const side of [-1, 1]) {
      const lamp = MeshBuilder.CreateBox(`apex-lamp-${index}-${side}`, { width: 0.48, height: 0.12, depth: 0.08 }, scene);
      lamp.parent = this.body;
      lamp.position.set(side * 0.62, 0.06, -2.27);
      lamp.material = this.lightMaterial;
      this.lamps.push(lamp);
    }
  }

  update(pose: ApexVehiclePose, selectedCarColor: string) {
    this.root.setEnabled(true);
    const scaleX = pose.width / 2.3;
    const scaleZ = pose.length / 4.5;
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.set(0, pose.heading, 0);
    this.root.scaling.set(scaleX, 0.95, scaleZ);
    this.body.position.y = pose.y;
    this.shadow.scaling.set(pose.shadow.radiusX / scaleX, pose.shadow.radiusZ / scaleZ, 1);
    this.reflection.scaling.set(
      (pose.width * 0.20) / (0.5 * scaleX),
      (pose.reflection.length * 1.3) / (4.6 * scaleZ),
      1,
    );
    this.reflection.position.z = (-pose.reflection.length * 0.76) / scaleZ;
    this.lamps.forEach((lamp) => {
      lamp.position.z = pose.lights.facesCamera ? 2.27 : -2.27;
    });

    const paint = pose.kind === 'player'
      ? selectedCarColor
      : pose.kind === 'oncoming'
        ? '#26384e'
        : '#722036';
    this.bodyMaterial.diffuseColor = color(paint);
    this.bodyMaterial.alpha = pose.alpha;
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

  private createCity() {
    const cityMaterial = new StandardMaterial('apex-city-base', this.scene);
    cityMaterial.diffuseColor = color('#162942');
    cityMaterial.emissiveColor = color('#030b18');
    cityMaterial.specularColor = color('#284a72');

    const windowMaterial = new StandardMaterial('apex-city-windows', this.scene);
    windowMaterial.disableLighting = true;
    windowMaterial.emissiveColor = color('#347fba');
    windowMaterial.alpha = 0.48;

    const billboardMaterial = new StandardMaterial('apex-city-billboard', this.scene);
    billboardMaterial.disableLighting = true;
    billboardMaterial.emissiveColor = color('#9c32db');
    billboardMaterial.alpha = 0.72;

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
        windows.material = index % 5 === 0 ? billboardMaterial : windowMaterial;
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

  sync(state: GameState): void {
    if (this.destroyed) return;
    const frame = buildApexStormFrame(state, { demo: this.demo });
    this.updateRoad(frame.road, frame.roadPhase);
    const selectedCarColor = state.selectedCar === 'PHANTOM' ? '#167c9b' : '#1557a8';

    this.vehicleVisuals.forEach((slot, index) => {
      const pose = frame.vehicles[index];
      if (!pose) {
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
