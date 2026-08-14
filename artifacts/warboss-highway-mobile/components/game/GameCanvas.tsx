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
  Paint,
  Path,
  RadialGradient,
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

// Split out from SpriteSlot (CodeRabbit catch) — hooks can't be called
// conditionally, so a SpriteSlot without `shadow` still had to instantiate
// these four useDerivedValue worklets, which Reanimated then recomputes on
// every x/y/w/h/opacity mutation even though obstacle/powerup slots never
// render one. Mounting this as its own child component means non-shadow
// slots never create the worklets at all.
function GroundShadow({
  x, y, w, h, opacity,
}: {
  x: ReturnType<typeof useSharedValue<number>>;
  y: ReturnType<typeof useSharedValue<number>>;
  w: ReturnType<typeof useSharedValue<number>>;
  h: ReturnType<typeof useSharedValue<number>>;
  opacity: ReturnType<typeof useSharedValue<number>>;
}) {
  // A soft dark ellipse anchored slightly below the sprite's center,
  // derived reactively from the same x/y/w/h SharedValues rather than
  // tracked separately, so it never needs its own imperative updates.
  const shadowCx = useDerivedValue(() => x.value + w.value / 2);
  const shadowCy = useDerivedValue(() => y.value + h.value * 0.62);
  const shadowR = useDerivedValue(() => Math.max(w.value, h.value) * 0.42);
  const shadowOpacity = useDerivedValue(() => opacity.value * 0.4);

  return (
    <Circle cx={shadowCx} cy={shadowCy} r={shadowR} color="#000000" opacity={shadowOpacity}>
      {/* respectCTM: without it the blur radius is a fixed device-pixel
          amount regardless of the canvas's own scale transform (see
          GameCanvas's `scale` prop, applied per-device via groupTransform)
          — CodeRabbit catch. */}
      <BlurMask blur={6} style="normal" respectCTM />
    </Circle>
  );
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
      <>
        {shadow && <GroundShadow x={x} y={y} w={w} h={h} opacity={opacity} />}
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

  // Perf: the tile grid's x/y positions never change relative to each
  // other — only the whole grid scrolls. Build the grid once (it only
  // depends on the road tile image loading), and scroll it via a
  // SharedValue-driven transform instead of rebuilding it every tick.
  const roadTiles = useMemo(() => (images.roadTile ? buildRoadGrid(images.roadTile) : null), [images.roadTile]);
  const neonRain = useMemo(() => buildNeonRain(), []);
  // Roadside guardrails — this asset (and lamp_post.png) sat in the sprite
  // pack fully rendered but completely unused: the road is full-bleed
  // (buildRoadGrid tiles edge-to-edge across GAME_WIDTH), so there was no
  // shoulder for roadside scenery. Rather than shrink the playable width
  // (that's GameEngine's lane math too — shared with the web renderer, not
  // worth the risk for a decorative pass), this overlays a tiled strip on
  // top of the outermost road tiles at each edge, scrolling in the same
  // transform group as the road so it reads as a road-edge barrier instead
  // of drifting independently.
  const guardrails = useMemo(() => (images.guardrail ? buildGuardrails(images.guardrail) : null), [images.guardrail]);
  // Lamp posts — same reasoning as guardrails (real, unused art, no natural
  // spawn point without touching shared lane math), but unlike the
  // guardrail segment this one isn't seamlessly tileable, so it can't just
  // repeat every row without looking like a fence. Sparsely spaced instead
  // (every LAMP_SPAN, alternating edges), with its own dedicated scroll
  // transform wrapped at LAMP_PERIOD instead of reusing roadTransform —
  // see the LAMP_PERIOD comment above for why.
  const lampPosts = useMemo(() => (images.lampPost ? buildLampPosts(images.lampPost) : null), [images.lampPost]);
  const roadTransform = useSharedValue<{ translateY: number }[]>([{ translateY: 0 }]);
  const lampTransform = useSharedValue<{ translateY: number }[]>([{ translateY: 0 }]);
  // One static rain geometry group is translated through SharedValues; weather
  // density increases for Rush without reconstructing the Skia scene graph.
  const rainTransform = useSharedValue<{ translateY: number }[]>([{ translateY: 0 }]);
  const rainOpacity = useSharedValue(0.16);
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
        roadTransform.value = [{ translateY: state.roadOffset % ROAD_TILE_SIZE }];
        lampTransform.value = [{ translateY: state.roadOffset % LAMP_PERIOD }];
        rainTransform.value = [{ translateY: state.roadOffset % 180 }];
        rainOpacity.value = state.rushTimer > 0 ? 0.28 : 0.16;

        vehiclePool.sync(state.vehicles, (handle, v) => {
          const img = vehicleImage(images, v.type, v.variant);
          // Oncoming traffic (lanes 0-1) faces the player, same-direction
          // traffic (lanes 2-3) faces away — matches the player's own
          // orientation, like real two-way traffic. See Vehicle.direction.
          const rotate = v.direction === 'OPPOSITE' ? Math.PI : 0;
          (handle as SpriteSlotHandle).set(v.x - v.width / 2, v.y - v.height / 2, v.width, v.height, img ? 1 : 0, img, rotate);
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
          (handle as ParticleSlotHandle).set(p.x, p.y, p.size * 1.2, life, p.color);
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
          explosionCx.value = state.player.x;
          explosionCy.value = state.player.y;
          explosionSize.value = Math.max(state.player.width, state.player.height) * 1.8 * (0.7 + t * 0.9);
        } else {
          explosionOpacity.value = 0;
        }

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
        playerOrigin.value = { x: state.player.x, y: state.player.y };
        playerTransform.value = state.driveTilt === 0 ? IDENTITY_TRANSFORM : [{ rotate: state.driveTilt * 0.14 }];
        rushCx.value = state.player.x;
        rushCy.value = state.player.y + state.player.height * 0.24;
        rushCenter.value = { x: state.player.x, y: state.player.y + state.player.height * 0.24 };
        rushR.value = Math.max(state.player.width, state.player.height) * (0.95 + (state.rushPulse / 420) * 0.4);
        rushOpacity.value = state.rushTimer > 0 ? 0.78 : 0;

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
          // Was a fixed 38/28 regardless of car size — looked roughly
          // right for a mid-size car but wildly oversized on the narrow
          // ones (PHANTOM's 16px-wide body inside a 76px hexagon). Scaled
          // to the player's own dimensions instead, matching the ratio
          // the web Pixi renderer already used correctly (maxDim * 0.75).
          const shieldR = Math.max(state.player.width, state.player.height);
          shieldHexPath.value = hexagonPath(state.player.x, state.player.y, shieldR * 0.62, now * 0.0012);
          shieldRingR.value = shieldR * 0.45 + (0.5 + 0.5 * Math.sin(now * 0.0012 * 4)) * (shieldR * 0.065);
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

          smokeCx.value = px;
          smokeCy.value = py + len * 0.5;
          smokeSize.value = state.player.width * 0.9 + len * 0.4;
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
          {roadTiles && (
            <Group transform={roadTransform} layer={<Paint><ColorMatrix matrix={ROAD_BOOST} /></Paint>}>
              {roadTiles}
            </Group>
          )}
          {guardrails && (
            <Group transform={roadTransform} layer={<Paint><ColorMatrix matrix={ROADSIDE_BOOST} /></Paint>}>
              {guardrails}
            </Group>
          )}
          {lampPosts && (
            <Group transform={lampTransform} layer={<Paint><ColorMatrix matrix={ROADSIDE_BOOST} /></Paint>}>
              {lampPosts}
            </Group>
          )}
          <Group transform={rainTransform} opacity={rainOpacity}>
            {neonRain}
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

// Static rain streak geometry. Only its parent transform and opacity change
// through SharedValues, so weather stays outside React's frame loop.
function buildNeonRain() {
  const streaks: React.ReactNode[] = [];
  for (let i = 0; i < 28; i++) {
    const x = 10 + ((i * 73) % (GAME_WIDTH - 20));
    const y = -150 + ((i * 109) % (GAME_HEIGHT + 180));
    const length = 12 + (i % 5) * 6;
    streaks.push(
      <Line
        key={`neon-rain-${i}`}
        p1={{ x, y }}
        p2={{ x: x - 2, y: y + length }}
        color={i % 4 === 0 ? 'rgba(185,233,255,0.85)' : 'rgba(105,185,225,0.62)'}
        style="stroke"
        strokeWidth={i % 3 === 0 ? 1.1 : 0.65}
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
