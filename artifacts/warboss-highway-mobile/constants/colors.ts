/**
 * Semantic design tokens for the mobile app.
 *
 * Ported from the web artifact's `index.css` (`:root` block) — that file's
 * own comment says "Same theme for dark, it's always grim-dark", i.e. the
 * web app never actually uses a separate light palette. This scaffold used
 * to still have its unmodified generic-app placeholder values (white
 * background, blue primary) despite that — the visible symptom was the
 * mobile chrome (tab bar, in particular) rendering as a stark white bar
 * under a near-black game canvas, tonally unrelated to the rest of the
 * grimdark art direction. `light` and `dark` are set to the same palette
 * on purpose, matching the web app's intent, not left to diverge by scheme.
 */

const grimdark = {
  text: '#e6e6e6',
  tint: '#b81e1e',

  background: '#0a0a0a',
  foreground: '#e6e6e6',

  card: '#0f0f0f',
  cardForeground: '#e6e6e6',

  primary: '#b81e1e',
  primaryForeground: '#fafafa',

  secondary: '#262626',
  secondaryForeground: '#fafafa',

  muted: '#1e1e1e',
  mutedForeground: '#a6a6a6',

  accent: '#c18d0b',
  accentForeground: '#171717',

  destructive: '#7f1d1d',
  destructiveForeground: '#fafafa',

  border: '#262626',
  input: '#262626',
};

const colors = {
  light: grimdark,
  dark: grimdark,

  // Border radius (in px) — the web app uses `--radius: 0rem` (sharp,
  // industrial edges throughout), matched here rather than the scaffold's
  // rounded-corner default.
  radius: 0,
};

export default colors;
