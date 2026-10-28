import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

/** Typing in a field keeps the browser's own undo for the text. */
const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redoes, while the screen using it is showing (the tabs stay
 * mounted, so this stops when another tab is open).
 */
export function useUndoShortcuts(undo: () => void, redo: () => void) {
  useFocusEffect(
    useCallback(() => {
      const onKey = (e: KeyboardEvent) => {
        if (!(e.metaKey || e.ctrlKey) || e.altKey || typing(e.target)) return;
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) undo();
        else if ((key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey)) redo();
        else return;
        e.preventDefault();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [undo, redo]),
  );
}
