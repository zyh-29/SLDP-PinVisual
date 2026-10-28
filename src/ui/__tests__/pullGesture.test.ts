import { isPull, PULL_MAX, PULL_TRIGGER, resist } from '../pullGesture';

describe('pull to refresh (website)', () => {
  it('counts only a mostly-downward drag with the page at its top', () => {
    expect(isPull(0, 30, 0)).toBe(true);
    expect(isPull(10, 30, 0)).toBe(true);
    expect(isPull(0, 30, 5)).toBe(false); // scrolled down: a normal scroll
    expect(isPull(0, -30, 0)).toBe(false); // up
    expect(isPull(40, 30, 0)).toBe(false); // mostly sideways (the timeline, a scrolling grid)
  });

  it('the indicator follows less and less, never past the maximum, and a long pull reaches the reload point', () => {
    expect(resist(0)).toBe(0);
    expect(resist(-20)).toBe(0);
    expect(resist(40)).toBeLessThan(40);
    expect(resist(100) - resist(50)).toBeGreaterThan(resist(300) - resist(250));
    expect(resist(10000)).toBeLessThanOrEqual(PULL_MAX);
    expect(resist(200)).toBeGreaterThanOrEqual(PULL_TRIGGER);
    expect(resist(60)).toBeLessThan(PULL_TRIGGER); // a short tug doesn't reload
  });
});
