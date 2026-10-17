import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { GRID } from '@/config/hardware';
import { createEmptyPattern, type Pattern, togglePin } from '@/domain/pattern';

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
}

const PatternContext = createContext<PatternContextValue | null>(null);

export function PatternProvider({ children }: { children: ReactNode }) {
  const [pattern, setPatternState] = useState<Pattern>(() => createEmptyPattern(GRID.rows, GRID.cols));
  const [source, setSource] = useState<string | null>(null);

  const setPattern = useCallback((p: Pattern, src: string | null = null) => {
    if (p.rows !== GRID.rows || p.cols !== GRID.cols) {
      throw new Error(`Pattern is ${p.rows} x ${p.cols} but the display is ${GRID.rows} x ${GRID.cols}`);
    }
    setPatternState(p);
    setSource(src);
  }, []);
  const toggle = useCallback((row: number, col: number) => setPatternState((p) => togglePin(p, row, col)), []);
  const clear = useCallback(() => {
    setPatternState(createEmptyPattern(GRID.rows, GRID.cols));
    setSource(null);
  }, []);

  const value = useMemo(() => ({ pattern, source, setPattern, toggle, clear }), [pattern, source, setPattern, toggle, clear]);
  return <PatternContext.Provider value={value}>{children}</PatternContext.Provider>;
}

export function usePattern(): PatternContextValue {
  const ctx = useContext(PatternContext);
  if (!ctx) throw new Error('usePattern must be used inside PatternProvider');
  return ctx;
}
