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

/** Back to the preview before the last change (nothing happens when there is none). */
export function undo(h: PreviewHistory): PreviewHistory {
  const before = h.past.at(-1);
  return before ? { now: before, past: h.past.slice(0, -1) } : h;
}
