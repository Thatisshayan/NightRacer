// This package deliberately omits the "dom" lib (see tsconfig.json) so any
// accidental `window`/`document`/`navigator`/`HTMLCanvasElement` usage is a
// compile error — the whole point of extracting a platform-agnostic engine.
// `requestAnimationFrame`/`cancelAnimationFrame`/`performance.now()` are the
// one exception: real globals on both the web and React Native (Hermes
// polyfills all three), just declared under "dom" upstream. Minimal ambient
// types for just those three keep everything else off-limits.
declare function requestAnimationFrame(callback: (time: number) => void): number;
declare function cancelAnimationFrame(handle: number): void;
declare const performance: { now(): number };
