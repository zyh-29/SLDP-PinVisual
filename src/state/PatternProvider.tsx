import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { GRID } from '@/config/hardware';
import { createEmptyPattern, type Pattern, togglePin } from '@/domain/pattern';
import { change, type PreviewHistory, startHistory, undo as undoOnce } from './previewHistory';

/**
 * The editable preview. Editing here never talks to the board; sending is an
 * explicit, separate action (see useBoardActions).
 */
interface PatternContextValue {
  pattern: Pattern;
  /** Where the current preview came from, e.g. "From image" or a saved pattern's name. */
  source: string | null;
  setPattern: (p: Pattern, source?: string | null) => void;
  toggle: (row: number, col: number) => void;
  clear: () => void;
  /** Back to the preview before the last change: a pin tap, Clear, or a pattern from the Image or Saved tab. */
  undo: () => void;
  canUndo: boolean;
}

const PatternContext = createContext<PatternContextValue | null>(null);

const empty = () => createEmptyPattern(GRID.rows, GRID.cols);

export function PatternProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<PreviewHistory>(() => startHistory({ pattern: empty(), source: null }));

  const setPattern = useCallback((p: Pattern, src: string | null = null) => {
    if (p.rows !== GRID.rows || p.cols !== GRID.cols) {
      throw new Error(`Pattern is ${p.rows} x ${p.cols} but the display is ${GRID.rows} x ${GRID.cols}`);
    }
    setHistory((h) => change(h, { pattern: p, source: src }));
  }, []);
  // A hand edit keeps the source ("From image" edited is still from the image).
  const toggle = useCallback(
    (row: number, col: number) => setHistory((h) => change(h, { ...h.now, pattern: togglePin(h.now.pattern, row, col) })),
    [],
  );
  const clear = useCallback(() => setHistory((h) => change(h, { pattern: empty(), source: null })), []);
  const undo = useCallback(() => setHistory(undoOnce), []);

  const { now, past } = history;
  const canUndo = past.length > 0;
  const value = useMemo(
    () => ({ pattern: now.pattern, source: now.source, setPattern, toggle, clear, undo, canUndo }),
    [now, setPattern, toggle, clear, undo, canUndo],
  );
  return <PatternContext.Provider value={value}>{children}</PatternContext.Provider>;
}

export function usePattern(): PatternContextValue {
  const ctx = useContext(PatternContext);
  if (!ctx) throw new Error('usePattern must be used inside PatternProvider');
  return ctx;
}
