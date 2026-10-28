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

/** Every preview in order (oldest first) and which one is showing: what the timeline draws. */
export function timeline(h: PreviewHistory): { steps: Preview[]; current: number } {
  return { steps: [...h.past, h.now, ...h.future], current: h.past.length };
}

/** Straight to step `index` of the timeline (undoing or redoing as many changes as it takes). */
export function jumpTo(h: PreviewHistory, index: number): PreviewHistory {
  const at = h.past.length;
  return index < at ? undo(h, at - index) : redo(h, index - at);
}

export type StepKind = 'start' | 'source' | 'clear' | 'raise' | 'lower' | 'edit';

/**
 * What a step did, from the preview before it: for the timeline's caption and screen readers. `prev` is undefined
 * for the first step (`oldest` when older steps were dropped, past MAX_UNDO).
 */
export function describeStep(prev: Preview | undefined, cur: Preview, oldest = false): { kind: StepKind; text: string } {
  if (!prev) return { kind: 'start', text: oldest ? 'Oldest kept' : 'Start' };
  if (cur.source && cur.source !== prev.source) return { kind: 'source', text: cur.source };
  const changed: number[] = [];
  cur.pattern.cells.forEach((v, i) => v !== prev.pattern.cells[i] && changed.push(i));
  if (changed.length === 1) {
    const i = changed[0];
    const where = `row ${Math.floor(i / cur.pattern.cols) + 1}, column ${(i % cur.pattern.cols) + 1}`;
    return cur.pattern.cells[i] ? { kind: 'raise', text: `Raised ${where}` } : { kind: 'lower', text: `Lowered ${where}` };
  }
  if (cur.pattern.cells.every((v) => v === 0)) return { kind: 'clear', text: 'Cleared' };
  return { kind: 'edit', text: `${changed.length} pins changed` };
}
