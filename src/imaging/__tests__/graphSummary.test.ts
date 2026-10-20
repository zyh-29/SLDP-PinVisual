import type { GraphAxes, GraphScale } from '../graph';
import { graphWindow } from '../graph';
import { describeGraph, graphNumber } from '../graphSummary';

const axes: GraphAxes = { plot: { x: 0, y: 0, width: 1000, height: 800 }, originX: 500, originY: 400, majorX: 40, majorY: 40 };
const scale: GraphScale = { pxPerUnitX: 40, pxPerUnitY: 40, unitsPerMajorX: 1, unitsPerMajorY: 1, majorX: 40, majorY: 40, from: 'labels' };

describe('a graph in words', () => {
  it('a parabola: its lowest point, and the part of the graph on the pins', () => {
    const key = { x: 500, y: 480, place: 'bottom' as const, kind: 'vertex' as const };
    const win = graphWindow(key, scale, 5, axes.plot, 5, 8).box;
    expect(describeGraph({ axes, key, scale, window: win })).toBe('Lowest point at (0, −2). Pins show x from −5 to 5, y from −2.6 to 3.6.');
  });

  it('a line through the y-axis, an axis off screen, and a guessed scale', () => {
    const key = { x: 500, y: 320, place: 'follow' as const, kind: 'intercept' as const };
    expect(describeGraph({ axes, key, scale: { ...scale, from: 'grid' }, window: null })).toBe(
      'Crosses the y-axis at y = 2. Units are a guess: one grid square counts as one.',
    );
    const noY = { ...axes, originY: null };
    expect(describeGraph({ axes: noY, key: { ...key, kind: 'vertex', place: 'top' }, scale, window: null })).toBe('Highest point.');
  });

  it('nothing to say without a scale', () => {
    expect(describeGraph({ axes, key: null, scale: null, window: null })).toBeNull();
  });

  it('numbers to a tenth of the step, with a real minus sign', () => {
    expect(graphNumber(-2.04, 1)).toBe('−2');
    expect(graphNumber(0.25, 0.1)).toBe('0.25');
    expect(graphNumber(-0.001, 1)).toBe('0');
  });
});

describe('moving the graph window', () => {
  it('pans by whole units right and up, even past the plot', () => {
    const key = { x: 500, y: 400, place: 'centre' as const, kind: 'middle' as const };
    const home = graphWindow(key, scale, 5, axes.plot, 5, 8).box;
    const moved = graphWindow(key, scale, 5, axes.plot, 5, 8, 1, { x: 2, y: 1 }).box;
    expect(moved.x - home.x).toBe(80);
    expect(moved.y - home.y).toBe(-40);
    const far = graphWindow(key, scale, 5, axes.plot, 5, 8, 1, { x: 10, y: 0 }).box;
    expect(far.x + far.width).toBeGreaterThan(axes.plot.width);
  });
});
