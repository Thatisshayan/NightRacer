import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Group, MeshStandardMaterial } from 'three';
import type { ApexVehiclePose } from '@workspace/render-frame';

export interface VehicleMeshHandle {
  update(pose: ApexVehiclePose | undefined, selectedCarColor: string): void;
}

const TRAFFIC_COLOR = '#8a2f3a';
const ONCOMING_LIGHT_COLOR = '#d7f5ff';
const SAME_DIRECTION_LIGHT_COLOR = '#ff3f53';

// Primitive box-car geometry today. Swap the two <mesh> children below for
// <primitive object={gltf.scene.clone()} /> from a useGLTF() call once real
// vehicle models exist (see the plan's "Deferred" section) — the group ref
// and update() contract stay identical, so no call site changes.
export const VehicleMesh = forwardRef<VehicleMeshHandle, { index: number }>(function VehicleMesh(_props, ref) {
  const group = useRef<Group>(null);
  const bodyMaterial = useRef<MeshStandardMaterial>(null);
  const lampMaterial = useRef<MeshStandardMaterial>(null);

  useImperativeHandle(ref, () => ({
    update(pose, selectedCarColor) {
      const g = group.current;
      const bodyMat = bodyMaterial.current;
      const lampMat = lampMaterial.current;
      if (!g || !bodyMat || !lampMat) return;
      if (!pose || pose.alpha <= 0) {
        g.visible = false;
        return;
      }
      g.visible = true;
      g.position.set(pose.x, pose.y, pose.z);
      g.rotation.y = pose.heading;
      g.scale.set(pose.width / 2.3, 1, pose.length / 4.5);

      bodyMat.color.set(pose.kind === 'player' ? selectedCarColor : TRAFFIC_COLOR);
      bodyMat.opacity = pose.alpha;
      bodyMat.transparent = pose.alpha < 1;

      lampMat.color.set(pose.lights.facesCamera ? ONCOMING_LIGHT_COLOR : SAME_DIRECTION_LIGHT_COLOR);
      lampMat.emissive.set(pose.lights.facesCamera ? ONCOMING_LIGHT_COLOR : SAME_DIRECTION_LIGHT_COLOR);
      lampMat.emissiveIntensity = pose.lights.intensity;
      lampMat.opacity = pose.alpha;
      lampMat.transparent = pose.alpha < 1;
    },
  }));

  return (
    <group ref={group} visible={false}>
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.7, 4.2]} />
        <meshStandardMaterial ref={bodyMaterial} color="#1557a8" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.85, -0.3]}>
        <boxGeometry args={[1.4, 0.5, 2]} />
        <meshStandardMaterial color="#0a1520" metalness={0.1} roughness={0.1} />
      </mesh>
      <mesh position={[0, 0.4, 2.05]}>
        <boxGeometry args={[1.5, 0.25, 0.05]} />
        <meshStandardMaterial ref={lampMaterial} color="#ff3f53" emissive="#ff3f53" emissiveIntensity={0.7} />
      </mesh>
      {[[-0.95, 0.3, 1.4], [0.95, 0.3, 1.4], [-0.95, 0.3, -1.4], [0.95, 0.3, -1.4]].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.35, 0.35, 0.3, 16]} />
          <meshStandardMaterial color="#0d0d0d" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
});
