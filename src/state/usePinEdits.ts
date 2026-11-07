import { useState } from 'react';

import { cellsToString, type Pattern, togglePin } from '@/domain/pattern';
import { announce } from '@/voice/announce';

interface EditState<P> {
  picked: P;
  auto: string;
  pattern: Pattern | null;
  unlocked: boolean;
}

/**
 * Pin lock for a converted picture. Locked (default): the pins follow the image. Unlocked: the user taps pins, and
 * those edits win over every setting. Edits (and the unlock) belong to the picture they were made on: a new picture
 * discards them and locks again. While `live`, that means the picture changed enough to change the automatic pins.
 */
export function usePinEdits<P>(analysed: P | null, result: Pattern | null, live: boolean) {
  const [editState, setEditState] = useState<EditState<P> | null>(null);
  const autoKey = result ? cellsToString(result) : '';
  const edit = editState && (editState.picked === analysed || (live && editState.auto === autoKey)) ? editState : null;
  const unlocked = !!edit?.unlocked;
  /** What the user gets: their edited pins, or the automatic result. */
  const shown = edit?.pattern ?? result;

  const toggleLock = () => {
    if (!analysed) return;
    const next = !unlocked;
    setEditState({ picked: analysed, auto: autoKey, pattern: edit?.pattern ?? null, unlocked: next });
    announce(next ? 'Pins unlocked. Tap a pin to raise or lower it.' : 'Pins locked');
  };
  const togglePinAt = (row: number, col: number) => {
    if (!analysed || !shown || !unlocked) return;
    setEditState({ picked: analysed, auto: autoKey, pattern: togglePin(shown, row, col), unlocked: true });
  };
  const resetPins = () => {
    if (!analysed || !edit) return;
    setEditState({ ...edit, picked: analysed, auto: autoKey, pattern: null });
    announce('Pins reset to the image');
  };
  /** Forgets every edit (a new picture). */
  const clear = () => setEditState(null);

  return { shown, unlocked, edited: !!edit?.pattern, toggleLock, togglePinAt, resetPins, clear };
}
