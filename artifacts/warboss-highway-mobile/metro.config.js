const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// react-native-skia's web target loads CanvasKit as a .wasm binary
// (LoadSkiaWeb() in app/_layout.tsx) — without this, Metro doesn't know to
// serve .wasm as a static asset and returns its HTML 404 page instead,
// which then fails WebAssembly.instantiate() with a bogus-magic-word
// error. No effect on iOS/Android, which never load this file.
config.resolver.assetExts.push('wasm');

module.exports = config;
