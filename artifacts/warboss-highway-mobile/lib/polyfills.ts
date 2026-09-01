// three.js's GLTFLoader (>= r160) reads `navigator.userAgent` to detect
// Safari/Firefox for an ImageBitmapLoader feature check. React Native
// defines a global `navigator` object but leaves `userAgent` undefined,
// so GLTFLoader's `userAgent.match(...)` throws "Cannot read property
// 'match' of undefined" the instant a GLTF model is parsed on-device.
// Must run before any GLTFLoader is constructed (see VehicleMesh.tsx).
if (typeof navigator !== 'undefined' && !navigator.userAgent) {
  navigator.userAgent = 'ReactNative';
}
