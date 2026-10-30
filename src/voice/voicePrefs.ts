import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * Speech settings, kept on this device only.
 * - speakResults: say results out loud with the device's voice (for people who don't use a screen reader; a
 *   screen reader already reads them, so the app's own voice stays quiet while one is on).
 * - onlineRecognition: allow voice commands where the browser can only recognise speech on its maker's servers
 *   (Chrome on Android, Safari). Off by default: the app otherwise sends nothing anywhere.
 */
export interface VoicePrefs {
  speakResults: boolean;
  onlineRecognition: boolean;
}

export const VOICE_KEY = '@pinvisual/voice/v1';
const DEFAULTS: VoicePrefs = { speakResults: false, onlineRecognition: false };

export function parseVoicePrefs(json: string | null): VoicePrefs {
  try {
    const v = json ? (JSON.parse(json) as Partial<VoicePrefs>) : {};
    return {
      speakResults: typeof v.speakResults === 'boolean' ? v.speakResults : DEFAULTS.speakResults,
      onlineRecognition: typeof v.onlineRecognition === 'boolean' ? v.onlineRecognition : DEFAULTS.onlineRecognition,
    };
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
