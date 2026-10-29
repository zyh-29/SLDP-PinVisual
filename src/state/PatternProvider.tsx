import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { GRID } from '@/config/hardware';
import { createEmptyPattern, type Pattern, togglePin } from '@/domain/pattern';
import {
  change,
  clearHistory as forgetHistory,
  jumpTo as jumpToStep,
  type Preview,
  type PreviewHistory,
  redo as redoSteps,
  redoAll as redoEverything,
  startHistory,
  timeline,
  undo as undoSteps,
  undoAll as undoEverything,
} from './previewHistory';

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
  /**
   * Back `steps` changes (1 by default), or as many as there are. A change: a pin tap, Clear, or a pattern from
   * the Image or Saved tab.
   */
  undo: (steps?: number) => void;
  /** Back to the oldest preview kept. */
  undoAll: () => void;
  /** How many changes can be undone. */
  undoCount: number;
  canUndo: boolean;
  /** Forward `steps` undone changes (1 by default), or as many as there are. A new change drops them. */
  redo: (steps?: number) => void;
  /** Forward through everything undone. */
  redoAll: () => void;
  /** How many undone changes can be redone. */
  redoCount: number;
  /** Every step in the history, oldest first, undone ones included: the timeline. */
  steps: Preview[];
  /** Which of `steps` is showing. */
  position: number;
  /** Straight to step `index` of `steps`. */
  jumpTo: (index: number) => void;
  /** Forget every other step; the preview showing stays. */
  clearHistory: () => void;
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
  const undo = useCallback((steps = 1) => setHistory((h) => undoSteps(h, steps)), []);
  const undoAll = useCallback(() => setHistory(undoEverything), []);
  const redo = useCallback((steps = 1) => setHistory((h) => redoSteps(h, steps)), []);
  const redoAll = useCallback(() => setHistory(redoEverything), []);
  const jumpTo = useCallback((index: number) => setHistory((h) => jumpToStep(h, index)), []);
  const clearHistory = useCallback(() => setHistory(forgetHistory), []);

  const { now, past, future } = history;
  const undoCount = past.length;
  const canUndo = undoCount > 0;
  const redoCount = future.length;
  const { steps, current: position } = useMemo(() => timeline(history), [history]);
  const value = useMemo(
    () => ({
      pattern: now.pattern,
      source: now.source,
      setPattern,
      toggle,
      clear,
      undo,
      undoAll,
      undoCount,
      canUndo,
      redo,
      redoAll,
      redoCount,
      steps,
      position,
      jumpTo,
      clearHistory,
    }),
    [now, setPattern, toggle, clear, undo, undoAll, undoCount, canUndo, redo, redoAll, redoCount, steps, position, jumpTo, clearHistory],
  );
  return <PatternContext.Provider value={value}>{children}</PatternContext.Provider>;
}

export function usePattern(): PatternContextValue {
  const ctx = useContext(PatternContext);
  if (!ctx) throw new Error('usePattern must be used inside PatternProvider');
  return ctx;
}
