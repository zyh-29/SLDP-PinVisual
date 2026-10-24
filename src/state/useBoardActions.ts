import { router } from 'expo-router';
import { useCallback } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { Pattern } from '@/domain/pattern';
import { useDevice } from './DeviceProvider';
import { usePattern } from './PatternProvider';

/** Send / reset flows shared by every screen that offers them. */
export function useBoardActions() {
  const { state, controller } = useDevice();
  const { pattern, clear } = usePattern();

  const connected = state.connection.status === 'connected';
  const busy = state.command.status === 'sending';

  /** Sends any pattern (the Image tab sends its result without going through the preview). */
  const sendPattern = useCallback(
    async (p: Pattern) => {
      const res = await controller.sendPattern(p);
      AccessibilityInfo.announceForAccessibility(res.ok ? 'Board received pattern.' : `Send failed. ${res.message}`);
    },
    [controller],
  );

  const send = useCallback(() => sendPattern(pattern), [sendPattern, pattern]);

  /** Lowers every pin. Once the board acknowledges, the preview clears too; `goHome` then opens the Display tab. */
  const lowerPins = useCallback(
    async (goHome: boolean) => {
      const res = await controller.reset();
      if (res.ok) {
        clear();
        if (goHome) router.navigate('/');
        AccessibilityInfo.announceForAccessibility('Board acknowledged reset. Preview cleared.');
      } else {
        AccessibilityInfo.announceForAccessibility(`Reset failed. ${res.message}`);
      }
    },
    [controller, clear],
  );

  const reset = useCallback(() => lowerPins(true), [lowerPins]);

  return { send, sendPattern, reset, lowerPins, connected, busy, state };
}
