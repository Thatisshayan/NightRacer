import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  type SkImage,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { CAR_STATS, type GameRenderer, type GameState, type Obstacle, type Particle, type PowerUpItem, type Vehicle } from '@workspace/game-core';
import type { NativeGameEngine } from './native-engine';
import { useSpriteImages, vehicleImage } from './sprites';

// Matches the web app's internal game resolution (see
// artifacts/warboss-highway/src/pages/Game.tsx's canvas width/height) so
// GameEngine's lane math produces the same layout on both platforms.
export const GAME_WIDTH = 420;
export const GAME_HEIGHT = 800;
const ROAD_TILE_SIZE = 80;
// Must mirror engine.ts's camera-follow clamp (cameraMax = height * 0.18)
// and this file's own screen-shake ceiling ((300/300) * 9) — the road tiling
// has to overscan by at least this much above the viewport, or dragging the
// player toward the top of the screen (which pushes cameraY negative,
// translating the whole scene down) exposes bare canvas background above
// the topmost tile row.
const CAMERA_MAX = GAME_HEIGHT * 0.18;
const MAX_SHAKE_PX = 9;
const TOP_OVERSCAN = Math.ceil((CAMERA_MAX + MAX_SHAKE_PX) / ROAD_TILE_SIZE) * ROAD_TILE_SIZE;

// Pool capacities — generous upper bounds derived from engine.ts's spawn
// timers/particle counts (VEHICLE_SPAWN_MIN_MS=550ms, OBSTACLE_SPAWN_MIN_MS=
// 1800ms, createParticles() caps at 20/crash with a 1s max life). Real
// concurrent counts stay well under these; if a count is ever exceeded the
// overflow entities are silently skipped for one frame rather than crashing.
const MAX_VEHICLES = 24;
const MAX_OBSTACLES = 12;
const MAX_POWERUPS = 6;
const MAX_PARTICLES = 60;

function hexagonPath(cx: number, cy: number, r: number, rotation: number): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + rotation;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    d += i === 0 ? `M ${x} ${y} ` : `L ${x} ${y} `;
  }
  return `${d}Z`;
}

// --- Pooled sprite rendering ---------------------------------------------
//
// Perf: GameCanvas used to hold a `[, setTick]` bumped on every engine tick
// (60x/sec) to force React/Skia to rebuild every obstacle/vehicle/powerup/
// particle `<Image>`/`<Circle>` from scratch each frame — first playtest on
// a real device rated the app 0.25/10, and this per-frame full-tree
// reconciliation was flagged as the leading suspect (PR review: "Per-frame
// react rendering overhead", never addressed; see WARBOSS_HIGHWAY_HANDOFF.md
// "Known Issues"). The road tile grid got a first-pass fix (build once,
// scroll with a transform); this is the rest of it.
//
// Fix: react-native-skia accepts a Reanimated SharedValue anywhere a prop
// is normally a plain value (`AnimatedProp<T> = T | { value: T }`, see
// node_modules/@shopify/react-native-skia's Animations.ts) — mutating
// `.value` updates the native draw command directly and never touches
// React's reconciler. So each entity type gets a fixed-size pool of
// stable, never-unmounted sprite slots; the engine's per-frame sync()
// callback below mutates each occupied slot's SharedValues in place
// instead of returning new JSX. React only re-renders a slot on the rare
// event its *image* changes (i.e. a new entity took over that slot) —
// SharedValue mutation for position/size/opacity every frame requires zero
// React re-renders at all.
//
// Slot assignment keys off object identity, not array index: engine.ts's
// update loop mutates entities in place and removes them via
// `array.splice(i, 1)` (never replaces/clones a live entity), so a
// `Map<entity, slotIndex>` survives splices of *other* entities correctly —
// no risk of a mid-array removal reassigning a slot to the wrong entity.

interface SpriteSlotHandle {
  set(x: number, y: number, width: number, height: number, opacity: number, image: SkImage | null, rotate: number): void;
  hide(): void;
}

const IDENTITY_TRANSFORM: { rotate: number }[] = [{ rotate: 0 }];

const SpriteSlot = React.memo(
  forwardRef<SpriteSlotHandle, { fit: 'fill' | 'contain' }>(function SpriteSlot({ fit }, ref) {
    const x = useSharedValue(0);
    const y = useSharedValue(0);
    const w = useSharedValue(0);
    const h = useSharedValue(0);
    const opacity = useSharedValue(0);
    // transform/origin are whole-object SharedValues (not derived from
    // x/y/w/h) so rotation always pivots on the entity's own center —
    // mutated together with x/y/w/h in `set()` below. Passing plain
    // `.value` reads into JSX here would freeze a one-time snapshot
    // instead of binding reactively; these must stay SharedValues end to
    // end.
    const transform = useSharedValue<{ rotate: number }[]>(IDENTITY_TRANSFORM);
    const origin = useSharedValue({ x: 0, y: 0 });
    const [image, setImage] = useState<SkImage | null>(null);
    const imageRef = useRef<SkImage | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        set(nx, ny, nw, nh, nOpacity, nImage, nRotate) {
          x.value = nx;
          y.value = ny;
          w.value = nw;
          h.value = nh;
          opacity.value = nOpacity;
          transform.value = nRotate === 0 ? IDENTITY_TRANSFORM : [{ rotate: nRotate }];
          origin.value = { x: nx + nw / 2, y: ny + nh / 2 };
          if (imageRef.current !== nImage) {
            imageRef.current = nImage;
            setImage(nImage);
          }
        },
        hide() {
          opacity.value = 0;
        },
      }),
      [x, y, w, h, opacity, transform, origin]
    );

    if (!image) return null;
    return (
      <Image image={image} x={x} y={y} width={w} height={h} opacity={opacity} fit={fit} transform={transform} origin={origin} />
    );
  })
);
SpriteSlot.displayName = 'SpriteSlot';

interface ParticleSlotHandle {
  set(x: number, y: number, r: number, opacity: number, color: string, blur: number): void;
  hide(): void;
}

const ParticleSlot = React.memo(
  forwardRef<ParticleSlotHandle, object>(function ParticleSlot(_props, ref) {
    const cx = useSharedValue(0);
    const cy = useSharedValue(0);
    const r = useSharedValue(0);
    const opacity = useSharedValue(0);
    const blur = useSharedValue(1);
    const [color, setColor] = useState<string | null>(null);
    const colorRef = useRef<string | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        set(nx, ny, nr, nOpacity, nColor, nBlur) {
          cx.value = nx;
          cy.value = ny;
          r.value = nr;
          opacity.value = nOpacity;
          blur.value = nBlur;
          if (colorRef.current !== nColor) {
            colorRef.current = nColor;
            setColor(nColor);
          }
        },
        hide() {
          opacity.value = 0;
        },
      }),
      [cx, cy, r, opacity, blur]
    );

    if (!color) return null;
    return (
      <Circle cx={cx} cy={cy} r={r} color={color} opacity={opacity}>
        <BlurMask blur={blur} style="normal" />
      </Circle>
    );
  })
);
ParticleSlot.displayName = 'ParticleSlot';

// Generic slot-assignment manager: hands out/reclaims pool slots by entity
// object identity so SpriteSlot/ParticleSlot's imperative handles get
// updated in place, entirely outside React's render cycle.
function usePool<T extends object>(capacity: number) {
  const handles = useRef<Array<React.RefObject<SpriteSlotHandle | ParticleSlotHandle | null>>>(
    Array.from({ length: capacity }, () => React.createRef())
  ).current;
  const assigned = useRef<Map<T, number>>(new Map()).current;
  const free = useRef<number[]>(Array.from({ length: capacity }, (_, i) => capacity - 1 - i)).current;

  function sync(entities: T[], apply: (handle: SpriteSlotHandle | ParticleSlotHandle, entity: T) => void) {
    const present = assigned;
    const stillPresent = new Set<T>();
    for (const entity of entities) {
      stillPresent.add(entity);
      let slot = present.get(entity);
      if (slot === undefined) {
        slot = free.pop();
        if (slot === undefined) continue; // pool exhausted — skip for this frame
        present.set(entity, slot);
      }
      const handle = handles[slot].current;
      if (handle) apply(handle, entity);
    }
    for (const [entity, slot] of present) {
      if (!stillPresent.has(entity)) {
        present.delete(entity);
        handles[slot].current?.hide();
        free.push(slot);
      }
    }
  }

  return { handles, sync };
}

// Phase 2 of the "native mobile rebuild" plan (now with the visual-parity
// pass that was originally deferred): proves the shared game-core
// simulation renders on native via react-native-skia, matching the web
// renderer's feedback effects — crash particles, shield ring, hit-flicker,
// screen shake, oil-slick glow, exhaust trail, player underglow — instead
// of just sprites moving around with no juice. Renders declaratively from
// getState()/cameraY each frame — react-native-skia's <Canvas> here is a
// React scene graph (unlike Pixi's imperative per-frame draw); per-frame
// updates flow through SharedValue mutation (see the pooled-sprite comment
// above), not a React re-render.
//
// Takes `engine` as a prop (owned by the screen — see useGameEngine.ts)
// instead of creating its own, so HudOverlay can share the same instance.
// `scale` fits the fixed 420x800 simulation into whatever area the screen
// actually measured (see app/(tabs)/index.tsx) — phones with a usable
// viewport narrower or shorter than 420x800 (smaller devices, or the tab
// bar/safe-area insets eating into it) would otherwise clip gameplay and
// the gesture surface, since the Canvas used to be hard-coded to that size
// regardless of the device.
export function GameCanvas({ engine, scale = 1 }: { engine: NativeGameEngine; scale?: number }) {
  const images = useSpriteImages();
  const [ready, setReady] = useState(false);

  // Perf: the tile grid's x/y positions never change relative to each
  // other — only the whole grid scrolls. Build the grid once (it only
  // depends on the road tile image loading), and scroll it via a
  // SharedValue-driven transform instead of rebuilding it every tick.
  const roadTiles = useMemo(() => (images.roadTile ? buildRoadGrid(images.roadTile) : null), [images.roadTile]);
  const roadTransform = useSharedValue<{ translateY: number }[]>([{ translateY: 0 }]);
  const groupTransform = useSharedValue<({ scale: number } | { translateX: number } | { translateY: number })[]>([
    { scale },
    { translateX: 0 },
    { translateY: 0 },
  ]);

  const vehiclePool = usePool<Vehicle>(MAX_VEHICLES);
  const obstaclePool = usePool<Obstacle>(MAX_OBSTACLES);
  const powerupPool = usePool<PowerUpItem>(MAX_POWERUPS);
  const particlePool = usePool<Particle>(MAX_PARTICLES);

  // Player + effects — a single instance each, so plain SharedValues
  // (no pooling needed) updated every tick without a React re-render.
  const playerX = useSharedValue(GAME_WIDTH / 2);
  const playerY = useSharedValue(GAME_HEIGHT * 0.75);
  const playerW = useSharedValue(0);
  const playerH = useSharedValue(0);
  const playerOpacity = useSharedValue(1);
  // Center point (not the image's top-left x/y) — needed separately for
  // the shield ring, which pivots on the player's center like the web
  // renderer's equivalent draw call.
  const playerCenterX = useSharedValue(GAME_WIDTH / 2);
  const playerCenterY = useSharedValue(GAME_HEIGHT * 0.75);
  const underglowCx = useSharedValue(GAME_WIDTH / 2);
  const underglowCy = useSharedValue(GAME_HEIGHT * 0.75);
  const underglowR = useSharedValue(0);
  const underglowCenter = useSharedValue({ x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.75 });
  const oilCx = useSharedValue(0);
  const oilCy = useSharedValue(0);
  const oilR = useSharedValue(0);
  const shieldHexPath = useSharedValue('');
  const shieldRingR = useSharedValue(28);
  // Exhaust plumes — each line's endpoints are single {x,y} SharedValues
  // (not decomposed x/y pairs) so both the <Line> and its <LinearGradient>
  // can bind the same reactive point object directly.
  const exhaustOpacity = useSharedValue(0);
  const exhaustLP1 = useSharedValue({ x: 0, y: 0 });
  const exhaustLP2 = useSharedValue({ x: 0, y: 0 });
  const exhaustRP1 = useSharedValue({ x: 0, y: 0 });
  const exhaustRP2 = useSharedValue({ x: 0, y: 0 });
  const exhaustCP1 = useSharedValue({ x: 0, y: 0 });
  const exhaustCP2 = useSharedValue({ x: 0, y: 0 });
  const exhaustBigP1 = useSharedValue({ x: 0, y: 0 });
  const exhaustBigP2 = useSharedValue({ x: 0, y: 0 });
  const exhaustCOpacity = useSharedValue(0);
  const exhaustBigOpacity = useSharedValue(0);
  const exhaustBigWidth = useSharedValue(0);

  // Low-frequency booleans — these gate whether whole subtrees mount at
  // all (shield ring, oil-slick glow), so they stay as real React state,
  // but only change on powerup pickup/expiry or oil-slick hit/wear-off,
  // not every frame.
  const [playerImg, setPlayerImg] = useState<SkImage | null>(null);
  const [shieldActive, setShieldActive] = useState(false);
  const [oilSlicked, setOilSlicked] = useState(false);
  const [exhaustHot, setExhaustHot] = useState(false);

  const playerImgRef = useRef<SkImage | null>(null);
  const carColorRef = useRef<string>('#ffffff');

  useEffect(() => {
    const renderer: GameRenderer = {
      sync(state: GameState, cameraY: number) {
        const now = performance.now();

        const shakeAmp = state.screenShake > 0 ? (state.screenShake / 300) * 9 : 0;
        const shakeX = shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0;
        const shakeY = shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0;
        groupTransform.value = [{ scale }, { translateX: shakeX }, { translateY: shakeY - cameraY }];
        roadTransform.value = [{ translateY: state.roadOffset % ROAD_TILE_SIZE }];

        vehiclePool.sync(state.vehicles, (handle, v) => {
          const img = vehicleImage(images, v.type, v.variant);
          (handle as SpriteSlotHandle).set(v.x - v.width / 2, v.y - v.height / 2, v.width, v.height, img ? 1 : 0, img, Math.PI);
        });
        obstaclePool.sync(state.obstacles, (handle, o) => {
          const img = o.type === 'OIL_SLICK' ? images.oilSlick : images.debris;
          (handle as SpriteSlotHandle).set(o.x - o.width / 2, o.y - o.height / 2, o.width, o.height, img ? 1 : 0, img, 0);
        });
        powerupPool.sync(state.powerups, (handle, p) => {
          const img = images.powerups[p.type];
          (handle as SpriteSlotHandle).set(p.x - p.width / 2, p.y - p.height / 2, p.width, p.height, img ? 1 : 0, img, 0);
        });
        particlePool.sync(state.particles, (handle, p) => {
          const life = Math.max(0, p.life / p.maxLife);
          (handle as ParticleSlotHandle).set(p.x, p.y, p.size * 1.2, life, p.color, p.size * 0.8);
        });

        const carColor = CAR_STATS[state.selectedCar].color;
        carColorRef.current = carColor;

        const flickerVisible = !state.player.isInvulnerable || Math.floor(now / 80) % 2 === 0;
        const invulnAlpha = state.player.isInvulnerable ? 0.7 + 0.3 * Math.sin(now * 0.03) : 1;
        playerX.value = state.player.x - state.player.width / 2;
        playerY.value = state.player.y - state.player.height / 2;
        playerW.value = state.player.width;
        playerH.value = state.player.height;
        playerOpacity.value = flickerVisible ? invulnAlpha : 0;
        playerCenterX.value = state.player.x;
        playerCenterY.value = state.player.y;

        const playerImage = images.playerCars[state.selectedCar];
        if (playerImgRef.current !== playerImage) {
          playerImgRef.current = playerImage;
          setPlayerImg(playerImage);
        }

        underglowCx.value = state.player.x;
        underglowCy.value = state.player.y + state.player.height * 0.35;
        underglowR.value = state.player.width * 1.4;
        underglowCenter.value = { x: state.player.x, y: state.player.y + state.player.height * 0.35 };

        if (state.player.oilSlicked !== oilSlicked) setOilSlicked(state.player.oilSlicked);
        if (state.player.oilSlicked) {
          oilCx.value = state.player.x;
          oilCy.value = state.player.y;
          oilR.value = Math.max(state.player.width, state.player.height) * 0.55;
        }

        const nowShieldActive = state.activePowerUp === 'SHIELD';
        if (nowShieldActive !== shieldActive) setShieldActive(nowShieldActive);
        if (nowShieldActive) {
          shieldHexPath.value = hexagonPath(state.player.x, state.player.y, 38, now * 0.0012);
          shieldRingR.value = 28 + (0.5 + 0.5 * Math.sin(now * 0.0012 * 4)) * 4;
        }

        const spd = state.speedMultiplier;
        const showExhaust = spd > 1.1;
        exhaustOpacity.value = showExhaust ? 1 : 0;
        if (showExhaust) {
          const px = state.player.x;
          const py = state.player.y + state.player.height / 2;
          const hw = state.player.width * 0.3;
          const len = spd * 22;
          exhaustLP1.value = { x: px - hw, y: py };
          exhaustLP2.value = { x: px - hw, y: py + len };
          exhaustRP1.value = { x: px + hw, y: py };
          exhaustRP2.value = { x: px + hw, y: py + len };
          exhaustCP1.value = { x: px, y: py };
          exhaustCP2.value = { x: px, y: py + len };
          exhaustCOpacity.value = spd >= 2.0 ? 1 : 0;
          const bigLen = len * 0.8;
          exhaustBigP1.value = { x: px, y: py };
          exhaustBigP2.value = { x: px, y: py + bigLen };
          exhaustBigOpacity.value = spd >= 2.5 ? 1 : 0;
          exhaustBigWidth.value = state.player.width * 0.7;
          const hot = spd >= 2.2;
          if (hot !== exhaustHot) setExhaustHot(hot);
        }

        if (!ready) setReady(true);
      },
      destroy() {},
    };

    engine.attachRenderer(renderer);
    return () => engine.attachRenderer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, images]);

  // Mirrors the web renderer's drag-to-steer (handleTouchStart/Move/End
  // in web-engine.ts) via GameEngine's DOM-agnostic pointerDown/Move/Up —
  // same input model, different wiring. Pan callbacks run as worklets on
  // the UI thread (Reanimated is installed), so calls into the engine
  // instance (plain JS, lives on the JS thread) go through runOnJS.
  // GestureDetector's view is sized to the on-screen (scaled) Canvas, so
  // its local x/y are in display space — divide by `scale` to land back in
  // the 420x800 logical space GameEngine expects.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          runOnJS(handlePointerDown)(e.x / scale, e.y / scale);
        })
        .onUpdate((e) => {
          runOnJS(handlePointerMove)(e.x / scale, e.y / scale);
        })
        .onEnd(() => {
          runOnJS(handlePointerUp)();
        }),
    [engine, scale]
  );

  function handlePointerDown(x: number, y: number) {
    engine.pointerDown(x, y);
  }
  function handlePointerMove(x: number, y: number) {
    engine.pointerMove(x, y);
  }
  function handlePointerUp() {
    engine.pointerUp();
  }

  const displayWidth = GAME_WIDTH * scale;
  const displayHeight = GAME_HEIGHT * scale;

  if (!ready) {
    return (
      <GestureDetector gesture={pan}>
        <Canvas style={{ width: displayWidth, height: displayHeight, backgroundColor: '#0c0c0e' }} />
      </GestureDetector>
    );
  }

  const carColor = carColorRef.current;

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width: displayWidth, height: displayHeight, backgroundColor: '#0c0c0e' }}>
        <Group transform={groupTransform}>
          {roadTiles && <Group transform={roadTransform}>{roadTiles}</Group>}

          {obstaclePool.handles.map((ref, i) => (
            <SpriteSlot key={`obstacle-${i}`} ref={ref as React.RefObject<SpriteSlotHandle>} fit="fill" />
          ))}

          {vehiclePool.handles.map((ref, i) => (
            <SpriteSlot key={`vehicle-${i}`} ref={ref as React.RefObject<SpriteSlotHandle>} fit="fill" />
          ))}

          {powerupPool.handles.map((ref, i) => (
            <SpriteSlot key={`powerup-${i}`} ref={ref as React.RefObject<SpriteSlotHandle>} fit="contain" />
          ))}

          {/* Exhaust trail — matches web drawExhaust()'s gradient plumes.
              Always mounted (4 static lines), driven by opacity — avoids
              re-mounting the subtree every time speedMultiplier crosses a
              threshold. Each line's endpoints are single {x,y} SharedValues
              bound directly to both the Line and its LinearGradient so
              updates never require a React re-render. */}
          <Group opacity={exhaustOpacity}>
            <Line p1={exhaustLP1} p2={exhaustLP2} style="stroke" strokeWidth={2.5} strokeCap="round">
              <LinearGradient start={exhaustLP1} end={exhaustLP2} colors={[exhaustHot ? 'rgba(255,90,10,0.6)' : 'rgba(180,190,200,0.4)', 'rgba(0,0,0,0)']} />
            </Line>
            <Line p1={exhaustRP1} p2={exhaustRP2} style="stroke" strokeWidth={2.5} strokeCap="round">
              <LinearGradient start={exhaustRP1} end={exhaustRP2} colors={[exhaustHot ? 'rgba(255,90,10,0.6)' : 'rgba(180,190,200,0.4)', 'rgba(0,0,0,0)']} />
            </Line>
            <Group opacity={exhaustCOpacity}>
              <Line p1={exhaustCP1} p2={exhaustCP2} style="stroke" strokeWidth={1.5} strokeCap="round">
                <LinearGradient start={exhaustCP1} end={exhaustCP2} colors={[exhaustHot ? 'rgba(255,90,10,0.6)' : 'rgba(180,190,200,0.4)', 'rgba(0,0,0,0)']} />
              </Line>
            </Group>
            <Group opacity={exhaustBigOpacity}>
              <Line p1={exhaustBigP1} p2={exhaustBigP2} style="stroke" strokeWidth={exhaustBigWidth} strokeCap="round">
                <LinearGradient start={exhaustBigP1} end={exhaustBigP2} colors={[carColor, 'rgba(0,0,0,0)']} />
              </Line>
            </Group>
          </Group>

          {/* Player underglow */}
          <Circle cx={underglowCx} cy={underglowCy} r={underglowR} opacity={0.33}>
            <RadialGradient c={underglowCenter} r={underglowR} colors={[carColor, 'rgba(0,0,0,0)']} />
          </Circle>

          {/* Player car */}
          {playerImg && (
            <Group opacity={playerOpacity}>
              {oilSlicked && (
                <Circle cx={oilCx} cy={oilCy} r={oilR} color="#8888ff" opacity={0.35}>
                  <BlurMask blur={14} style="normal" />
                </Circle>
              )}

              {shieldActive && (
                <Group>
                  <Path path={shieldHexPath} color="#00ffff" style="stroke" strokeWidth={2.5} opacity={0.9} />
                  <Circle cx={playerCenterX} cy={playerCenterY} r={shieldRingR} color="#00ffff" style="stroke" strokeWidth={1} opacity={0.5} />
                </Group>
              )}

              <Image image={playerImg} x={playerX} y={playerY} width={playerW} height={playerH} fit="fill" />
            </Group>
          )}

          {/* Crash/hit particles — glowing circles, matches web draw()'s
              radial-gradient particle rendering. */}
          {particlePool.handles.map((ref, i) => (
            <ParticleSlot key={`particle-${i}`} ref={ref as React.RefObject<ParticleSlotHandle>} />
          ))}
        </Group>
      </Canvas>
    </GestureDetector>
  );
}

// Simple full-tile repeat — the source image is pre-cropped by
// useSpriteImages()/cropCenterSquare() (see sprites.ts) to remove its
// vignette before it ever reaches here, so a plain repeat (stretched to
// each 80x80 destination cell via fit="fill") reads as continuous road
// instead of a visible grid.
//
// Perf: this used to be called inline every render with `roadOffset` baked
// into each tile's `y`, so the whole grid (cols * rows Image elements) was
// torn down and rebuilt by React/Skia's reconciler on every engine tick.
// The grid's tile positions don't actually depend on roadOffset — only the
// grid's position as a whole scrolls — so this now builds a static grid
// once (memoized on the road tile image loading) anchored at a fixed
// yStart, and the caller scrolls it with a single Group transform instead.
function buildRoadGrid(roadTile: NonNullable<ReturnType<typeof useSpriteImages>['roadTile']>) {
  const tiles: React.ReactNode[] = [];
  const cols = Math.ceil(GAME_WIDTH / ROAD_TILE_SIZE);
  const rows = Math.ceil((GAME_HEIGHT + TOP_OVERSCAN) / ROAD_TILE_SIZE) + 2;
  const yStart = -ROAD_TILE_SIZE - TOP_OVERSCAN;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push(
        <Image
          key={`road-${row}-${col}`}
          image={roadTile}
          x={col * ROAD_TILE_SIZE}
          y={yStart + row * ROAD_TILE_SIZE}
          width={ROAD_TILE_SIZE}
          height={ROAD_TILE_SIZE}
          fit="fill"
        />
      );
    }
  }
  return <>{tiles}</>;
}
