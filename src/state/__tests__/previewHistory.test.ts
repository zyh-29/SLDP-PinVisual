import { createEmptyPattern, togglePin } from '@/domain/pattern';
import { change, MAX_UNDO, startHistory, undo } from '../previewHistory';

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
});
