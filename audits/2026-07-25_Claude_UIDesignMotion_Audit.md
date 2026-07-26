# UI Design + Motion Audit — Warboss Highway frontend — 2026-07-25

Agent: Claude (Sonnet 5)
Scope: `artifacts/warboss-highway/src` — visual design system, animation, gaming UI feel
Skills applied: `ultimate-frontend-design`, `ui-animation`, `using-superpowers`
Status: **audit findings below implemented in a follow-up pass (2026-07-26, PR #3)** —
see "Implementation status" section at the bottom for what actually shipped, what's
partial, and what was deliberately not attempted, with honest verification notes for
each.

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

---

## Implementation status — 2026-07-26 follow-up (PR #3)

Verification method for every item below: `pnpm run typecheck` and `pnpm run build`
(both clean) for `artifacts/warboss-highway`, plus `bash scripts/verify.sh` at the repo
root (`VERIFY PASSED`) after all changes. **What this does NOT cover**: I do not have
an interactive browser available in this session (the Claude-in-Chrome extension
reported not connected when checked), so nothing below was verified by actually
playing the game and watching the animation happen on screen. Where a check can be done
without a browser — e.g. grepping the compiled CSS output for a generated utility class
— I did that and call it out explicitly. Where I could not verify visually, I say so
instead of claiming it "works."

### #3 Button press feedback — DONE, partially unverified
Added `active:scale-[0.97]` (+ `motion-reduce:active:scale-100`) to `buttonVariants` in
`components/ui/button.tsx`, and matching press feedback to the raw (non-`Button`)
elements: daily-challenge toggle, mute button, leaderboard period tabs
(`active:scale-[0.94]`), car-select cards (`active:scale-[0.96]`).
**Caveat found and fixed while implementing #4**: the title screen's START ENGINE button
is rendered via `<Button asChild><motion.button variants={...}>` so framer-motion could
render its stagger-in animation — framer-motion writes an inline `transform` style on
that element, which unconditionally wins over the CSS `:active` rule's `transform`
(inline styles beat class selectors regardless of specificity), so the CSS
`active:scale` would have silently done nothing on that one button. Fixed by giving that
specific button `whileTap={{ scale: 0.97 }}` instead, so framer-motion owns its own
`transform` end to end. Every other button in the app is a plain DOM node and the CSS
`active:scale` does apply — but "does it feel right on a touchscreen" is a judgment call
that needs a human tapping a real device, which I can't do here.

### #9 prefers-reduced-motion guard — DONE, verified for the CSS half only
Two-part fix: (1) a global CSS reset in `index.css` under
`@media (prefers-reduced-motion: reduce)` that zeroes transition/animation durations —
this is standard, well-tested CSS and I'm confident it works. (2) `GameEngine` now reads
`matchMedia('(prefers-reduced-motion: reduce)')` once at construction and sets
`screenShake` to `0` instead of `300` on crash when reduced motion is requested
(`lib/game/engine.ts`). **I could not verify (2) by actually toggling the OS/browser
reduced-motion setting and playing the game to a crash** — I verified the code compiles
and the logic reads correctly, not that it behaves correctly at runtime.

### #1 Screen transition cross-fade — DONE, verified by build only
Wrapped title/game-over screens in `AnimatePresence` with `motion.div` opacity(+scale)
cross-fades (`Game.tsx`). The canvas is now always rendered (previously `hidden`/`block`
toggled) so the crash frame stays visible underneath the game-over overlay as it fades
in, instead of hard-cutting to black — this leverages existing engine behavior (the
render loop already stops calling itself once `isGameOver` is true, so the last frame
was always left painted; I did not need to add a freeze-frame mechanism, just stop
hiding the canvas). `pnpm run build` succeeds and produces valid output. **Not verified
visually** — I did not watch the cross-fade render in a browser.

### #2 HUD score/combo pop juice — DONE, verified by build only
Added `scorePop`/`comboPop` timers to `GameState` (same decay pattern as the existing
`screenShake`/`levelUpFlash`), triggered on TANK/BOSS kill score jumps and each near-miss
combo increment, consumed in `renderer.ts`'s `drawHUD` via a `ctx.scale()` applied around
the text's anchor point (ease-out, peaks at 1.3x/1.5x, decays over 220ms). Typechecks and
builds clean. **This is the item I'm least able to vouch for** — canvas draw-call
correctness (is the scale actually centered on the text, does it look like a "pop" and
not a jitter) can only really be confirmed by watching it during gameplay, which requires
triggering a tank kill or near-miss with keyboard/touch input I can't automate here.

### #4 Title screen entrance stagger — DONE, verified by build only
Logo → streak badge → car grid → PB → daily toggle → CTA now stagger in via framer-motion
`variants` (`staggerChildren: 0.045`, `delayChildren: 0.06`, each item fades+slides up
10px over 220ms), fully disabled under `prefersReducedMotion`. Same caveat as #1/#2: only
build-verified, not eyeballed.

### #5 Car selection feedback — DONE, verified by build + one CSS-output check
Selected car card now gets `scale-[1.03]` (CSS transition, already had `transition-all`)
plus `active:scale-[0.96]` press feedback. `CarPreview`'s canvas now runs a small idle
bob (`Math.sin` on a rAF loop, amplitude 1px unselected / 3px selected), skipped entirely
under reduced motion. This is 3 concurrent rAF loops on the title screen (one per car) —
cheap draws, but I did not profile it, so "cheap" is an assumption based on the draw call
being a handful of `fillRect`/`fill` calls, not a measurement.

### #8 Skeleton loading states — DONE, verified by build
Replaced the literal `'...'` / `"DECRYPTING DATA..."` loading text with the existing
`Skeleton` component: stat cards show a skeleton block when `value === undefined`, the
leaderboard table shows 6 skeleton rows shaped like real rows while `isScoresLoading`.
Straightforward swap of an existing, already-tested component — highest confidence item
in this list, though still not seen rendered.

### #6 Leaderboard row highlight on arrival — DONE, verified by build + type-checked
API contract check: `POST /scores` returns the created `Score` (`id` included) per
`lib/api-spec/openapi.yaml`, confirmed via the generated `SubmitScoreMutationResult`
type. `game-over-overlay.tsx` now navigates to `/leaderboard?highlight=<id>` on submit
instead of a bare `/leaderboard`; `Leaderboard.tsx` reads that via wouter's
`useSearchParams()`, and the matching row gets a ref + `scrollIntoView({block:'center'})`
+ a finite (`*_2` iteration, not infinite) pulse highlight, gated by the same
reduced-motion CSS reset as everything else. **Not implemented**: the audit's stretch
goal of a true shared-element (`layoutId`) transition from the game-over stat to its
table row — I called that out in the original finding as a stretch goal given wouter's
routing model, and did not attempt it here either.

### #7 Type scale / OKLCH cleanup — PARTIALLY DONE, honest scope cut
Did: consolidated the car-select card's 3 stacked fixed sizes (`text-[10px]`,
`text-[8px]`, `text-[7px]`) into 2 fluid `clamp()`-based sizes
(`--text-micro-label`/`--text-micro-body` in `index.css`, using Tailwind v4's `--text-*`
theme namespace so `text-micro-label`/`text-micro-body` utilities are generated
automatically). **This is the one item I could verify without a
browser**: I grepped the built CSS output and confirmed both utilities compile to the
correct `clamp()` rules (`.text-micro-body{font-size:clamp(.4375rem,.41rem + .13vw,.5rem)}`,
`.text-micro-label{font-size:clamp(.5rem,.47rem + .15vw,.625rem)}`) — this one I'm
confident actually works, not just compiles.
Did NOT do: converting the flat HSL color palette to OKLCH. This is a full
design-system-level repaint (every color token in `index.css`, every hardcoded hex in
`renderer.ts`'s canvas draw calls) with real visual-identity risk if done hastily, and
the original finding already flagged it as "worth a dedicated pass rather than bundling
in" — I'm making the same scope call now rather than rushing a repaint I can't visually
QA in this session. Logged as follow-up work, not silently dropped.

### #10 framer-motion unused dependency — RESOLVED as a side effect
`framer-motion` is now imported and used in `Game.tsx` (items #1, #4, #5's `whileTap`).
No longer a dead dependency.

### What "done" means here, honestly
Every item above compiles, typechecks, and survives a production build
(`pnpm run build`) plus the full repo governance gate (`bash scripts/verify.sh` →
`VERIFY PASSED`). None of the framer-motion/canvas-juice items were confirmed by
actually watching them animate in a browser, because no interactive browser was
available in this session. If something looks wrong once a human plays it, the most
likely culprits are: the `ctx.scale()` anchor math in `renderer.ts` (#2), or the
`AnimatePresence`/`motion.div` nesting in `Game.tsx` (#1/#4) — those are the two places
with the least amount of "the compiler would have caught it" safety net.
