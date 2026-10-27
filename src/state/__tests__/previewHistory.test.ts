import { createEmptyPattern, togglePin } from '@/domain/pattern';
import { change, MAX_UNDO, MAX_UNDO_STEPS, parseUndoSteps, redo, redoAll, startHistory, undo, undoAll } from '../previewHistory';

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

describe('typing how many steps to undo', () => {
  it('a whole number from 1; empty means 1', () => {
    expect(parseUndoSteps('')).toBe(1);
    expect(parseUndoSteps(' 3 ')).toBe(3);
    expect(parseUndoSteps('999')).toBe(MAX_UNDO_STEPS);
  });

  it('anything else is not a number of steps', () => {
    for (const t of ['0', '-2', '2.5', 'abc', '3x']) expect(parseUndoSteps(t)).toBeNull();
  });
});
