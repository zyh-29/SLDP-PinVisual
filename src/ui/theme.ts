import { Platform, useColorScheme } from 'react-native';

import { useAppearance } from '@/state/appearance';

/**
 * Apple-style design tokens. Colours follow iOS system colours, darkened or
 * lightened where needed so text meets WCAG AA (4.5:1) on its background.
 */
const light = {
  background: '#F2F2F7', // systemGroupedBackground
  card: '#FFFFFF',
  cardPressed: '#E5E5EA',
  text: '#000000',
  textSecondary: '#5C5C61', // 6.3:1 on white
  separator: '#C6C6C8',
  fill: '#E9E9EE', // tertiary fill / segmented track
  segmentSelected: '#FFFFFF', // the chosen option in a segmented control
  tint: '#0062CC', // accessible system blue, 5.9:1 on white
  tintSoft: 'rgba(0, 98, 204, 0.11)',
  onTint: '#FFFFFF',
  destructive: '#C02A1F', // 5.9:1 on white
  destructiveSoft: 'rgba(192, 42, 31, 0.10)',
  success: '#1D7A35',
  successSoft: 'rgba(29, 122, 53, 0.11)',
  warning: '#8A5300',
  warningSoft: 'rgba(204, 125, 0, 0.14)',
  pinRaised: '#111113',
  pinLoweredBorder: '#8E8E93',
  pinLoweredFill: '#FFFFFF',
  gridWell: '#F2F2F7',
  sidebar: '#E9E9EE',
};

const dark: typeof light = {
  background: '#000000',
  card: '#1C1C1E',
  cardPressed: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#AEAEB2',
  separator: '#38383A',
  fill: '#2C2C2E',
  segmentSelected: '#636366', // iOS dark: the chosen segment is lighter than its track
  tint: '#4BA3FF',
  tintSoft: 'rgba(75, 163, 255, 0.18)',
  onTint: '#000000',
  destructive: '#FF6B61',
  destructiveSoft: 'rgba(255, 107, 97, 0.16)',
  success: '#4CD471',
  successSoft: 'rgba(76, 212, 113, 0.16)',
  warning: '#FFC247',
  warningSoft: 'rgba(255, 194, 71, 0.16)',
  pinRaised: '#F5F5F7',
  pinLoweredBorder: '#7C7C80',
  pinLoweredFill: '#1C1C1E',
  gridWell: '#111113',
  sidebar: '#161618',
};

export type Palette = typeof light;

/** Light or dark: the user's choice (Device tab, or the website's sidebar), or the device's when it's Automatic. */
export function useScheme(): 'light' | 'dark' {
  const [pref] = useAppearance();
  const system = useColorScheme();
  if (pref !== 'auto') return pref;
  return system === 'dark' ? 'dark' : 'light';
}

export function useTheme(): Palette {
  return useScheme() === 'dark' ? dark : light;
}

/** iOS text styles (Dynamic Type defaults). */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.4 },
  title2: { fontSize: 22, fontWeight: '700', letterSpacing: 0.35 },
  title3: { fontSize: 20, fontWeight: '600', letterSpacing: 0.38 },
  headline: { fontSize: 17, fontWeight: '600', letterSpacing: -0.41 },
  body: { fontSize: 17, fontWeight: '400', letterSpacing: -0.41 },
  callout: { fontSize: 16, fontWeight: '400', letterSpacing: -0.32 },
  subhead: { fontSize: 15, fontWeight: '400', letterSpacing: -0.24 },
  footnote: { fontSize: 13, fontWeight: '400', letterSpacing: -0.08 },
  caption: { fontSize: 12, fontWeight: '400', letterSpacing: 0 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

/** Minimum touch target (Apple HIG: 44pt). */
export const MIN_TOUCH = 44;

export const monoFont = Platform.select({ ios: 'Menlo', default: 'monospace' });

