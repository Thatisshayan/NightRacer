# UI Design + Motion Audit — Warboss Highway frontend — 2026-07-25

Agent: Claude (Sonnet 5)
Scope: `artifacts/warboss-highway/src` — visual design system, animation, gaming UI feel
Skills applied: `ultimate-frontend-design`, `ui-animation`, `using-superpowers`
Status: audit only (no code changes) — findings + prioritized recommendations

## Method
Read the full custom UI surface: `App.tsx`, `pages/Game.tsx`, `pages/Leaderboard.tsx`,
`components/game-over-overlay.tsx`, `lib/game/renderer.ts` (canvas HUD/obstacle/vehicle
draw calls), `lib/game/engine.ts` (juice mechanics: screen shake, combo, level-up flash),
`index.css` (design tokens), `components/ui/button.tsx` (shared primitive). Confirmed via
grep: `framer-motion` is a workspace catalog dependency but has **zero imports** anywhere
in `artifacts/warboss-highway/src` — it's declared, paid for in the bundle, and unused.

## What's already good (don't regress this)
- The **canvas gameplay loop** already has real juice: `engine.ts` implements screen
  shake (`state.screenShake`, decays over 300ms), a level-up flash overlay, a near-miss
  combo counter with fade-based alpha (`comboTimer / 800`), and invulnerability flicker
  (`Math.floor(performance.now()/100) % 2`). This is genuinely well-built arcade feedback
  — the gap is everywhere *outside* the canvas, not inside it.
- The grim-dark visual identity (flat `--radius: 0rem`, blood-red primary, mono
  typography, scanline-adjacent HUD styling) is a coherent, deliberate art direction.
  Recommendations below work *within* this identity, not against it.

## Findings (highest impact first)

### 1. Screen transitions are hard cuts, violating "continuity over teleportation"
`pages/Game.tsx:141-282` — `title` → `playing` → `gameover` are conditionally rendered
`{screen === 'x' && <div>...</div>}` blocks with no transition at all. The canvas itself
is `hidden`/`block` toggled by a class (`Game.tsx:158`), and the title/game-over overlays
just appear/disappear in the same frame. Per the ui-animation skill: *"Never hard-cut
between views that share components; hard cuts lose spatial context."* Right now the
moment of death (arguably the single most emotionally important beat in an endless
dodge game) has zero transition — the canvas just vanishes and a black overlay slams in.
- **Fix**: wrap the three screens in `AnimatePresence` (framer-motion is already
  installed) with a fast opacity+scale cross-fade (150-200ms, `cubic-bezier(0.22,1,0.36,1)`
  enter curve). Game-over should emerge *from* the crash moment, not replace it instantly
  — e.g. freeze-frame the canvas (draw the last frame to a `<canvas>`→`toDataURL` still,
  or just leave the canvas painted) and fade the overlay in on top rather than hiding it.

### 2. Score, combo, and hit feedback have no motion at the DOM/HUD-chrome layer
The in-canvas HUD (`renderer.ts:drawHUD`) draws score/combo as static `fillText` calls
redrawn every frame — there's no "pop" when score increments, no scale/color flash when
a combo milestone hits, no impact frame on collision beyond the existing screen shake.
Canvas text can't use CSS transitions, but it *can* be juiced procedurally: scale the
score text briefly on large jumps (track previous score, lerp a scale multiplier back to
1 over ~150ms), flash the combo text with a quick color pulse on each increment instead
of only fading out on decay. This is cheap (a few more state fields in `GameState`,
same pattern already used for `screenShake`/`levelUpFlash`) and is where "juice" reads
most directly to a player's eye.

### 3. Buttons have zero tactile/press feedback
`components/ui/button.tsx:6-8` — `transition-colors` only (`hover-elevate
active-elevate-2` change background/shadow, not transform). Per ui-animation defaults,
button press feedback should be 100-160ms with the enter curve
(`cubic-bezier(0.22,1,0.36,1)`) and typically includes a subtle `scale(0.97)` on
`:active`. Right now START ENGINE (`Game.tsx:244-250`), SUBMIT TO KILL-BOARD
(`game-over-overlay.tsx:239-245`), and every nav button feel static under the thumb —
for a mobile-first arcade game, tap feedback is not optional polish, it's core feel.
- **Fix**: add `active:scale-[0.97] transition-transform` (composited, cheap) to
  `buttonVariants` base classes, on top of the existing color transition.

### 4. Title screen has no entrance choreography
`Game.tsx:162-252` — logo, streak badge, car grid, PB line, daily toggle, and the CTA
button all mount simultaneously with no stagger. Per the ui-animation skill's stagger
rule (30-50ms/item, most-important element leads, total under 300ms), this is a prime
spot for a title stagger: logo first, then car grid, then CTA — reinforces hierarchy and
makes the title screen feel considered instead of instant-paint. Currently the biggest
visual moment in the app (first thing every player sees, every single session) gets the
least motion investment of any screen.

### 5. Car selection has no feedback beyond a border-color swap
`Game.tsx:187-214` — selecting a car (`isSelected`) only toggles border color + glow
shadow + `CarPreview` opacity (`60%→100%`). There's no scale-pop on selection, no
directional slide when swapping between the 3 cars, and the car preview canvas
(`CarPreview`, `Game.tsx:41-63`) is a static single-frame render — no idle animation
(e.g. subtle bob/rotation) to signal "this is a vehicle," not a static icon.

### 6. Game-over → leaderboard is a route change with no shared-element continuity
`game-over-overlay.tsx:118-130` — on successful score submit, `setLocation('/leaderboard')`
performs a full route swap. The score the player just achieved doesn't visually carry
over into its position in the table (no highlight/scroll-to-row, no shared-element
transition from the "FINAL SCORE" stat to its leaderboard row). This is the game's one
moment of payoff/bragging-rights and it currently dead-ends into an unrelated page load.
- **Fix (scoped)**: at minimum, highlight/scroll to the submitted score's row in
  `Leaderboard.tsx` on arrival (pass score id via route state or query param). Full
  shared-element (`layoutId`) treatment is a stretch goal given wouter's routing model.

### 7. `--radius: 0rem` + flat HSL palette works for the brutalist look, but the type
system has no fluid scale
`index.css:70-148` — colors are hand-picked flat HSL triples (not perceptually uniform
OKLCH per the ultimate-frontend-design skill's color-science guidance), and there's no
`clamp()`-based fluid type scale — font sizes are hardcoded Tailwind classes throughout
(`text-5xl`, `text-[10px]`, `text-[8px]`, `text-[7px]` in `Game.tsx:202-210` alone). Four
different near-illegible micro sizes stacked in the car-select card is a readability risk
on real phone screens, not just a design-system nit. Recommend consolidating to 2-3
sizes with `clamp()` so it scales with viewport instead of needing four fixed steps.

### 8. Loading/empty states are plain text, no shimmer/skeleton
`Leaderboard.tsx:119-124` (`"DECRYPTING DATA..."`) and stat cards
(`Leaderboard.tsx:61-77`, literal `'...'` string while loading) — shadcn's `Skeleton`
component is already vendored (`components/ui/skeleton.tsx`) but unused here. A themed
skeleton (or even simple scanline-shimmer matching the grim-dark aesthetic) would read
far more polished than a static ellipsis string, especially since these are exactly the
network-dependent surfaces most likely to show a loading state in practice.

### 9. No `prefers-reduced-motion` path anywhere
Neither the CSS (`index.css`) nor the canvas engine (`engine.ts`'s `screenShake`,
`levelUpFlash`) checks `matchMedia('(prefers-reduced-motion: reduce)')`. Per the
ui-animation skill this is mandatory, not optional — screen shake in particular is a
known motion-sickness trigger and currently has no opt-out. Cheap fix: read the media
query once at engine construction and scale `screenShake`'s magnitude to 0 (keep the hit
*registering* via a flash/color cue instead) when reduced motion is requested.

### 10. `framer-motion` is a paid-for, unused dependency
Confirmed zero imports across `artifacts/warboss-highway/src`. Either use it (recommended
— items 1, 4, 6 above are exactly what it's for) or drop it from
`artifacts/warboss-highway/package.json` to stop shipping unused bytes. Given how much
of this audit's recommendations are motion work, using it is the better call.

## Suggested priority order (impact vs. effort)
1. **#3 button press feedback** — one CVA class change, affects every button in the app.
2. **#9 reduced-motion guard** — accessibility, small diff, should ship before any of the
   other motion work below so new animations inherit the guard from day one.
3. **#1 screen transition cross-fade** — biggest perceived-quality jump for the effort;
   AnimatePresence + opacity/scale on 3 screens.
4. **#2 HUD score/combo pop** — the "juice" everyone will actually feel while playing.
5. **#4 title stagger** and **#5 car-select feedback** — same session, both touch
   `Game.tsx`'s title-screen JSX.
6. **#8 skeleton loading states** — cheap, `Skeleton` component already exists.
7. **#6 leaderboard row highlight** and **#7 type-scale/OKLCH cleanup** — larger, more
   design-system-level changes; worth a dedicated pass rather than bundling in.
8. **#10** — resolved as a side effect of #1/#4/#6 once framer-motion is actually used.

Not implemented in this pass — this is an audit deliverable per the user's request.
Happy to implement any subset (recommend starting with 1-4) in a follow-up commit.
