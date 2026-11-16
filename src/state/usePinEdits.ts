import { useState } from 'react';

import { type Pattern, togglePin } from '@/domain/pattern';
import { announce } from '@/voice/announce';

interface EditState<P> {
  picked: P;
  pattern: Pattern | null;
  unlocked: boolean;
}

/**
 * Pin lock for a converted picture. Locked (default): the pins follow the image. Unlocked: the user taps pins, and
 * those edits win over every setting. Edits (and the unlock) belong to the picture they were made on: a new picture
 * discards them and locks again.
 */
export function usePinEdits<P>(analysed: P | null, result: Pattern | null) {
  const [editState, setEditState] = useState<EditState<P> | null>(null);
  const edit = editState && editState.picked === analysed ? editState : null;
  const unlocked = !!edit?.unlocked;
  /** What the user gets: their edited pins, or the automatic result. */
  const shown = edit?.pattern ?? result;

  const toggleLock = () => {
    if (!analysed) return;
    const next = !unlocked;
    setEditState({ picked: analysed, pattern: edit?.pattern ?? null, unlocked: next });
    announce(next ? 'Pins unlocked. Tap a pin to raise or lower it.' : 'Pins locked');
  };
  const togglePinAt = (row: number, col: number) => {
    if (!analysed || !shown || !unlocked) return;
    setEditState({ picked: analysed, pattern: togglePin(shown, row, col), unlocked: true });
  };
  const resetPins = () => {
    if (!analysed || !edit) return;
    setEditState({ ...edit, picked: analysed, pattern: null });
    announce('Pins reset to the image');
  };
  /** Forgets every edit (a new picture). */
  const clear = () => setEditState(null);

  return { shown, unlocked, edited: !!edit?.pattern, toggleLock, togglePinAt, resetPins, clear };
}
