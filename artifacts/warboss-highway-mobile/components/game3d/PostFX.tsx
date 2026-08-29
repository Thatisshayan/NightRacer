import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

// multisampling={0} matters on mobile GPUs: @react-three/postprocessing's
// default MSAA sample count is tuned for desktop and will tank frame rate
// on a phone GPU. Antialiasing instead comes from <Canvas gl={{ antialias:
// true }}> on the parent Canvas (see R3FGameScene.tsx).
export function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.6} luminanceThreshold={0.4} luminanceSmoothing={0.2} mipmapBlur />
      <Vignette eskil={false} offset={0.25} darkness={0.6} />
    </EffectComposer>
  );
}
