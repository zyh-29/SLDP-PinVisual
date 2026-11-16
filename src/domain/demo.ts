import { GRID } from '@/config/hardware';
import { createEmptyPattern, getPin, type Pattern, pinIndex } from './pattern';

/** The Demo tab's grid: 3 × 3 pins. */
export const DEMO_SIZE = 3;

/** An empty 3 × 3 demo pattern. */
export function emptyDemo(): Pattern {
  return createEmptyPattern(DEMO_SIZE, DEMO_SIZE);
}

/**
 * The full-board pattern for a 3 × 3 demo: the demo fills the board's top-left corner and every other pin is lowered.
 * The board only accepts patterns the size of its own grid, so the demo can't be sent on its own.
 */
export function demoToBoard(demo: Pattern): Pattern {
  const board = createEmptyPattern(GRID.rows, GRID.cols);
  const cells = board.cells.slice();
  for (let r = 0; r < Math.min(demo.rows, GRID.rows); r++) {
    for (let c = 0; c < Math.min(demo.cols, GRID.cols); c++) {
      cells[pinIndex(r, c, GRID.cols)] = getPin(demo, r, c);
    }
  }
  return { ...board, cells };
}

/** Whether a pattern the board confirmed shows `demo` (null: nothing confirmed yet). */
export function boardShowsDemo(board: Pattern | null, demo: Pattern): boolean {
  if (!board || board.rows !== GRID.rows || board.cols !== GRID.cols) return false;
  const want = demoToBoard(demo);
  return want.cells.every((v, i) => board.cells[i] === v);
}
