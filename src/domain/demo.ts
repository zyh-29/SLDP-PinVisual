import { GRID } from '@/config/hardware';
import { createEmptyPattern, type Pattern, patternsEqual } from './pattern';

/** An empty pattern for the Demo tab (the board's grid, 3 × 3). */
export function emptyDemo(): Pattern {
  return createEmptyPattern(GRID.rows, GRID.cols);
}

/** Whether the pattern the board confirmed is `demo` (null: nothing confirmed yet). */
export function boardShowsDemo(board: Pattern | null, demo: Pattern): boolean {
  return board !== null && patternsEqual(board, demo);
}
