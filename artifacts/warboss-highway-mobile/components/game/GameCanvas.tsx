import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  BlendColor,
  BlurMask,
  Canvas,
  Circle,
  ColorMatrix,
  DashPathEffect,
  Group,
  Image,
  Line,
  LinearGradient,
  Oval,
  Paint,
  Path,
  RadialGradient,
  Rect,
  type SkImage,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { CAR_STATS, type GameRenderer, type GameState, type Obstacle, type Particle, type PowerUpItem, type Vehicle } from '@workspace/game-core';
import type { NativeGameEngine } from './native-engine';
import { useSpriteImages, vehicleImage } from './sprites';

// Matches the web app's internal game resolution (see
// artifacts/warboss-highway/src/pages/Game.tsx's canvas width/height) so
// GameEngine's lane math produces the same layout on both platforms.
export const GAME_WIDTH = 420;
export const GAME_HEIGHT = 800;
// Was 80 — real playtesting called the asphalt texture too subtle/hard to
// make out at that repeat size; bigger tiles mean more of the source
// texture's own grain/crack detail is visible per tile instead of being
// downsampled away.
const ROAD_TILE_SIZE = 110;
// Must match the web Pixi projection closely enough that both platforms share
// the same elevated-deck silhouette. This is presentation-only: GameEngine
// retains flat-world positions, collision, and lane math.
const HORIZON_FRACTION = 0.135;
const HORIZON_Y = GAME_HEIGHT * HORIZON_FRACTION;
const DEPTH_K = 2.8;
const PLAYER_T = 0.8;
const NATIVE_RAW_ZERO = 1 / (1 + DEPTH_K);
const NATIVE_RAW_PLAYER = 1 / (1 + DEPTH_K * (1 - PLAYER_T));
const DECK_SHOULDER_WIDTH = 26;
const DECK_POST_PERIOD = 160;
const GUARDRAIL_WIDTH = 24;
const LAMP_WIDTH = 34;
const LAMP_HEIGHT = 70;
const LAMP_SPAN = 6 * ROAD_TILE_SIZE; // 480px between same-side posts
// Road/guardrail tiles repeat every ROAD_TILE_SIZE (80px) and are visually
// uniform, so scrolling the static grid by `roadOffset % ROAD_TILE_SIZE`
// (a tiny, bounded oscillation) is indistinguishable from true infinite
// scroll — you can't tell tile N from tile N+1. Lamp posts break that
// trick: they're sparse, identical-looking objects with visible gaps of
// bare road between them, so reusing the road's 80px modulo would just
// make each post jitter in place within an 80px band forever instead of
// travelling down the screen. They need their own transform, wrapped at
// their own *pair* period (one left + one right post) so the wrap doesn't
// visibly swap a post's side mid-scroll.
const LAMP_PERIOD = 2 * LAMP_SPAN; // 960px
const EXPLOSION_FLASH_MS = 400;
// A prior pass addressed "cars look tiny vs. the road" with a render-only
// VISUAL_SCALE multiplier (visual size inflated past the actual collision
// hitbox). Superseded (2026-08-03) by properly upsizing CAR_STATS/spawn
// dimensions in engine.ts itself and narrowing lanes from 3 to 4 — real
// hitbox and rendered size now match again, no separate multiplier needed.
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

// Visual fix (2026-08-02): a real device/emulator playtest showed the road
// reading as near-flat black (grid seams barely visible, no lane markers)
// and traffic sprites blending into it (correct art, but too dim/desaturated
// to read as threats at a glance — the whole point of a dodge game). Rather
// than re-author the source PNGs (shared with the web renderer — recoloring
// them risks visual divergence across platforms), boost contrast/brightness
// at draw time via a Skia ColorMatrix, the same standard contrast/brightness
// transform used by CSS filters: output = (input - 0.5) * contrast + 0.5 +
// brightness, applied per RGB channel, alpha untouched.
function contrastBrightnessMatrix(contrast: number, brightness: number): number[] {
  const t = (1 - contrast) / 2 + brightness;
  return [
    contrast, 0, 0, 0, t,
    0, contrast, 0, 0, t,
    0, 0, contrast, 0, t,
    0, 0, 0, 1, 0,
  ];
}
// Contrast raised further (was 1.3/0.05) — real playtesting still called
// the asphalt too flat/hard to make out even with the first boost pass.
const ROAD_BOOST = contrastBrightnessMatrix(1.55, 0.08);
const VEHICLE_BOOST = contrastBrightnessMatrix(1.2, 0.12);
// Guardrails/lamp posts had no boost at all — dark art on a dark road
// with nothing pushing it forward, easy to miss entirely at a glance.
const ROADSIDE_BOOST = contrastBrightnessMatrix(1.4, 0.14);

interface NativeProjectedPoint {
  x: number;
  y: number;
  scale: number;
  alpha: number;
}

function nativeProjectionRaw(worldY: number): number {
  return 1 / (1 + DEPTH_K * (1 - worldY / GAME_HEIGHT));
}

// Shared simulation uses a flat top-down world; this maps it into the same
// low chase-camera presentation as the web Pixi renderer. It must never be
// used for collision or input hit testing.
function projectNativeGround(worldX: number, worldY: number): NativeProjectedPoint {
  const clampedY = Math.max(0, Math.min(GAME_HEIGHT, worldY));
  const raw = nativeProjectionRaw(clampedY);
  const scale = raw / NATIVE_RAW_PLAYER;
  const screenY = HORIZON_Y + (GAME_HEIGHT - HORIZON_Y) * ((raw - NATIVE_RAW_ZERO) / (1 - NATIVE_RAW_ZERO));
  return {
    x: GAME_WIDTH / 2 + (worldX - GAME_WIDTH / 2) * scale,
    y: screenY,
    scale,
    alpha: worldY >= 0 ? 1 : Math.max(0, 1 + worldY / 180),
  };
}

interface NativeGroundedPlacement {
  centerX: number;
  centerY: number;
  contactY: number;
  width: number;
  height: number;
  scale: number;
  opacity: number;
}

// A car's contact row is the midpoint of its lower edge, not its simulation
// center. Build all visual placement from that contact row so each sprite and
// its shadow sit on the projected deck rather than floating above it.
function groundedNativePlacement(worldX: number, worldY: number, width: number, height: number, fixedScale?: number): NativeGroundedPlacement {
  const contact = projectNativeGround(worldX, worldY + height / 2);
  // Geometry belongs to the lower-edge contact row, but a sprite must still
  // fade according to its original simulation row as it enters over horizon.
  // Otherwise the half-height contact offset causes incoming traffic to appear
  // fully opaque too early.
  const entry = projectNativeGround(worldX, worldY);
  const scale = fixedScale ?? contact.scale;
  const visualWidth = width * scale;
  const visualHeight = height * scale;
  return {
    centerX: contact.x,
    centerY: contact.y - visualHeight / 2,
    contactY: contact.y,
    width: visualWidth,
    height: visualHeight,
    scale,
    opacity: entry.alpha,
  };
}

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

type NumberSharedValue = ReturnType<typeof useSharedValue<number>>;

interface NativeBillboardGeometry {
  color: string;
  panelX: number;
  panelY: number;
  panelW: number;
  panelH: number;
  reflectionX: number;
  reflectionY: number;
  reflectionW: number;
  reflectionH: number;
}

// Fixed projected geometry plus SharedValue opacity updates keeps the native
// atmosphere local and inexpensive: no timer-owned React state, no blur pass,
// no particle allocation, and no per-frame JSX reconstruction.
const NATIVE_LIGHTNING_MAIN = `M 302 6 L 269 ${HORIZON_Y * 0.26} L 298 ${HORIZON_Y * 0.48} L 256 ${HORIZON_Y * 0.88}`;
const NATIVE_LIGHTNING_ECHO = `M 139 ${HORIZON_Y * 0.12} L 160 ${HORIZON_Y * 0.43} L 130 ${HORIZON_Y * 0.7}`;
const NATIVE_LIGHTNING_ROAD_FLASH = `M ${GAME_WIDTH / 2 - 6} ${HORIZON_Y} L ${GAME_WIDTH / 2 + 6} ${HORIZON_Y} L ${GAME_WIDTH + 26} ${GAME_HEIGHT} L -26 ${GAME_HEIGHT} Z`;

const NATIVE_BILLBOARDS: NativeBillboardGeometry[] = ([
  { worldY: 155, side: -1, color: '#df4bff' },
  { worldY: 285, side: 1, color: '#27d9ff' },
  { worldY: 430, side: -1, color: '#ffb347' },
] as const).map(({ worldY, side, color }) => {
  const p = projectNativeGround(GAME_WIDTH / 2, worldY);
  const edge = GAME_WIDTH / 2 + side * (GAME_WIDTH / 2) * p.scale;
  const panelW = Math.max(14, 42 * p.scale);
  const panelH = Math.max(7, 18 * p.scale);
  const panelX = edge + side * (DECK_SHOULDER_WIDTH * p.scale + panelW * 0.62);
  const panelY = p.y - panelH * 1.35;
  const reflectedWorldY = Math.min(GAME_HEIGHT - 6, worldY + 120);
  const reflection = projectNativeGround(GAME_WIDTH / 2 + side * (GAME_WIDTH / 2) * p.scale * 0.52, reflectedWorldY);
  const reflectionW = Math.max(8, panelW * 0.72 * (reflection.scale / p.scale));
  const reflectionH = Math.max(3, panelH * 0.34 * (reflection.scale / p.scale));
  return { color, panelX, panelY, panelW, panelH, reflectionX: reflection.x, reflectionY: reflection.y, reflectionW, reflectionH };
});

function NativeLightning({ opacity }: { opacity: NumberSharedValue }) {
  return (
    <Group opacity={opacity}>
      <Rect x={0} y={0} width={GAME_WIDTH} height={HORIZON_Y + 34} color="#eaf7ff" opacity={0.12} />
      <Path path={NATIVE_LIGHTNING_ROAD_FLASH} color="#eaf7ff" opacity={0.045} />
      <Path path={NATIVE_LIGHTNING_MAIN} color="#eaf7ff" style="stroke" strokeWidth={1.5} opacity={0.82} />
      <Path path={NATIVE_LIGHTNING_ECHO} color="#27d9ff" style="stroke" strokeWidth={1} opacity={0.42} />
    </Group>
  );
}

function NativeBillboardReflections({ opacities }: { opacities: [NumberSharedValue, NumberSharedValue, NumberSharedValue] }) {
  return (
    <>
      {NATIVE_BILLBOARDS.map((board, index) => (
        <Group key={`${board.color}-${index}`} opacity={opacities[index]}>
          <Rect x={board.panelX - board.panelW / 2} y={board.panelY - board.panelH / 2} width={board.panelW} height={board.panelH} color="#10172a" opacity={0.92} />
          <Rect x={board.panelX - board.panelW * 0.38} y={board.panelY - board.panelH * 0.23} width={board.panelW * 0.76} height={Math.max(1, board.panelH * 0.18)} color={board.color} opacity={0.8} />
          <Rect x={board.panelX - board.panelW * 0.38} y={board.panelY + board.panelH * 0.12} width={board.panelW * 0.45} height={Math.max(1, board.panelH * 0.12)} color={board.color} opacity={0.42} />
          <Rect x={board.panelX - board.panelW / 2} y={board.panelY - board.panelH / 2} width={board.panelW} height={board.panelH} color={board.color} style="stroke" strokeWidth={Math.max(0.7, 1.4 * (board.panelW / 42))} opacity={0.68} />
          <Rect x={board.reflectionX - board.reflectionW / 2} y={board.reflectionY - board.reflectionH / 2} width={board.reflectionW} height={board.reflectionH} color={board.color} opacity={0.19} />
          <Rect x={board.reflectionX - board.reflectionW * 0.28} y={board.reflectionY + board.reflectionH * 0.9} width={board.reflectionW * 0.56} height={Math.max(1, board.reflectionH * 0.55)} color={board.color} opacity={0.075} />
        </Group>
      ))}
    </>
  );
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
  set(x: number, y: number, width: number, height: number, opacity: number, image: SkImage | null, rotate: number, contactY?: number): void;
  hide(): void;
}

const IDENTITY_TRANSFORM: { rotate: number }[] = [{ rotate: 0 }];

// Split out from SpriteSlot (CodeRabbit catch) — hooks can't be called
// conditionally, so a SpriteSlot without `shadow` still had to instantiate
// these four useDerivedValue worklets, which Reanimated then recomputes on
// every x/y/w/h/opacity mutation even though obstacle/powerup slots never
// render one. Mounting this as its own child component means non-shadow
// slots never create the worklets at all.
function GroundShadow({
  x, w, h, contactY, opacity,
}: {
  x: ReturnType<typeof useSharedValue<number>>;
  w: ReturnType<typeof useSharedValue<number>>;
  h: ReturnType<typeof useSharedValue<number>>;
  contactY: ReturnType<typeof useSharedValue<number>>;
  opacity: ReturnType<typeof useSharedValue<number>>;
}) {
  // A narrow ellipse follows the projected wheel-contact row. The geometry is
  // derived from slot SharedValues, so grounding updates stay outside React's
  // reconciliation path and do not affect generic power-up/obstacle slots.
  const shadowRect = useDerivedValue(() => ({
    x: x.value + w.value * 0.08,
    y: contactY.value - h.value * 0.125,
    width: w.value * 0.84,
    height: Math.max(1.5, h.value * 0.18),
  }));
  const shadowOpacity = useDerivedValue(() => opacity.value * 0.52);

  return <Oval rect={shadowRect} color="#000000" opacity={shadowOpacity} />;
}

const SpriteSlot = React.memo(
  forwardRef<SpriteSlotHandle, { fit: 'fill' | 'contain'; boost?: number[]; shadow?: boolean }>(function SpriteSlot(
    { fit, boost, shadow },
    ref
  ) {
    const x = useSharedValue(0);
    const y = useSharedValue(0);
    const w = useSharedValue(0);
    const h = useSharedValue(0);
    const opacity = useSharedValue(0);
    const contactY = useSharedValue(0);
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
        set(nx, ny, nw, nh, nOpacity, nImage, nRotate, nContactY) {
          x.value = nx;
          y.value = ny;
          w.value = nw;
          h.value = nh;
          opacity.value = nOpacity;
          contactY.value = nContactY ?? ny + nh;
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
      [x, y, w, h, opacity, contactY, transform, origin]
    );

    if (!image) return null;
    return (
      <>
        {shadow && <GroundShadow x={x} w={w} h={h} contactY={contactY} opacity={opacity} />}
        <Image image={image} x={x} y={y} width={w} height={h} opacity={opacity} fit={fit} transform={transform} origin={origin}>
          {boost && <ColorMatrix matrix={boost} />}
        </Image>
      </>
    );
  })
);
SpriteSlot.displayName = 'SpriteSlot';

interface ParticleSlotHandle {
  set(x: number, y: number, r: number, opacity: number, color: string): void;
  hide(): void;
}

// Renders spark.png tinted per-particle via BlendColor('srcIn') instead of
// a generated circle+BlurMask — the art is white/neutral specifically so
// it can be recolored this way (per the sprite-pack generation brief) and
// already bakes in its own soft radial falloff, so no BlurMask is needed
// on top of it.
const ParticleSlot = React.memo(
  forwardRef<ParticleSlotHandle, { sparkImage: SkImage | null }>(function ParticleSlot({ sparkImage }, ref) {
    const cx = useSharedValue(0);
    const cy = useSharedValue(0);
    const r = useSharedValue(0);
    const opacity = useSharedValue(0);
    const [color, setColor] = useState<string | null>(null);
    const colorRef = useRef<string | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        set(nx, ny, nr, nOpacity, nColor) {
          cx.value = nx;
          cy.value = ny;
          r.value = nr;
          opacity.value = nOpacity;
          if (colorRef.current !== nColor) {
            colorRef.current = nColor;
            setColor(nColor);
          }
        },
        hide() {
          opacity.value = 0;
        },
      }),
      [cx, cy, r, opacity]
    );

    const x = useDerivedValue(() => cx.value - r.value);
    const y = useDerivedValue(() => cy.value - r.value);
    const size = useDerivedValue(() => r.value * 2);

    if (!color || !sparkImage) return null;
    return (
      <Image image={sparkImage} x={x} y={y} width={size} height={size} opacity={opacity}>
        <BlendColor color={color} mode="srcIn" />
      </Image>
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
//
// Rendering behavior (road/vehicle contrast boosts, lane dividers,
// guardrails/lamp posts, particle art) is documented inline at each
// effect's own definition below rather than in a separate doc — see
// WARBOSS_HIGHWAY_HANDOFF.md's "Key Files Reference" for where this file
// sits in the overall architecture.
export function GameCanvas({ engine, scale = 1 }: { engine: NativeGameEngine; scale?: number }) {
  const images = useSpriteImages();
  const [ready, setReady] = useState(false);

  // The native scene mirrors the web Pixi projection with static Skia geometry.
  // Deck, void, puddles, and rain are all built once; the frame loop mutates only
  // a few parent transforms/opacities instead of reconstructing JSX.
  const elevatedDeck = useMemo(() => buildElevatedDeck(), []);
  const puddleReflections = useMemo(() => buildPuddleReflections(), []);
  const farRain = useMemo(() => buildNeonRain('far'), []);
  const foregroundRain = useMemo(() => buildNeonRain('foreground'), []);
  const puddleTransform = useSharedValue<{ translateY: number }[]>([{ translateY: 0 }]);
  const farRainTransform = useSharedValue<{ translateY: number }[]>([{ translateY: 0 }]);
  const foregroundRainTransform = useSharedValue<{ translateY: number }[]>([{ translateY: 0 }]);
  const puddleOpacity = useSharedValue(0.58);
  const farRainOpacity = useSharedValue(0.14);
  const foregroundRainOpacity = useSharedValue(0.1);
  // Atmospheric pulses are one scalar per fixed scene element. This prevents
  // timer-owned React state and keeps the native visual path bounded.
  const lightningOpacity = useSharedValue(0);
  const billboardOpacity0 = useSharedValue(0.48);
  const billboardOpacity1 = useSharedValue(0.48);
  const billboardOpacity2 = useSharedValue(0.48);
  const billboardOpacities: [NumberSharedValue, NumberSharedValue, NumberSharedValue] = [
    billboardOpacity0,
    billboardOpacity1,
    billboardOpacity2,
  ];
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
  const playerTransform = useSharedValue<{ rotate: number }[]>(IDENTITY_TRANSFORM);
  const playerOrigin = useSharedValue({ x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.75 });
  // Center point (not the image's top-left x/y) — needed separately for
  // the shield ring, which pivots on the player's center like the web
  // renderer's equivalent draw call.
  const playerCenterX = useSharedValue(GAME_WIDTH / 2);
  const playerCenterY = useSharedValue(GAME_HEIGHT * 0.75);
  const underglowCx = useSharedValue(GAME_WIDTH / 2);
  const underglowCy = useSharedValue(GAME_HEIGHT * 0.75);
  const underglowR = useSharedValue(0);
  const underglowCenter = useSharedValue({ x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.75 });
  const rushCx = useSharedValue(GAME_WIDTH / 2);
  const rushCy = useSharedValue(GAME_HEIGHT * 0.75);
  const rushR = useSharedValue(0);
  const rushOpacity = useSharedValue(0);
  const rushCenter = useSharedValue({ x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.75 });
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
  // Speed streaks — mirrors the web Pixi renderer's MotionBlurFilter
  // (velocity = speedMultiplier * 4, quality:'high' only) for a sense of
  // velocity at top speed. The web path only runs the blur on 'high'
  // quality; this Skia equivalent is a few faint radial-ish streaks that
  // fade in as speedMultiplier climbs past 2.5 (the same threshold the
  // exhaust's "big" plume uses), giving the mobile build the same
  // high-speed rush without a per-frame blur pass. Drawn as thin vertical
  // lines at fixed-ish x positions, opacity-bound to a SharedValue so no
  // React re-render happens.
  const streakOpacity = useSharedValue(0);
  const streakL1 = useSharedValue({ x: 0, y: 0 });
  const streakL2 = useSharedValue({ x: 0, y: 0 });
  const streakR1 = useSharedValue({ x: 0, y: 0 });
  const streakR2 = useSharedValue({ x: 0, y: 0 });
  const streakL1y2 = useSharedValue(0);
  const streakL2y2 = useSharedValue(0);
  const streakR1y2 = useSharedValue(0);
  const streakR2y2 = useSharedValue(0);
  // smoke.png overlay, layered behind the existing gradient-line plumes
  // rather than replacing them — the lines already read well and carry the
  // speed-tier color escalation, this just adds the real particle art
  // (previously unused on both platforms) as a soft puff at the plume
  // base instead of reworking the whole effect around a sprite.
  const smokeCx = useSharedValue(0);
  const smokeCy = useSharedValue(0);
  const smokeSize = useSharedValue(0);
  const smokeOpacity = useSharedValue(0);
  // One-shot crash flash (explosion.png) — triggered off a rising edge in
  // state.screenShake (set to 300 in engine.ts's handleCrash()) rather
  // than a dedicated GameState field, so it needs no game-core changes.
  // The armor-save near-miss path creates particles but never sets
  // screenShake, so this correctly skips that case.
  const explosionCx = useSharedValue(0);
  const explosionCy = useSharedValue(0);
  const explosionSize = useSharedValue(0);
  const explosionOpacity = useSharedValue(0);
  const prevScreenShakeRef = useRef(0);
  const explosionUntilRef = useRef(0);
  const smokeX = useDerivedValue(() => smokeCx.value - smokeSize.value / 2);
  const smokeY = useDerivedValue(() => smokeCy.value - smokeSize.value / 2);
  const explosionX = useDerivedValue(() => explosionCx.value - explosionSize.value / 2);
  const explosionY = useDerivedValue(() => explosionCy.value - explosionSize.value / 2);
  const streakL1Y2 = useDerivedValue(() => ({ x: streakL1.value.x, y: streakL1y2.value }));
  const streakL2Y2 = useDerivedValue(() => ({ x: streakL2.value.x, y: streakL2y2.value }));
  const streakR1Y2 = useDerivedValue(() => ({ x: streakR1.value.x, y: streakR1y2.value }));
  const streakR2Y2 = useDerivedValue(() => ({ x: streakR2.value.x, y: streakR2y2.value }));

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
        // Static deck geometry is projected at build time; bounded transforms give
        // puddles and weather motion without rebuilding the Skia scene graph.
        puddleTransform.value = [{ translateY: state.roadOffset % 140 }];
        farRainTransform.value = [{ translateY: state.roadOffset % 180 }];
        foregroundRainTransform.value = [{ translateY: state.roadOffset % 280 }];
        puddleOpacity.value = state.rushTimer > 0 ? 0.78 : 0.58;
        farRainOpacity.value = state.rushTimer > 0 ? 0.2 : 0.14;
        foregroundRainOpacity.value = state.rushTimer > 0 ? 0.2 : 0.1;

        // Deterministic distance-driven weather cadence mirrors the web path:
        // sparse lightning and individually flickering board light, without
        // any change to shared world state, collision, or scoring.
        const strikePhase = state.distance % 3200;
        const mainFlash = strikePhase < 38 ? 1 - strikePhase / 38 : 0;
        const echoFlash = strikePhase > 110 && strikePhase < 125 ? ((125 - strikePhase) / 15) * 0.42 : 0;
        const lightning = Math.max(mainFlash, echoFlash);
        const pulse = 0.52 + 0.48 * Math.sin(state.distance * 0.024);
        const flicker = (state.distance % 530) < 74 ? 0.45 : 0;
        lightningOpacity.value = lightning;
        billboardOpacity0.value = Math.min(1, Math.max(0.14, pulse * (0.72 + 0.28 * Math.sin(state.distance * 0.013)) + flicker * 0.55) + lightning * 0.4);
        billboardOpacity1.value = Math.min(1, Math.max(0.14, pulse * (0.72 + 0.28 * Math.sin(state.distance * 0.013 + 1.7)) + flicker * 0.55) + lightning * 0.4);
        billboardOpacity2.value = Math.min(1, Math.max(0.14, pulse * (0.72 + 0.28 * Math.sin(state.distance * 0.013 + 3.4)) + flicker * 0.55) + lightning * 0.4);

        vehiclePool.sync(state.vehicles, (handle, v) => {
          const img = vehicleImage(images, v.type, v.variant);
          const placed = groundedNativePlacement(v.x, v.y, v.width, v.height);
          // Oncoming traffic (lanes 0-1) faces the player, same-direction
          // traffic (lanes 2-3) faces away — matches the player's own
          // orientation, like real two-way traffic. See Vehicle.direction.
          const rotate = v.direction === 'OPPOSITE' ? Math.PI : 0;
          (handle as SpriteSlotHandle).set(
            placed.centerX - placed.width / 2,
            placed.centerY - placed.height / 2,
            placed.width,
            placed.height,
            img ? placed.opacity : 0,
            img,
            rotate,
            placed.contactY,
          );
        });
        obstaclePool.sync(state.obstacles, (handle, o) => {
          const img = o.type === 'OIL_SLICK' ? images.oilSlick : images.debris;
          const placed = groundedNativePlacement(o.x, o.y, o.width, o.height);
          (handle as SpriteSlotHandle).set(
            placed.centerX - placed.width / 2,
            placed.centerY - placed.height / 2,
            placed.width,
            placed.height,
            img ? placed.opacity : 0,
            img,
            0,
          );
        });
        powerupPool.sync(state.powerups, (handle, p) => {
          const img = images.powerups[p.type];
          const placed = groundedNativePlacement(p.x, p.y, p.width, p.height);
          (handle as SpriteSlotHandle).set(
            placed.centerX - placed.width / 2,
            placed.centerY - placed.height / 2,
            placed.width,
            placed.height,
            img ? placed.opacity : 0,
            img,
            0,
          );
        });
        particlePool.sync(state.particles, (handle, p) => {
          const life = Math.max(0, p.life / p.maxLife);
          const placed = projectNativeGround(p.x, p.y);
          (handle as ParticleSlotHandle).set(placed.x, placed.y, p.size * placed.scale * 1.2, life * placed.alpha, p.color);
        });

        // Crash flash — see the explosionCx/Cy/Size/Opacity declaration
        // comment above for why this keys off screenShake instead of a
        // dedicated field.
        if (state.screenShake > prevScreenShakeRef.current) {
          explosionUntilRef.current = now + EXPLOSION_FLASH_MS;
        }
        prevScreenShakeRef.current = state.screenShake;
        const explosionRemaining = explosionUntilRef.current - now;
        if (explosionRemaining > 0) {
          const t = 1 - explosionRemaining / EXPLOSION_FLASH_MS;
          explosionOpacity.value = 1 - t;
          const crashPlaced = groundedNativePlacement(state.player.x, state.player.y, state.player.width, state.player.height, 1);
          explosionCx.value = crashPlaced.centerX;
          explosionCy.value = crashPlaced.centerY;
          explosionSize.value = Math.max(crashPlaced.width, crashPlaced.height) * 1.8 * (0.7 + t * 0.9);
        } else {
          explosionOpacity.value = 0;
        }

        const carColor = CAR_STATS[state.selectedCar].color;
        carColorRef.current = carColor;
        // Keep the player’s familiar unit scale but set its baseline by the
        // same projected wheel-contact row as traffic. Simulation positions and
        // hitboxes remain untouched; this is visual placement only.
        const playerPlaced = groundedNativePlacement(
          state.player.x,
          state.player.y,
          state.player.width,
          state.player.height,
          1,
        );

        const flickerVisible = !state.player.isInvulnerable || Math.floor(now / 80) % 2 === 0;
        const invulnAlpha = state.player.isInvulnerable ? 0.7 + 0.3 * Math.sin(now * 0.03) : 1;
        playerX.value = playerPlaced.centerX - playerPlaced.width / 2;
        playerY.value = playerPlaced.centerY - playerPlaced.height / 2;
        playerW.value = playerPlaced.width;
        playerH.value = playerPlaced.height;
        playerOpacity.value = flickerVisible ? invulnAlpha : 0;
        playerCenterX.value = playerPlaced.centerX;
        playerCenterY.value = playerPlaced.centerY;
        playerOrigin.value = { x: playerPlaced.centerX, y: playerPlaced.centerY };
        playerTransform.value = state.driveTilt === 0 ? IDENTITY_TRANSFORM : [{ rotate: state.driveTilt * 0.14 }];
        rushCx.value = playerPlaced.centerX;
        rushCy.value = playerPlaced.contactY - playerPlaced.height * 0.16;
        rushCenter.value = { x: playerPlaced.centerX, y: playerPlaced.contactY - playerPlaced.height * 0.16 };
        rushR.value = Math.max(playerPlaced.width, playerPlaced.height) * (0.95 + (state.rushPulse / 420) * 0.4);
        rushOpacity.value = state.rushTimer > 0 ? 0.78 : 0;

        const playerImage = images.playerCars[state.selectedCar];
        if (playerImgRef.current !== playerImage) {
          playerImgRef.current = playerImage;
          setPlayerImg(playerImage);
        }

        underglowCx.value = playerPlaced.centerX;
        underglowCy.value = playerPlaced.contactY - playerPlaced.height * 0.12;
        underglowR.value = playerPlaced.width * 1.4;
        underglowCenter.value = { x: playerPlaced.centerX, y: playerPlaced.contactY - playerPlaced.height * 0.12 };

        if (state.player.oilSlicked !== oilSlicked) setOilSlicked(state.player.oilSlicked);
        if (state.player.oilSlicked) {
          oilCx.value = playerPlaced.centerX;
          oilCy.value = playerPlaced.centerY;
          oilR.value = Math.max(playerPlaced.width, playerPlaced.height) * 0.55;
        }

        const nowShieldActive = state.activePowerUp === 'SHIELD';
        if (nowShieldActive !== shieldActive) setShieldActive(nowShieldActive);
        if (nowShieldActive) {
          // Was a fixed 38/28 regardless of car size — looked roughly
          // right for a mid-size car but wildly oversized on the narrow
          // ones (PHANTOM's 16px-wide body inside a 76px hexagon). Scaled
          // to the player's own dimensions instead, matching the ratio
          // the web Pixi renderer already used correctly (maxDim * 0.75).
          const shieldR = Math.max(playerPlaced.width, playerPlaced.height);
          shieldHexPath.value = hexagonPath(playerPlaced.centerX, playerPlaced.centerY, shieldR * 0.62, now * 0.0012);
          shieldRingR.value = shieldR * 0.45 + (0.5 + 0.5 * Math.sin(now * 0.0012 * 4)) * (shieldR * 0.065);
        }

        const spd = state.speedMultiplier;
        const showExhaust = spd > 1.1;
        exhaustOpacity.value = showExhaust ? 1 : 0;
        if (showExhaust) {
          const px = playerPlaced.centerX;
          const py = playerPlaced.contactY;
          const hw = playerPlaced.width * 0.3;
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
          exhaustBigWidth.value = playerPlaced.width * 0.7;
          const hot = spd >= 2.2;
          if (hot !== exhaustHot) setExhaustHot(hot);

          smokeCx.value = px;
          smokeCy.value = py + len * 0.5;
          smokeSize.value = playerPlaced.width * 0.9 + len * 0.4;
          smokeOpacity.value = 0.3 + Math.min(0.3, spd * 0.08);
        } else {
          smokeOpacity.value = 0;
        }

        // Speed streaks — fade in past the same 2.5 threshold the exhaust's
        // "big" plume uses, so the high-speed rush matches the web build's
        // MotionBlur. Streaks sit just inside each road edge and span the
        // viewport, anchored to the player's lane band.
        const streakAmt = spd >= 2.5 ? Math.min(1, (spd - 2.5) / 0.5) : 0;
        streakOpacity.value = streakAmt * 0.5;
        if (streakAmt > 0) {
          const top = state.player.y - GAME_HEIGHT * 0.55;
          const bottom = state.player.y + GAME_HEIGHT * 0.45;
          streakL1.value = { x: GUARDRAIL_WIDTH + 18, y: top };
          streakL2.value = { x: GUARDRAIL_WIDTH + 40, y: top };
          streakR1.value = { x: GAME_WIDTH - GUARDRAIL_WIDTH - 18, y: top };
          streakR2.value = { x: GAME_WIDTH - GUARDRAIL_WIDTH - 40, y: top };
          streakL1y2.value = bottom;
          streakL2y2.value = bottom;
          streakR1y2.value = bottom;
          streakR2y2.value = bottom;
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
          {/* Elevated bridge, city void, and fixed rails build the native
              low-chase-camera composition. Gameplay coordinates remain flat
              and entities are projected independently below. */}
          {elevatedDeck}

          {/* Lightning and roadside boards are fixed projected geometry driven
              by four opacity SharedValues. They stay behind traffic, player,
              and HUD readability cues without a full-frame visual effect. */}
          <NativeLightning opacity={lightningOpacity} />
          <NativeBillboardReflections opacities={billboardOpacities} />

          {/* Wet-light reflections are a small static set translated through a
              parent SharedValue. They imply moving puddles without allocating
              a particle system or a blur pass on every device frame. */}
          <Group transform={puddleTransform} opacity={puddleOpacity}>
            {puddleReflections}
          </Group>

          {/* Far rain creates city depth; foreground rain becomes denser during
              Rush. Both are memoized geometry controlled only by transforms. */}
          <Group transform={farRainTransform} opacity={farRainOpacity}>
            {farRain}
          </Group>
          <Group transform={foregroundRainTransform} opacity={foregroundRainOpacity}>
            {foregroundRain}
          </Group>

          {obstaclePool.handles.map((ref, i) => (
            <SpriteSlot key={`obstacle-${i}`} ref={ref as React.RefObject<SpriteSlotHandle>} fit="fill" />
          ))}

          {vehiclePool.handles.map((ref, i) => (
            <SpriteSlot key={`vehicle-${i}`} ref={ref as React.RefObject<SpriteSlotHandle>} fit="fill" boost={VEHICLE_BOOST} shadow />
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
            {images.smoke && (
              <Image image={images.smoke} x={smokeX} y={smokeY} width={smokeSize} height={smokeSize} opacity={smokeOpacity}>
                <BlendColor color={exhaustHot ? '#ffaa33' : '#b4bec8'} mode="srcIn" />
              </Image>
            )}
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

          {/* Speed streaks — parity with web Pixi MotionBlur at high speed. */}
          <Group opacity={streakOpacity}>
            <Line p1={streakL1} p2={streakL1Y2} style="stroke" strokeWidth={2} strokeCap="round" color="rgba(180,210,255,0.6)" />
            <Line p1={streakL2} p2={streakL2Y2} style="stroke" strokeWidth={1.5} strokeCap="round" color="rgba(180,210,255,0.4)" />
            <Line p1={streakR1} p2={streakR1Y2} style="stroke" strokeWidth={2} strokeCap="round" color="rgba(180,210,255,0.6)" />
            <Line p1={streakR2} p2={streakR2Y2} style="stroke" strokeWidth={1.5} strokeCap="round" color="rgba(180,210,255,0.4)" />
          </Group>

          {/* Player underglow */}
          <Circle cx={underglowCx} cy={underglowCy} r={underglowR} opacity={0.33}>
            <RadialGradient c={underglowCenter} r={underglowR} colors={[carColor, 'rgba(0,0,0,0)']} />
          </Circle>

          {/* Rush uses a cyan/magenta ring rather than a generic speed blur,
              preserving the special moment while staying legible at high speed. */}
          <Group opacity={rushOpacity}>
            <Circle cx={rushCx} cy={rushCy} r={rushR} color="#27d9ff" opacity={0.16}>
              <RadialGradient c={rushCenter} r={rushR} colors={["rgba(39,217,255,0.5)", "rgba(0,0,0,0)"]} />
            </Circle>
            <Circle cx={rushCx} cy={rushCy} r={rushR} color="#df4bff" style="stroke" strokeWidth={2} opacity={0.75}>
              <BlurMask blur={3} style="normal" respectCTM />
            </Circle>
          </Group>

          {/* Crash flash — see the explosionCx/Cy/Size/Opacity declaration
              comment above for the screenShake-rising-edge trigger. */}
          {images.explosion && (
            <Image image={images.explosion} x={explosionX} y={explosionY} width={explosionSize} height={explosionSize} opacity={explosionOpacity} fit="contain" />
          )}

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
                  <Path path={shieldHexPath} color="#00ffff" style="stroke" strokeWidth={2.5} opacity={0.9}>
                    <BlurMask blur={3} style="normal" respectCTM />
                  </Path>
                  <Circle cx={playerCenterX} cy={playerCenterY} r={shieldRingR} color="#00ffff" style="stroke" strokeWidth={1} opacity={0.5}>
                    <BlurMask blur={3} style="normal" respectCTM />
                  </Circle>
                </Group>
              )}

              <Image image={playerImg} x={playerX} y={playerY} width={playerW} height={playerH} fit="fill" transform={playerTransform} origin={playerOrigin} />
            </Group>
          )}

          {/* Crash/hit particles — glowing circles, matches web draw()'s
              radial-gradient particle rendering. */}
          {particlePool.handles.map((ref, i) => (
            <ParticleSlot key={`particle-${i}`} ref={ref as React.RefObject<ParticleSlotHandle>} sparkImage={images.spark} />
          ))}
        </Group>
      </Canvas>
    </GestureDetector>
  );
}

function nativeHalfWidthAt(worldY: number): number {
  return (GAME_WIDTH / 2) * (nativeProjectionRaw(Math.max(0, Math.min(GAME_HEIGHT, worldY))) / NATIVE_RAW_PLAYER);
}

function trapezoidPath(topLeft: number, topRight: number, bottomRight: number, bottomLeft: number, topY = HORIZON_Y, bottomY = GAME_HEIGHT): string {
  return `M ${topLeft} ${topY} L ${topRight} ${topY} L ${bottomRight} ${bottomY} L ${bottomLeft} ${bottomY} Z`;
}

// The native bridge is static draw geometry. The same low-horizon projection as
// the web renderer creates the elevated highway without forcing GameEngine or
// touch coordinates away from their shared flat-world contract.
function buildElevatedDeck() {
  const nodes: React.ReactNode[] = [];
  const centerX = GAME_WIDTH / 2;
  const horizonScale = NATIVE_RAW_ZERO / NATIVE_RAW_PLAYER;
  const bottomScale = 1 / NATIVE_RAW_PLAYER;
  const halfTop = (GAME_WIDTH / 2) * horizonScale;
  const halfBottom = (GAME_WIDTH / 2) * bottomScale;
  const shoulderTop = DECK_SHOULDER_WIDTH * horizonScale;
  const shoulderBottom = DECK_SHOULDER_WIDTH * bottomScale;

  // Rain-lit night sky and the low city haze under the HUD horizon.
  nodes.push(
    <Rect key="native-sky" x={0} y={0} width={GAME_WIDTH} height={HORIZON_Y}>
      <LinearGradient
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: HORIZON_Y }}
        colors={["#020814", "#0a1930", "#123150"]}
      />
    </Rect>
  );
  nodes.push(<Rect key="native-horizon-haze" x={0} y={HORIZON_Y - 4} width={GAME_WIDTH} height={42} color="rgba(64,164,212,0.16)" />);

  for (const side of [-1, 1]) {
    const deckTop = centerX + side * (halfTop + shoulderTop);
    const deckBottom = centerX + side * (halfBottom + shoulderBottom);
    const screenEdge = side < 0 ? 0 : GAME_WIDTH;
    const voidPath = side < 0
      ? trapezoidPath(screenEdge, deckTop, deckBottom, screenEdge)
      : trapezoidPath(deckTop, screenEdge, screenEdge, deckBottom);
    nodes.push(<Path key={`city-void-${side}`} path={voidPath} color="#020711" />);

    // Sparse industrial silhouettes keep the bridge suspended over a city
    // without the mobile cost of full-resolution scene backgrounds.
    for (let i = 0; i < 9; i++) {
      const worldY = i * DECK_POST_PERIOD + 40;
      const projected = projectNativeGround(centerX, worldY);
      const railX = centerX + side * (nativeHalfWidthAt(worldY) + DECK_SHOULDER_WIDTH * projected.scale);
      const buildingW = (14 + (i % 3) * 7) * projected.scale;
      const buildingH = (34 + (i % 4) * 15) * projected.scale;
      const buildingX = side < 0 ? railX - buildingW * 2.5 : railX + buildingW * 1.5;
      const buildingY = projected.y - buildingH * (0.78 + (i % 2) * 0.18);
      nodes.push(<Rect key={`void-building-${side}-${i}`} x={buildingX} y={buildingY} width={buildingW} height={buildingH} color={i % 2 === 0 ? "#07111f" : "#0b1727"} opacity={0.86} />);
      if (i % 2 === 0) {
        nodes.push(<Rect key={`void-window-${side}-${i}`} x={buildingX + buildingW * 0.28} y={buildingY + buildingH * 0.32} width={Math.max(0.7, buildingW * 0.18)} height={Math.max(0.8, buildingH * 0.08)} color="rgba(39,217,255,0.32)" />);
      }
    }
  }

  // Projected asphalt deck and restrained depth bands communicate wet material
  // while preserving a dark surface behind hazards.
  nodes.push(<Path key="native-deck-asphalt" path={trapezoidPath(centerX - halfTop, centerX + halfTop, centerX + halfBottom, centerX - halfBottom)} color="#202b3e" />);
  for (let i = 0; i < 12; i++) {
    const t0 = i / 12;
    const t1 = (i + 1) / 12;
    const y0 = HORIZON_Y + (GAME_HEIGHT - HORIZON_Y) * t0;
    const y1 = HORIZON_Y + (GAME_HEIGHT - HORIZON_Y) * t1;
    const hw0 = halfTop + (halfBottom - halfTop) * t0;
    const hw1 = halfTop + (halfBottom - halfTop) * t1;
    nodes.push(<Path key={`native-road-band-${i}`} path={`M ${centerX - hw0} ${y0} L ${centerX + hw0} ${y0} L ${centerX + hw1} ${y1} L ${centerX - hw1} ${y1} Z`} color="#050917" opacity={0.26 * (1 - t0) * (1 - t0)} />);
  }

  // Cyan lane edges, muted outer lips, and metal rail cores establish the
  // elevated deck silhouette. The rails intentionally grow off-screen near the
  // player, as they do in the visual reference.
  for (const side of [-1, 1]) {
    const roadTop = centerX + side * halfTop;
    const roadBottom = centerX + side * halfBottom;
    const railTop = roadTop + side * shoulderTop;
    const railBottom = roadBottom + side * shoulderBottom;
    const outerTop = railTop + side * Math.max(2, 7 * horizonScale);
    const outerBottom = railBottom + side * Math.max(5, 11 * bottomScale);
    nodes.push(<Line key={`deck-core-${side}`} p1={{ x: railTop, y: HORIZON_Y }} p2={{ x: railBottom, y: GAME_HEIGHT }} color="#172742" style="stroke" strokeWidth={Math.max(1.1, 4.5 * bottomScale)} />);
    nodes.push(<Line key={`deck-edge-${side}`} p1={{ x: roadTop, y: HORIZON_Y }} p2={{ x: roadBottom, y: GAME_HEIGHT }} color="rgba(39,217,255,0.82)" style="stroke" strokeWidth={Math.max(0.8, 2.2 * bottomScale)} />);
    nodes.push(<Line key={`deck-lip-${side}`} p1={{ x: outerTop, y: HORIZON_Y }} p2={{ x: outerBottom, y: GAME_HEIGHT }} color="rgba(223,75,255,0.34)" style="stroke" strokeWidth={Math.max(0.6, 1.35 * bottomScale)} />);

    for (let i = 0; i < 9; i++) {
      const worldY = i * DECK_POST_PERIOD + 20;
      const p = projectNativeGround(centerX, worldY);
      const railX = centerX + side * (nativeHalfWidthAt(worldY) + DECK_SHOULDER_WIDTH * p.scale);
      const postH = Math.max(4, 34 * p.scale);
      const postW = Math.max(1, 4.5 * p.scale);
      const braceOut = side * Math.max(4, 20 * p.scale);
      nodes.push(<Rect key={`deck-post-${side}-${i}`} x={railX - postW / 2} y={p.y - postH} width={postW} height={postH} color="#172742" opacity={0.98} />);
      nodes.push(<Line key={`deck-brace-${side}-${i}`} p1={{ x: railX, y: p.y - postH * 0.78 }} p2={{ x: railX + braceOut, y: p.y }} color="rgba(60,98,139,0.88)" style="stroke" strokeWidth={Math.max(0.7, 1.5 * p.scale)} />);
      nodes.push(<Circle key={`deck-light-${side}-${i}`} cx={railX} cy={p.y - postH * 0.86} r={Math.max(0.9, 3.2 * p.scale)} color="rgba(255,179,71,0.88)" />);
    }
  }

  // Lane separators remain aligned to the shared four-lane world model but now
  // converge at the horizon, matching the web deck and keeping traffic readable.
  for (const laneFraction of [0.25, 0.75]) {
    const topX = centerX + (laneFraction * GAME_WIDTH - centerX) * horizonScale;
    const bottomX = centerX + (laneFraction * GAME_WIDTH - centerX) * bottomScale;
    nodes.push(<Line key={`native-lane-${laneFraction}`} p1={{ x: topX, y: HORIZON_Y }} p2={{ x: bottomX, y: GAME_HEIGHT }} color="rgba(39,217,255,0.34)" style="stroke" strokeWidth={Math.max(0.7, 2 * bottomScale)}><DashPathEffect intervals={[18, 14]} /></Line>);
  }
  for (const offset of [-3, 3]) {
    nodes.push(<Line key={`native-center-${offset}`} p1={{ x: centerX + offset * horizonScale, y: HORIZON_Y }} p2={{ x: centerX + offset * bottomScale, y: GAME_HEIGHT }} color="rgba(255,179,71,0.78)" style="stroke" strokeWidth={Math.max(0.8, 2.3 * bottomScale)} />);
  }

  return <>{nodes}</>;
}

// Wet-road reflections use a handful of projected, repeated strips rather than
// full-screen blur. Parent translation makes them flow below lights while the
// static allocation keeps the mobile render path predictable.
function buildPuddleReflections() {
  const strips: React.ReactNode[] = [];
  const colors = ['rgba(39,217,255,0.34)', 'rgba(255,179,71,0.26)', 'rgba(223,75,255,0.25)'];
  const laneXs = [GAME_WIDTH * 0.16, GAME_WIDTH * 0.37, GAME_WIDTH * 0.63, GAME_WIDTH * 0.84];
  for (let i = 0; i < 12; i++) {
    const worldY = 28 + i * 80;
    const x = laneXs[i % laneXs.length];
    const p = projectNativeGround(x, worldY);
    const next = projectNativeGround(x, Math.min(GAME_HEIGHT, worldY + 38 + (i % 3) * 14));
    const width = Math.max(4, (13 + (i % 3) * 6) * p.scale);
    const left = p.x - width / 2;
    const right = p.x + width / 2;
    const nextWidth = width * 0.68;
    strips.push(<Path key={`puddle-${i}`} path={`M ${left} ${p.y} L ${right} ${p.y} L ${next.x + nextWidth / 2} ${next.y} L ${next.x - nextWidth / 2} ${next.y} Z`} color={colors[i % colors.length]} />);
  }
  return <>{strips}</>;
}

// Two static rain fields establish depth without a particle lifecycle. Only the
// parent transforms and opacities change through SharedValues during play.
function buildNeonRain(layer: 'far' | 'foreground') {
  const streaks: React.ReactNode[] = [];
  const far = layer === 'far';
  const count = far ? 20 : 18;
  const yRange = GAME_HEIGHT + (far ? 180 : 300);
  for (let i = 0; i < count; i++) {
    const x = 8 + ((i * (far ? 71 : 97)) % (GAME_WIDTH - 16));
    const y = -(far ? 110 : 210) + ((i * (far ? 109 : 83)) % yRange);
    const length = (far ? 7 : 18) + (i % 5) * (far ? 2 : 5);
    streaks.push(
      <Line
        key={`neon-rain-${layer}-${i}`}
        p1={{ x, y }}
        p2={{ x: x - (far ? 1 : 3), y: y + length }}
        color={i % 4 === 0 ? 'rgba(185,233,255,0.88)' : far ? 'rgba(105,185,225,0.54)' : 'rgba(126,207,255,0.66)'}
        style="stroke"
        strokeWidth={far ? 0.6 : i % 3 === 0 ? 1.1 : 0.75}
        strokeCap="round"
      />
    );
  }
  return <>{streaks}</>;
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

  // Lane markings — matches engine.ts's 4-lane math (`this.width / 4`)
  // exactly so dividers line up with where vehicles actually spawn/
  // travel. Lanes 0-1 (oncoming) and 2-3 (same direction) are each
  // dashed white internally (ordinary lane splits), but the boundary
  // between lane 1 and 2 is the direction divide — drawn as a solid
  // double-yellow center line, like a real two-way road, instead of
  // reading as just another dashed lane split.
  const laneWidth = GAME_WIDTH / 4;
  const gridHeight = rows * ROAD_TILE_SIZE;
  for (const divX of [laneWidth, laneWidth * 3]) {
    tiles.push(
          <Line
            key={`lane-divider-${divX}`}
            p1={{ x: divX, y: yStart }}
            p2={{ x: divX, y: yStart + gridHeight }}
            color="rgba(39,217,255,0.24)"
        style="stroke"
        strokeWidth={2}
      >
        <DashPathEffect intervals={[18, 14]} />
      </Line>
    );
  }
  const centerX = laneWidth * 2;
  for (const offset of [-2.5, 2.5]) {
    tiles.push(
      <Line
        key={`center-divide-${offset}`}
        p1={{ x: centerX + offset, y: yStart }}
        p2={{ x: centerX + offset, y: yStart + gridHeight }}
        color="rgba(255,179,71,0.72)"
        style="stroke"
        strokeWidth={2.5}
      />
    );
  }

  return <>{tiles}</>;
}

// Left/right road-edge barrier — same scroll grid math as buildRoadGrid
// (identical yStart/rows so the two stay pixel-locked to each other while
// scrolling), just narrower columns pinned to the two edges instead of
// filling the width.
function buildGuardrails(guardrail: SkImage) {
  const rails: React.ReactNode[] = [];
  const rows = Math.ceil((GAME_HEIGHT + TOP_OVERSCAN) / ROAD_TILE_SIZE) + 2;
  const yStart = -ROAD_TILE_SIZE - TOP_OVERSCAN;

  for (let row = 0; row < rows; row++) {
    const y = yStart + row * ROAD_TILE_SIZE;
    rails.push(
      <Image key={`guardrail-l-${row}`} image={guardrail} x={0} y={y} width={GUARDRAIL_WIDTH} height={ROAD_TILE_SIZE} fit="fill" />
    );
    rails.push(
      <Image
        key={`guardrail-r-${row}`}
        image={guardrail}
        x={GAME_WIDTH - GUARDRAIL_WIDTH}
        y={y}
        width={GUARDRAIL_WIDTH}
        height={ROAD_TILE_SIZE}
        fit="fill"
      />
    );
  }

  return <>{rails}</>;
}

// Sparse roadside lamp posts, alternating left/right every LAMP_SPAN.
// Unlike buildRoadGrid/buildGuardrails, this can't reuse the road's own
// row range/transform — since lampTransform wraps at the much larger
// LAMP_PERIOD (960px, not the road's 80px tile), the static grid has to
// extend a full LAMP_PERIOD beyond the viewport on both ends, or the wrap
// would expose empty space above/below.
function buildLampPosts(lampPost: SkImage) {
  const posts: React.ReactNode[] = [];
  const yStart = -LAMP_PERIOD;
  const rows = Math.ceil((GAME_HEIGHT + 2 * LAMP_PERIOD) / LAMP_SPAN) + 1;

  for (let row = 0; row < rows; row++) {
    const y = yStart + row * LAMP_SPAN;
    const onLeft = row % 2 === 0;
    posts.push(
      <Image
        key={`lamp-${row}`}
        image={lampPost}
        x={onLeft ? 0 : GAME_WIDTH - LAMP_WIDTH}
        y={y}
        width={LAMP_WIDTH}
        height={LAMP_HEIGHT}
        fit="fill"
      />
    );
  }

  return <>{posts}</>;
}
