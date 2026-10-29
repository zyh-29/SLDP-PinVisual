import { createEmptyPattern, togglePin } from '@/domain/pattern';
import {
  change,
  clearHistory,
  describeStep,
  jumpTo,
  MAX_UNDO,
  redo,
  redoAll,
  startHistory,
  timeline,
  undo,
  undoAll,
} from '../previewHistory';

const empty = createEmptyPattern(5, 6);
const one = togglePin(empty, 0, 0);
const two = togglePin(one, 1, 1);

describe('preview undo', () => {
  it('goes back one change at a time, pattern and source together', () => {
    let h = startHistory({ pattern: empty, source: null });
    h = change(h, { pattern: one, source: 'From image' });
    h = change(h, { pattern: two, source: 'From image' });
    h = undo(h);
    expect(h.now).toEqual({ pattern: one, source: 'From image' });
    h = undo(h);
    expect(h.now).toEqual({ pattern: empty, source: null });
    expect(h.past).toHaveLength(0);
  });

  it('does nothing with nothing to undo', () => {
    const h = startHistory({ pattern: one, source: null });
    expect(undo(h)).toBe(h);
  });

  it('skips changes that change nothing (Clear on an empty grid)', () => {
    const h = startHistory({ pattern: empty, source: null });
    expect(change(h, { pattern: createEmptyPattern(5, 6), source: null })).toBe(h);
  });

  it('a new source alone counts as a change (the same pins loaded from a saved pattern)', () => {
    const h = change(startHistory({ pattern: one, source: null }), { pattern: one, source: 'Circle' });
    expect(h.past).toHaveLength(1);
  });

  it(`keeps the last ${MAX_UNDO} steps`, () => {
    let h = startHistory({ pattern: empty, source: null });
    for (let i = 0; i < MAX_UNDO + 10; i++) h = change(h, { pattern: togglePin(h.now.pattern, 0, 0), source: null });
    expect(h.past).toHaveLength(MAX_UNDO);
  });

  /** A history of 4 changes: empty, then one, two, three and four pins raised in turn. */
  const four = () => {
    let h = startHistory({ pattern: empty, source: null });
    let p = empty;
    for (let k = 0; k < 4; k++) h = change(h, { pattern: (p = togglePin(p, k, 0)), source: null });
    return h;
  };
  const raised = (h: ReturnType<typeof four>) => h.now.pattern.cells.filter(Boolean).length;

  it('several steps at once: 3 steps back from 4 pins is 1 pin', () => {
    const h = undo(four(), 3);
    expect(raised(h)).toBe(1);
    expect(h.past).toHaveLength(1);
  });

  it('more steps than there are: as many as there are', () => {
    const h = undo(four(), 10);
    expect(raised(h)).toBe(0);
    expect(h.past).toHaveLength(0);
  });

  it('undo all: back to the oldest kept, nothing left to undo', () => {
    const h = undoAll(four());
    expect(raised(h)).toBe(0);
    expect(h.past).toHaveLength(0);
    const none = startHistory({ pattern: one, source: null });
    expect(undoAll(none)).toBe(none);
  });

  it('zero or a fraction of a step: nothing, or rounded down', () => {
    const h = four();
    expect(undo(h, 0)).toBe(h);
    expect(raised(undo(h, 2.7))).toBe(2);
  });
});

describe('preview redo', () => {
  /** Empty, then 1, 2, 3 and 4 pins raised in turn. */
  const four = () => {
    let h = startHistory({ pattern: empty, source: null });
    let p = empty;
    for (let k = 0; k < 4; k++) h = change(h, { pattern: (p = togglePin(p, k, 0)), source: null });
    return h;
  };
  const raised = (h: ReturnType<typeof four>) => h.now.pattern.cells.filter(Boolean).length;

  it('brings back one undone change at a time, in order', () => {
    let h = undo(four(), 3);
    expect(h.future).toHaveLength(3);
    h = redo(h);
    expect(raised(h)).toBe(2);
    h = redo(h);
    expect(raised(h)).toBe(3);
    expect(h.past).toHaveLength(3);
    expect(h.future).toHaveLength(1);
  });

  it('several steps at once, or more than there are', () => {
    const h = undo(four(), 4);
    expect(raised(redo(h, 3))).toBe(3);
    expect(raised(redo(h, 10))).toBe(4);
    expect(redo(h, 10).future).toHaveLength(0);
  });

  it('undo then redo the same steps gets back exactly where it was', () => {
    const h = four();
    expect(redo(undo(h, 3), 3)).toEqual(h);
    expect(redoAll(undoAll(h))).toEqual(h);
    expect(undo(redo(undo(h, 1), 1), 1)).toEqual(undo(h, 1));
  });

  it('a new change drops what was undone', () => {
    const h = change(undo(four(), 2), { pattern: two, source: null });
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it('a change that changes nothing keeps the redo list', () => {
    const h = undo(four(), 2);
    expect(change(h, { ...h.now })).toBe(h);
  });

  it('nothing to redo, zero or a fraction of a step', () => {
    const fresh = four();
    expect(redo(fresh)).toBe(fresh);
    expect(redoAll(fresh)).toBe(fresh);
    const h = undo(fresh, 4);
    expect(redo(h, 0)).toBe(h);
    expect(raised(redo(h, 2.7))).toBe(2);
  });
});

describe('the history timeline', () => {
  const build = () => {
    let h = startHistory({ pattern: empty, source: null });
    h = change(h, { pattern: one, source: null });
    h = change(h, { pattern: two, source: null });
    return change(h, { pattern: two, source: 'Circle' });
  };

  it('lists every step oldest first, with the current one marked, and keeps undone steps', () => {
    const h = undo(build(), 2);
    const { steps, current } = timeline(h);
    expect(steps.map((s) => s.pattern)).toEqual([empty, one, two, two]);
    expect(current).toBe(1);
    expect(steps[current]).toBe(h.now);
  });

  it('jumps back or forward to any step, and to the same step does nothing', () => {
    const h = build();
    const back = jumpTo(h, 0);
    expect(back.now.pattern).toEqual(empty);
    expect(back.future).toHaveLength(3);
    expect(jumpTo(back, 3)).toEqual(h);
    expect(jumpTo(back, 2).now.pattern).toEqual(two);
    expect(jumpTo(h, 3)).toBe(h);
  });

  it('clearing the history keeps the preview showing as the only step, and forgets undone steps too', () => {
    const h = undo(build(), 1);
    const cleared = clearHistory(h);
    expect(cleared.now).toBe(h.now);
    expect(timeline(cleared)).toEqual({ steps: [h.now], current: 0 });
    expect(undo(cleared)).toBe(cleared);
    expect(redo(cleared)).toBe(cleared);
    expect(clearHistory(cleared)).toBe(cleared);
  });

  it('describes each step from the one before it', () => {
    const { steps } = timeline(build());
    expect(describeStep(undefined, steps[0])).toEqual({ kind: 'start', text: 'Start' });
    expect(describeStep(undefined, steps[0], true).text).toBe('Oldest kept');
    expect(describeStep(steps[0], steps[1])).toEqual({ kind: 'raise', text: 'Raised row 1, column 1' });
    expect(describeStep(steps[1], steps[0])).toEqual({ kind: 'lower', text: 'Lowered row 1, column 1' });
    expect(describeStep(steps[2], steps[3])).toEqual({ kind: 'source', text: 'Circle' });
    expect(describeStep(steps[2], { pattern: empty, source: null })).toEqual({ kind: 'clear', text: 'Cleared' });
    const many = togglePin(togglePin(two, 4, 5), 3, 3);
    expect(describeStep(steps[2], { pattern: many, source: null })).toEqual({ kind: 'edit', text: '2 pins changed' });
  });
});
