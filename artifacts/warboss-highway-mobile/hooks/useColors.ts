import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`. `light` and `dark` are
 * the same grimdark palette (see constants/colors.ts) — the web app this
 * mirrors never actually has a separate light theme, so there's nothing
 * to switch between, but the hook still resolves per-scheme for when/if
 * that changes.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
