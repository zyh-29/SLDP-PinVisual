import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, Platform } from 'react-native';

/**
 * The appearance the user picked: follow the device (the default, and what Apple recommends), or always light or
 * always dark. Kept on this device only. The theme (useTheme in ui/theme.ts) reads it.
 */
export type AppearancePref = 'auto' | 'light' | 'dark';

export const APPEARANCE_KEY = '@pinvisual/appearance/v1';

export const isAppearancePref = (v: unknown): v is AppearancePref => v === 'auto' || v === 'light' || v === 'dark';

/** The website reads it straight away, so a page never opens in the wrong colours and then flips. */
function readNow(): AppearancePref {
  if (Platform.OS !== 'web') return 'auto';
  try {
    const v = globalThis.localStorage?.getItem(APPEARANCE_KEY);
    return isAppearancePref(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

let current: AppearancePref = readNow();
const listeners = new Set<() => void>();

function apply(p: AppearancePref) {
  if (Platform.OS === 'web') {
    // Scrollbars, text boxes and other browser-drawn parts follow it too.
    if (typeof document !== 'undefined') document.documentElement.style.colorScheme = p === 'auto' ? '' : p;
  } else {
    // The whole app, system alerts and keyboard included ('auto' goes back to following the device).
    Appearance.setColorScheme?.(p);
  }
}

export function setAppearance(p: AppearancePref) {
  if (p === current) return;
  current = p;
  apply(p);
  listeners.forEach((l) => l());
  AsyncStorage.setItem(APPEARANCE_KEY, p).catch(() => {});
}

export function getAppearance(): AppearancePref {
  return current;
}

apply(current);
// On phones the saved choice arrives a moment after start-up.
AsyncStorage.getItem(APPEARANCE_KEY)
  .then((v) => {
    if (isAppearancePref(v) && v !== current) setAppearance(v);
  })
  .catch(() => {});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useAppearance(): [AppearancePref, (p: AppearancePref) => void] {
  return [useSyncExternalStore(subscribe, getAppearance, getAppearance), setAppearance];
}
