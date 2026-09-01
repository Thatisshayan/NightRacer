// Split out of the (now-archived) GameCanvas.tsx so index.tsx's sizing math
// for the live 3D renderer doesn't need to import from dead 2D-renderer code.
// Matches the web app's internal game resolution (see
// artifacts/warboss-highway/src/pages/Game.tsx's canvas width/height) so
// GameEngine's lane math produces the same layout on both platforms.
export const GAME_WIDTH = 420;
export const GAME_HEIGHT = 800;
