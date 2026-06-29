/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useResolvedColorScheme } from '@/lib/theme-preference';

export function useTheme() {
  return Colors[useResolvedColorScheme()];
}
