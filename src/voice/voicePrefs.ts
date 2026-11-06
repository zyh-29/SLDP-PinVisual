import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * Speech settings, kept on this device only.
 * - speakResults: say results out loud with the device's voice (for people who don't use a screen reader; a
 *   screen reader already reads them, so the app's own voice stays quiet while one is on).
 * - onlineRecognition: allow voice commands where the browser can only recognise speech on its maker's servers
 *   (Chrome on Android, Safari). Off by default: the app otherwise sends nothing anywhere.
 * - voiceControl: the voice panel is open on the Display tab (and its bar shows on the Image tab).
 * - onlinePictures: "find pictures of …" (and anything said that isn't a command) may search Openverse and
 *   Wikimedia Commons on the internet. On by default.
 */
export interface VoicePrefs {
  speakResults: boolean;
  onlineRecognition: boolean;
  voiceControl: boolean;
  onlinePictures: boolean;
}

export const VOICE_KEY = '@pinvisual/voice/v2';
/** Settings saved before picture search was on by default. Every setting was saved at once, so its saved "off"
 * was usually just the old default: it's dropped when moving to VOICE_KEY, and the rest kept. */
const OLD_KEY = '@pinvisual/voice/v1';
const DEFAULTS: VoicePrefs = { speakResults: false, onlineRecognition: false, voiceControl: false, onlinePictures: true };
const KEYS = Object.keys(DEFAULTS) as (keyof VoicePrefs)[];

export function parseVoicePrefs(json: string | null): VoicePrefs {
  try {
    const v = json ? (JSON.parse(json) as Partial<VoicePrefs>) : {};
    const out = { ...DEFAULTS };
    for (const k of KEYS) if (typeof v[k] === 'boolean') out[k] = v[k];
    return out;
  } catch {
    return DEFAULTS;
  }
}

let current: VoicePrefs = DEFAULTS;
const listeners = new Set<() => void>();

export function getVoicePrefs(): VoicePrefs {
  return current;
}

export function setVoicePrefs(change: Partial<VoicePrefs>) {
  current = { ...current, ...change };
  listeners.forEach((l) => l());
  AsyncStorage.setItem(VOICE_KEY, JSON.stringify(current)).catch(() => {});
}

/** Settings saved under OLD_KEY, without picture search, as VOICE_KEY would hold them. */
export function migrateVoicePrefs(old: string | null): string | null {
  if (!old) return null;
  try {
    const { onlinePictures: _, ...rest } = JSON.parse(old) as Partial<VoicePrefs>;
    return JSON.stringify(parseVoicePrefs(JSON.stringify(rest)));
  } catch {
    return null;
  }
}

async function load(): Promise<string | null> {
  const v = await AsyncStorage.getItem(VOICE_KEY);
  if (v) return v;
  const moved = migrateVoicePrefs(await AsyncStorage.getItem(OLD_KEY));
  if (moved) await AsyncStorage.setItem(VOICE_KEY, moved);
  await AsyncStorage.removeItem(OLD_KEY);
  return moved;
}

load()
  .then((v) => {
    if (v) {
      current = parseVoicePrefs(v);
      listeners.forEach((l) => l());
    }
  })
  .catch(() => {});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useVoicePrefs(): [VoicePrefs, (change: Partial<VoicePrefs>) => void] {
  return [useSyncExternalStore(subscribe, getVoicePrefs, getVoicePrefs), setVoicePrefs];
}
