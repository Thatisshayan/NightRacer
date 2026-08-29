const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// GLTF/GLB 3D models + HDR environment maps for the React Three Fiber
// native renderer (see docs/superpowers/plans/2026-08-28-r3f-native-3d-renderer.md) —
// Metro treats unknown extensions as source, not binary assets, by default.
config.resolver.assetExts.push('glb', 'gltf', 'hdr', 'bin');

module.exports = config;
