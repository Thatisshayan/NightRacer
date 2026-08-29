import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { APEX_STORM_ROAD, type ApexBiome, type ApexRoadSegment } from '@workspace/render-frame';

export interface RoadMeshHandle {
  update(road: readonly ApexRoadSegment[], biome: ApexBiome): void;
}

const HALF_WIDTH = APEX_STORM_ROAD.halfWidth;
const HIGHWAY_ASPHALT_COLOR = '#405672';
const TUNNEL_CONCRETE_COLOR = '#505a66';

// One persistent Group per road slot, reused for the segment's whole
// lifetime — matches apex-storm-renderer.ts's TransformNode pooling so the
// scene never allocates per frame. `update()` only ever mutates transforms
// and material color; it never creates or destroys meshes.
export function RoadSegments({ handleRef }: { handleRef: MutableRefObject<RoadMeshHandle | null> }) {
  const groups = useRef<(Group | null)[]>([]);
  const asphaltMeshes = useRef<(Mesh | null)[]>([]);
  const segments = useMemo(
    () => Array.from({ length: APEX_STORM_ROAD.segmentCount }, (_, i) => i),
    [],
  );

  handleRef.current = {
    update(road, biome) {
      const color = biome === 'tunnel' ? TUNNEL_CONCRETE_COLOR : HIGHWAY_ASPHALT_COLOR;
      road.forEach((segment, index) => {
        const group = groups.current[index];
        if (!group) return;
        const dx = segment.end.x - segment.start.x;
        const dz = segment.end.z - segment.start.z;
        const length = Math.hypot(dx, dz);
        group.position.set(
          (segment.start.x + segment.end.x) / 2,
          0,
          (segment.start.z + segment.end.z) / 2,
        );
        group.rotation.y = Math.atan2(dx, dz);
        group.scale.z = length || 1;

        const asphalt = asphaltMeshes.current[index];
        const material = asphalt?.material as MeshStandardMaterial | undefined;
        if (material) {
          material.color.set(color);
          material.roughness = biome === 'tunnel' ? 0.55 : 0.3 + (1 - segment.wetness) * 0.3;
        }
      });
    },
  };

  return (
    <>
      {segments.map((i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }}>
          <mesh
            position={[0, -0.06, 0]}
            receiveShadow
            ref={(m) => { asphaltMeshes.current[i] = m; }}
          >
            <boxGeometry args={[HALF_WIDTH * 2, 0.12, 1]} />
            <meshStandardMaterial color={HIGHWAY_ASPHALT_COLOR} roughness={0.35} metalness={0.05} />
          </mesh>
          <mesh position={[-(HALF_WIDTH - 0.08), 0.24, 0]} castShadow>
            <boxGeometry args={[0.18, 0.58, 1]} />
            <meshStandardMaterial color="#124259" emissive="#0a9cbe" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[HALF_WIDTH - 0.08, 0.24, 0]} castShadow>
            <boxGeometry args={[0.18, 0.58, 1]} />
            <meshStandardMaterial color="#124259" emissive="#0a9cbe" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, 0.014, 0]}>
            <boxGeometry args={[0.12, 0.025, 0.36]} />
            <meshStandardMaterial color="#f4b43f" emissive="#f4b43f" emissiveIntensity={0.4} />
          </mesh>
        </group>
      ))}
    </>
  );
}
