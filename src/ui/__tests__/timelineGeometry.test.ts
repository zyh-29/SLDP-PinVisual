import { EDGE, EDGE_SPEED, edgeSpeed, headX, stepAt } from '../timelineGeometry';

describe('dragging the timeline playhead', () => {
  it('scrolls left near the left end, right near the right end, not in between', () => {
    expect(edgeSpeed(EDGE - 1, 300)).toBeLessThan(0);
    expect(edgeSpeed(300 - EDGE + 1, 300)).toBeGreaterThan(0);
    expect(edgeSpeed(150, 300)).toBe(0);
  });

  it('faster nearer the edge, and full speed at or past it (the finger off the strip)', () => {
    expect(-edgeSpeed(EDGE - 4, 300)).toBeLessThan(-edgeSpeed(4, 300));
    expect(edgeSpeed(0, 300)).toBe(-EDGE_SPEED);
    expect(edgeSpeed(-80, 300)).toBe(-EDGE_SPEED);
    expect(edgeSpeed(400, 300)).toBe(EDGE_SPEED);
  });

  it('before the strip is laid out, never scrolls', () => {
    expect(edgeSpeed(0, 0)).toBe(0);
  });

  it('picks the step nearest the finger, never past either end', () => {
    expect(stepAt(-500, 20)).toBe(0);
    expect(stepAt(100000, 20)).toBe(20);
    // Each step's own playhead spot gives that step.
    for (let i = 0; i <= 20; i++) expect(stepAt(headX(i), 20)).toBe(i);
  });
});
