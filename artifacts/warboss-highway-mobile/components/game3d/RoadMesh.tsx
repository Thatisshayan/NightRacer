import { useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, MeshStandardMaterial } from 'three';
import { APEX_STORM_ROAD, sampleApexRoad } from '@workspace/render-frame';
import { getRoadColorTexture, getRoadEmissiveTexture, ROAD_TEXTURE_LENGTH } from './textures';
import { addWetSheen } from './reflections';

export interface RoadMeshHandle {
  /** roadPhase: curve phase from the frame. travel: world units the surface
   * has scrolled toward the camera (drives the lane-paint scroll). */
  update(roadPhase: number, travel: number): void;
}

// The road is drawn well past the frame's own road segments (which stop at
// APEX_STORM_ROAD.farZ = 70): from this renderer's raised chase camera the
// far end of a 70-unit road is in plain view, ending in mid-air. Sampling the
// same shared curve further out lets fog swallow the far end instead.
const ROAD_START_Z = -22;
const ROAD_END_Z = 190;
const SAMPLE_COUNT = 80;
const HALF_WIDTH = APEX_STORM_ROAD.halfWidth;
const RAIL_OFFSET = HALF_WIDTH + 0.12;
const RAIL_HEIGHT = 0.62;

/** Two vertices per sample, joined into a strip of quads. */
function createRibbon(withUv: boolean): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = new BufferAttribute(new Float32Array(SAMPLE_COUNT * 2 * 3), 3);
  positions.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', positions);

  const normals = new Float32Array(SAMPLE_COUNT * 2 * 3);
  for (let i = 0; i < SAMPLE_COUNT * 2; i += 1) normals[i * 3 + 1] = 1;
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));

  if (withUv) {
    const uvs = new Float32Array(SAMPLE_COUNT * 2 * 2);
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const z = ROAD_START_Z + ((ROAD_END_Z - ROAD_START_Z) * i) / (SAMPLE_COUNT - 1);
      const v = z / ROAD_TEXTURE_LENGTH;
      uvs[i * 4] = 0;
      uvs[i * 4 + 1] = v;
      uvs[i * 4 + 2] = 1;
      uvs[i * 4 + 3] = v;
    }
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  }

  const indices: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT - 1; i += 1) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  geometry.setIndex(indices);
  return geometry;
}

// One continuous ribbon instead of the previous 22 flat-coloured boxes: the
// boxes left visible seams on every bend, had no surface detail at all, and
// carried a single dash each that never moved — so nothing on screen conveyed
// speed. The lane paint now lives in a texture that scrolls with `travel`.
export function RoadSegments({ handleRef }: { handleRef: MutableRefObject<RoadMeshHandle | null> }) {
  const surface = useMemo(() => createRibbon(true), []);
  const leftRail = useMemo(() => createRibbon(false), []);
  const rightRail = useMemo(() => createRibbon(false), []);
  // Only one road exists at a time, so it scrolls the shared textures
  // directly (a clone would need its own upload to be valid).
  const colorMap = useMemo(() => getRoadColorTexture(), []);
  const emissiveMap = useMemo(() => getRoadEmissiveTexture(), []);
  // Built imperatively (not as JSX) so the wet-sheen shader hook is attached
  // before the material is first compiled.
  const surfaceMaterial = useMemo(
    () =>
      addWetSheen(
        new MeshStandardMaterial({
          map: colorMap,
          emissiveMap,
          emissive: '#ffffff',
          emissiveIntensity: 1,
          roughness: 0.62,
          metalness: 0.1,
          side: DoubleSide,
        }),
        [0.13, 0.15, 0.34],
      ),
    [colorMap, emissiveMap],
  );

  handleRef.current = {
    update(roadPhase, travel) {
      const road = surface.getAttribute('position') as BufferAttribute;
      const left = leftRail.getAttribute('position') as BufferAttribute;
      const right = rightRail.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < SAMPLE_COUNT; i += 1) {
        const z = ROAD_START_Z + ((ROAD_END_Z - ROAD_START_Z) * i) / (SAMPLE_COUNT - 1);
        // X is negated: frame coordinates are left-handed (Babylon), three.js
        // is right-handed. See toSceneX in R3FGameScene.tsx.
        const centre = -sampleApexRoad(z, roadPhase).x;
        road.setXYZ(i * 2, centre - HALF_WIDTH, 0, z);
        road.setXYZ(i * 2 + 1, centre + HALF_WIDTH, 0, z);
        left.setXYZ(i * 2, centre - RAIL_OFFSET, 0, z);
        left.setXYZ(i * 2 + 1, centre - RAIL_OFFSET, RAIL_HEIGHT, z);
        right.setXYZ(i * 2, centre + RAIL_OFFSET, 0, z);
        right.setXYZ(i * 2 + 1, centre + RAIL_OFFSET, RAIL_HEIGHT, z);
      }
      road.needsUpdate = true;
      left.needsUpdate = true;
      right.needsUpdate = true;

      // A texel at texture-v sits at z = (v - offset) * LENGTH, so a growing
      // offset moves the paint toward the camera (-z).
      const offset = (travel / ROAD_TEXTURE_LENGTH) % 1;
      colorMap.offset.y = offset;
      emissiveMap.offset.y = offset;
    },
  };

  return (
    <>
      {/* Dark ground either side of the road so there is no void under the
          city. Sits just below the road surface to avoid z-fighting. */}
      <mesh position={[0, -0.12, 90]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[700, 360]} />
        <meshBasicMaterial color="#070d18" />
      </mesh>
      <mesh geometry={surface} material={surfaceMaterial} frustumCulled={false} />
      <mesh geometry={leftRail} frustumCulled={false}>
        <meshBasicMaterial color="#19c8f0" side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh geometry={rightRail} frustumCulled={false}>
        <meshBasicMaterial color="#19c8f0" side={DoubleSide} toneMapped={false} />
      </mesh>
    </>
  );
}
