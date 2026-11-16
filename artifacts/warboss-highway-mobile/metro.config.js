const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// GLTF/GLB 3D models + HDR environment maps for the React Three Fiber
// native renderer (see docs/superpowers/plans/2026-08-28-r3f-native-3d-renderer.md) —
// Metro treats unknown extensions as source, not binary assets, by default.
config.resolver.assetExts.push('glb', 'gltf', 'hdr', 'bin');

// three.js ships two builds behind package "exports": `import` resolves to
// build/three.module.js and `require` to build/three.cjs. This app's own code
// and three/examples/jsm (GLTFLoader) use `import`; @react-three/fiber's
// native build uses `require`. Metro honoured both, so the bundle carried TWO
// copies of three ("Multiple instances of Three.js being imported").
// @react-three/fiber/native patches THREE.TextureLoader for React Native
// (there is no DOM <img>) on ITS copy, while GLTFLoader used the other,
// unpatched copy — so every vehicle model's embedded texture failed to load
// and the cars rendered as plain untextured white. Pin every `three` request
// to one file.
const threeEntry = require.resolve('three');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { type: 'sourceFile', filePath: threeEntry };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
