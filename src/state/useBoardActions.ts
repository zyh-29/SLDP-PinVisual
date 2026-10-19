import { router } from 'expo-router';
import { useCallback } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useDevice } from './DeviceProvider';
import { usePattern } from './PatternProvider';

/** Send / reset flows shared by every screen that offers them. */
export function useBoardActions() {
  const { state, controller } = useDevice();
  const { pattern, clear } = usePattern();

  const connected = state.connection.status === 'connected';
  const busy = state.command.status === 'sending';

  const send = useCallback(async () => {
    const res = await controller.sendPattern(pattern);
    AccessibilityInfo.announceForAccessibility(res.ok ? 'Board received pattern.' : `Send failed. ${res.message}`);
  }, [controller, pattern]);

  const reset = useCallback(async () => {
    const res = await controller.reset();
    if (res.ok) {
      // Only after the board acknowledged: clear the preview and go to the main screen.
      clear();
      router.navigate('/');
      AccessibilityInfo.announceForAccessibility('Board acknowledged reset. Preview cleared.');
    } else {
      AccessibilityInfo.announceForAccessibility(`Reset failed. ${res.message}`);
    }
  }, [controller, clear]);

  return { send, reset, connected, busy, state };
}
