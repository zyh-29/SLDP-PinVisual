import { Platform, useWindowDimensions } from 'react-native';

/** Browser widths at or above this get a sidebar instead of a bottom tab bar. */
export const SIDEBAR_BREAKPOINT = 900;
export const SIDEBAR_WIDTH = 260;
/** Content at or above this width uses two columns (laptops, landscape iPads). Below it the pin grid would get too small beside a second column. */
export const TWO_COLUMN_BREAKPOINT = 900;
/** Content never stretches wider than this, so lines and cards stay readable on big screens. */
export const MAX_CONTENT_WIDTH = 1120;

export function useResponsive() {
  const { width } = useWindowDimensions();
  const sidebar = Platform.OS === 'web' && width >= SIDEBAR_BREAKPOINT;
  const contentWidth = Math.min(MAX_CONTENT_WIDTH, width - (sidebar ? SIDEBAR_WIDTH : 0));
  return {
    width,
    sidebar,
    twoColumn: contentWidth >= TWO_COLUMN_BREAKPOINT,
    /** Horizontal page padding: roomier on large screens. */
    gutter: width >= 1200 ? 40 : width >= 600 ? 28 : 16,
  };
}
