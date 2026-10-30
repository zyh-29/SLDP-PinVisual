import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * Speech settings, kept on this device only.
 * - speakResults: say results out loud with the device's voice (for people who don't use a screen reader; a
 *   screen reader already reads them, so the app's own voice stays quiet while one is on).
 * - onlineRecognition: allow voice commands where the browser can only recognise speech on its maker's servers
 *   (Chrome on Android, Safari). Off by default: the app otherwise sends nothing anywhere.
 * - voiceControl: the voice panel is open on the Display tab (and its bar shows on the Image tab).
 * - onlinePictures: "find pictures of …" may search Openverse and Wikimedia Commons on the internet.
 */
export interface VoicePrefs {
  speakResults: boolean;
  onlineRecognition: boolean;
  voiceControl: boolean;
  onlinePictures: boolean;
}

export const VOICE_KEY = '@pinvisual/voice/v1';
const DEFAULTS: VoicePrefs = { speakResults: false, onlineRecognition: false, voiceControl: false, onlinePictures: false };
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

AsyncStorage.getItem(VOICE_KEY)
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
