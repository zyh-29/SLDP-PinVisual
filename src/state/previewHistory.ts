import { type Pattern, patternsEqual } from '@/domain/pattern';

/**
 * The preview with its undo and redo history. Pure functions, unit tested; PatternProvider keeps one of these in
 * state.
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
  /** Undone previews, next first: Redo brings them back. Any new change drops them. */
  future: Preview[];
}

/** How many steps Undo can go back. */
export const MAX_UNDO = 50;

export const startHistory = (now: Preview): PreviewHistory => ({ now, past: [], future: [] });

/**
 * A new preview. The old one goes on the undo list, unless nothing changed. What was undone can't be redone after
 * it (the usual rule: a new edit starts a new branch).
 */
export function change(h: PreviewHistory, next: Preview): PreviewHistory {
  if (next.source === h.now.source && patternsEqual(next.pattern, h.now.pattern)) return h;
  return { now: next, past: [...h.past, h.now].slice(-MAX_UNDO), future: [] };
}

/**
 * Back `steps` changes (1 by default), or as many as there are when fewer: nothing happens when there are none.
 * Fractions are rounded down.
 */
export function undo(h: PreviewHistory, steps = 1): PreviewHistory {
  const n = Math.min(Math.floor(steps), h.past.length);
  if (!(n > 0)) return h;
  const back = h.past.length - n;
  // The previews stepped over, and the current one, go on the redo list, nearest first.
  const undone = [...h.past.slice(back + 1), h.now];
  return { now: h.past[back], past: h.past.slice(0, back), future: [...undone, ...h.future] };
}

/** Forward `steps` undone changes (1 by default), or as many as there are when fewer. Fractions are rounded down. */
export function redo(h: PreviewHistory, steps = 1): PreviewHistory {
  const n = Math.min(Math.floor(steps), h.future.length);
  if (!(n > 0)) return h;
  const redone = h.future.slice(0, n - 1);
  return { now: h.future[n - 1], past: [...h.past, h.now, ...redone].slice(-MAX_UNDO), future: h.future.slice(n) };
}

/** Back to the oldest preview kept (up to MAX_UNDO changes ago). */
export const undoAll = (h: PreviewHistory): PreviewHistory => undo(h, h.past.length);

/** Forward through everything undone, back to the newest preview. */
export const redoAll = (h: PreviewHistory): PreviewHistory => redo(h, h.future.length);

/** Most steps that can be typed (for Undo or Redo): more than the history can hold makes no difference. */
export const MAX_UNDO_STEPS = MAX_UNDO;

/** Steps typed by the user, for Undo or Redo: a whole number from 1; empty means 1. Null when it isn't one. */
export function parseUndoSteps(text: string): number | null {
  const s = text.trim();
  if (!s) return 1;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? Math.min(n, MAX_UNDO_STEPS) : null;
}
