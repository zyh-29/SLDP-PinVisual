import { GRID } from '@/config/hardware';
import { countRaised, getPin, togglePin } from '../pattern';
import { boardShowsDemo, DEMO_SIZE, demoToBoard, emptyDemo } from '../demo';

describe('Demo: a 3 × 3 grid in the board’s top-left corner', () => {
  it('starts with every pin lowered', () => {
    const d = emptyDemo();
    expect([d.rows, d.cols]).toEqual([DEMO_SIZE, DEMO_SIZE]);
    expect(countRaised(d)).toBe(0);
  });

  it('sends a full-board pattern with the demo top-left and everything else down', () => {
    const d = togglePin(togglePin(emptyDemo(), 0, 0), 2, 2);
    const board = demoToBoard(d);
    expect([board.rows, board.cols]).toEqual([GRID.rows, GRID.cols]);
    expect(countRaised(board)).toBe(2);
    expect(getPin(board, 0, 0)).toBe(1);
    expect(getPin(board, 2, 2)).toBe(1);
  });

  it('tells whether the board confirmed the demo', () => {
    const d = togglePin(emptyDemo(), 1, 1);
    expect(boardShowsDemo(null, d)).toBe(false);
    expect(boardShowsDemo(demoToBoard(d), d)).toBe(true);
    expect(boardShowsDemo(demoToBoard(emptyDemo()), d)).toBe(false);
  });
});
