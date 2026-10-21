/**
 * The Image tab's conversion settings in one place: what the user chose (or left automatic) for turning a
 * picture into pins. Some are about one picture only (a hand-set tolerance, the graph moved with the arrows) and
 * go back to automatic for the next one.
 */
import { useCallback, useState } from 'react';

import { DEFAULT_PIN_FILL } from '@/imaging/foreground';
import type { GraphRange } from './useImageConversion';

export interface ConversionPrefs {
  removeBackground: boolean;
  removeClutter: boolean;
  /** null = automatic: chosen from each image (and crop) by the triangle method on colour distances. */
  toleranceOverride: number | null;
  /** Higher raises more pins. A pin is raised when at least (100 - sensitivity)% of it is subject. */
  sensitivity: number;
  snap: boolean;
  /** null = automatic: Smart Cut-Out runs when the background is busy. */
  cutoutOverride: boolean | null;
  /** null = automatic: axes and gridlines are removed when the image looks like a graph. */
  linesOverride: boolean | null;
  graphRange: GraphRange;
  /** The graph window moved with the arrows (units, right and up); back to the curve for each new graph. */
  graphPan: { x: number; y: number };
  /** Graph curves as a line one pin wide. */
  thinLines: boolean;
}

export const NO_PAN = { x: 0, y: 0 };

const DEFAULTS: ConversionPrefs = {
  removeBackground: true,
  removeClutter: true,
  toleranceOverride: null,
  sensitivity: 100 - Math.round(DEFAULT_PIN_FILL * 100),
  snap: true,
  cutoutOverride: null,
  linesOverride: null,
  graphRange: '5',
  graphPan: NO_PAN,
  thinLines: true,
};

/** Settings that belong to one picture: a new picture goes back to automatic. */
export function forNewPicture(p: ConversionPrefs): ConversionPrefs {
  return { ...p, linesOverride: null, cutoutOverride: null, toleranceOverride: null, graphPan: NO_PAN };
}

export function useConversionSettings() {
  const [settings, setSettings] = useState<ConversionPrefs>(DEFAULTS);
  const set = useCallback(<K extends keyof ConversionPrefs>(key: K, value: ConversionPrefs[K]) => setSettings((p) => ({ ...p, [key]: value })), []);
  const resetForNewPicture = useCallback(() => setSettings(forNewPicture), []);
  return { settings, set, resetForNewPicture };
}
