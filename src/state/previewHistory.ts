import { type Pattern, patternsEqual } from '@/domain/pattern';

/**
 * The preview with its undo history. Pure functions, unit tested; PatternProvider keeps one of these in state.
 */
export interface Preview {
  pattern: Pattern;
  /** Where the preview came from, e.g. "From image" or a saved pattern's name. */
  source: string | null;
}

export interface PreviewHistory {
  now: Preview;
  /** Earlier previews, oldest first. */
  past: Preview[];
}

/** How many steps Undo can go back. */
export const MAX_UNDO = 50;

export const startHistory = (now: Preview): PreviewHistory => ({ now, past: [] });

/** A new preview. The old one goes on the undo list, unless nothing changed. */
export function change(h: PreviewHistory, next: Preview): PreviewHistory {
  if (next.source === h.now.source && patternsEqual(next.pattern, h.now.pattern)) return h;
  return { now: next, past: [...h.past, h.now].slice(-MAX_UNDO) };
}

/**
 * Back `steps` changes (1 by default), or as many as there are when fewer: nothing happens when there are none.
 * Fractions are rounded down.
 */
export function undo(h: PreviewHistory, steps = 1): PreviewHistory {
  const n = Math.min(Math.floor(steps), h.past.length);
  if (!(n > 0)) return h;
  return { now: h.past[h.past.length - n], past: h.past.slice(0, -n) };
}

/** Back to the oldest preview kept (up to MAX_UNDO changes ago). */
export const undoAll = (h: PreviewHistory): PreviewHistory => undo(h, h.past.length);

/** Most steps that can be typed: more than the history can hold makes no difference. */
export const MAX_UNDO_STEPS = MAX_UNDO;

/** Steps typed by the user: a whole number from 1; empty means 1. Null when it isn't one. */
export function parseUndoSteps(text: string): number | null {
  const s = text.trim();
  if (!s) return 1;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? Math.min(n, MAX_UNDO_STEPS) : null;
}
