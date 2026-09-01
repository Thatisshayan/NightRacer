import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

// This composer runs a full postprocessing pass (bloom + vignette) through
// expo-gl's WebGL2 implementation. expo-gl does not cover every Three.js /
// postprocessing feature a desktop browser gets (see the Atmosphere.tsx
// comment documenting this), and half-float render targets + mipmap blur are
// the classic source of colored-noise / "garbage pixels" and shifted colors
// on mobile GL drivers. The repo's proven-good device baseline is a plain
// <Canvas> with no EffectComposer at all (see R3FSmokeTest.tsx), so this is
// DISABLED by default on the native renderer to stay on that proven surface.
//
// Re-enable deliberately and only when confirming on a real device that the
// composer no longer produces artifacts:
//   EXPO_PUBLIC_ENABLE_POSTFX=1
export function PostFX() {
  if (process.env.EXPO_PUBLIC_ENABLE_POSTFX !== '1') {
    return null;
  }
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.6} luminanceThreshold={0.4} luminanceSmoothing={0.2} mipmapBlur />
      <Vignette eskil={false} offset={0.25} darkness={0.6} />
    </EffectComposer>
  );
}
