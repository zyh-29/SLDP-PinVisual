import * as Haptics from 'expo-haptics';

/**
 * Marks the start and end of listening without words (a spoken "listening" would be heard by the microphone, and
 * talk over a screen reader): a firm tap when it starts, a light one when it stops.
 */
export function listeningCue(kind: 'start' | 'stop') {
  Haptics.impactAsync(kind === 'start' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
