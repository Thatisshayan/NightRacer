import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { AdditiveBlending, InstancedMesh, Object3D } from 'three';
import { APEX_STORM_ROAD, sampleApexRoad } from '@workspace/render-frame';
import { getGlowTexture } from './textures';

export interface RoadsideHandle {
  update(roadPhase: number, travel: number): void;
}

const LAMPS_PER_SIDE = 14;
const LAMP_COUNT = LAMPS_PER_SIDE * 2;
const LAMP_SPACING = 18;
const Z_MIN = -22;
const Z_RANGE = LAMPS_PER_SIDE * LAMP_SPACING;
const POST_HEIGHT = 5.2;
const POST_OFFSET = APEX_STORM_ROAD.halfWidth + 1.1;
const POOL_OFFSET = APEX_STORM_ROAD.halfWidth - 1.7;

// Street lamps along both verges, with a pool of light on the wet road under
// each. They follow the road's curve and stream past with `travel`, which is
// the strongest speed cue in the scene: without anything at the roadside the
// only thing that visibly moved was the lane paint.
export function Roadside({ handleRef }: { handleRef: MutableRefObject<RoadsideHandle | null> }) {
  const posts = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  const pools = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const glowMap = useMemo(() => getGlowTexture(), []);

  handleRef.current = {
    update(roadPhase, travel) {
      const postMesh = posts.current;
      const headMesh = heads.current;
      const poolMesh = pools.current;
      if (!postMesh || !headMesh || !poolMesh) return;
      for (let i = 0; i < LAMP_COUNT; i += 1) {
        const side = i % 2 === 0 ? 1 : -1;
        const slot = Math.floor(i / 2);
        // Stagger the two sides by half a spacing so lamps alternate.
        const base = slot * LAMP_SPACING + (side === 1 ? 0 : LAMP_SPACING / 2);
        const wrapped = (((base - travel) % Z_RANGE) + Z_RANGE) % Z_RANGE;
        const z = Z_MIN + wrapped;
        // X is negated: see toSceneX in R3FGameScene.tsx.
        const centre = -sampleApexRoad(z, roadPhase).x;
        const postX = centre + side * POST_OFFSET;

        dummy.rotation.set(0, 0, 0);
        dummy.position.set(postX, POST_HEIGHT / 2, z);
        dummy.scale.set(0.16, POST_HEIGHT, 0.16);
        dummy.updateMatrix();
        postMesh.setMatrixAt(i, dummy.matrix);

        // Lamp head on an arm reaching out over the carriageway.
        dummy.position.set(postX - side * 0.9, POST_HEIGHT, z);
        dummy.scale.set(1.8, 0.14, 0.36);
        dummy.updateMatrix();
        headMesh.setMatrixAt(i, dummy.matrix);

        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.position.set(centre + side * POOL_OFFSET, 0.02, z);
        dummy.scale.set(7, 8, 1);
        dummy.updateMatrix();
        poolMesh.setMatrixAt(i, dummy.matrix);
      }
      postMesh.instanceMatrix.needsUpdate = true;
      headMesh.instanceMatrix.needsUpdate = true;
      poolMesh.instanceMatrix.needsUpdate = true;
    },
  };

  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, LAMP_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#1c2536" />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, LAMP_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffe2b0" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, LAMP_COUNT]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#ffc98a"
          map={glowMap}
          transparent
          opacity={0.3}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </>
  );
}
