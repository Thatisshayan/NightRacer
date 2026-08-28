import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { ApexVehiclePose } from './apex-storm-frame';

const color = (hex: string) => Color3.FromHexString(hex);

export class ApexVehicleVisual {
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
