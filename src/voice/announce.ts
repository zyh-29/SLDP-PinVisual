import * as Speech from 'expo-speech';
import { AccessibilityInfo, Platform } from 'react-native';

import { liveAnnounce } from './liveRegion';
import { getVoicePrefs } from './voicePrefs';

/**
 * Tells the user something that happened (a result, an error), however they use the app:
 * - a screen reader (VoiceOver, TalkBack, or one on a computer) reads it, in the voice and speed they chose;
 * - with Speak Results on and no screen reader running, the device's own voice says it out loud.
 * Never both: hearing everything twice is worse than not hearing it.
 */
let screenReader = false;
AccessibilityInfo.isScreenReaderEnabled()
  .then((on) => {
    screenReader = on;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener?.('screenReaderChanged', (on: boolean) => {
  screenReader = on;
});

/** Whether a screen reader is known to be on (phones only: a browser can't tell). */
export const screenReaderOn = () => screenReader;

/** The last thing said, for "repeat". */
let last = '';
export const lastAnnouncement = () => last;

export function announce(text: string, o: { interrupt?: boolean } = {}) {
  if (!text) return;
  last = text;
  if (Platform.OS === 'web') liveAnnounce(text);
  else AccessibilityInfo.announceForAccessibility(text);
  if (getVoicePrefs().speakResults && !screenReader) {
    if (o.interrupt !== false) Speech.stop();
    Speech.speak(text, { language: 'en-US' });
  }
}

/** Stops the app's own voice (a screen reader stops with its own gesture). */
export function stopSpeaking() {
  Speech.stop();
}
