import { createEmptyPattern, type Pattern, type PinValue } from '@/domain/pattern';

/**
 * Ready-made pin pictures that can be asked for by name (by voice or typed): simple shapes, letters and digits.
 * Drawn for the 5-row display; a picture narrower than the grid is centred.
 *
 * Letters are 5 rows tall and 3 to 5 pins wide, kept to the bold, open forms that read best by touch (no serifs,
 * nothing a fingertip would feel as a blob). Rows are written top to bottom, '#' for a raised pin.
 */
const LETTERS: Record<string, string[]> = {
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  B: ['###.', '#..#', '###.', '#..#', '###.'],
  C: ['.###', '#...', '#...', '#...', '.###'],
  D: ['###.', '#..#', '#..#', '#..#', '###.'],
  E: ['####', '#...', '###.', '#...', '####'],
  F: ['####', '#...', '###.', '#...', '#...'],
  G: ['.###', '#...', '#.##', '#..#', '.###'],
  H: ['#..#', '#..#', '####', '#..#', '#..#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..##', '...#', '...#', '#..#', '.##.'],
  K: ['#..#', '#.#.', '##..', '#.#.', '#..#'],
  L: ['#...', '#...', '#...', '#...', '####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  P: ['###.', '#..#', '###.', '#...', '#...'],
  Q: ['.##.', '#..#', '#..#', '#.##', '.###'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  S: ['.###', '#...', '.##.', '...#', '###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
  V: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  Z: ['####', '...#', '.##.', '#...', '####'],
};

const DIGITS: Record<string, string[]> = {
  '0': ['.##.', '#..#', '#..#', '#..#', '.##.'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###.', '...#', '.##.', '#...', '####'],
  '3': ['###.', '...#', '.##.', '...#', '###.'],
  '4': ['#..#', '#..#', '####', '...#', '...#'],
  '5': ['####', '#...', '###.', '...#', '###.'],
  '6': ['.##.', '#...', '###.', '#..#', '.##.'],
  '7': ['####', '...#', '..#.', '.#..', '.#..'],
  '8': ['.##.', '#..#', '.##.', '#..#', '.##.'],
  '9': ['.##.', '#..#', '.###', '...#', '.##.'],
};

export type ShapeName =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'cross'
  | 'plus'
  | 'heart'
  | 'smile'
  | 'arrow up'
  | 'arrow down'
  | 'arrow left'
  | 'arrow right'
  | 'horizontal line'
  | 'vertical line'
  | 'checkerboard';

const SHAPES: Record<ShapeName, string[]> = {
  circle: ['.####.', '#....#', '#....#', '#....#', '.####.'],
  square: ['######', '#....#', '#....#', '#....#', '######'],
  triangle: ['..##..', '.#..#.', '.#..#.', '#....#', '######'],
  diamond: ['..##..', '.#..#.', '#....#', '.#..#.', '..##..'],
  cross: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  plus: ['..##..', '..##..', '######', '..##..', '..##..'],
  heart: ['.#..#.', '######', '######', '.####.', '..##..'],
  smile: ['.#..#.', '.#..#.', '......', '#....#', '.####.'],
  'arrow up': ['..##..', '.####.', '#.##.#', '..##..', '..##..'],
  'arrow down': ['..##..', '..##..', '#.##.#', '.####.', '..##..'],
  'arrow left': ['..#...', '.#....', '######', '.#....', '..#...'],
  'arrow right': ['...#..', '....#.', '######', '....#.', '...#..'],
  'horizontal line': ['......', '......', '######', '......', '......'],
  'vertical line': ['..##..', '..##..', '..##..', '..##..', '..##..'],
  checkerboard: ['#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.'],
};

export const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

/** Draws rows of '#' and '.' on an empty grid, centred (a picture larger than the grid is cropped evenly). */
export function drawRows(rows: string[], gridRows: number, gridCols: number): Pattern {
  const out = createEmptyPattern(gridRows, gridCols);
  const cells = out.cells.slice() as PinValue[];
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const top = Math.floor((gridRows - height) / 2);
  const left = Math.floor((gridCols - width) / 2);
  rows.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) {
      const gr = r + top;
      const gc = c + left;
      if (line[c] === '#' && gr >= 0 && gr < gridRows && gc >= 0 && gc < gridCols) cells[gr * gridCols + gc] = 1;
    }
  });
  return { rows: gridRows, cols: gridCols, cells };
}

export function shapePattern(name: ShapeName, rows: number, cols: number): Pattern {
  return drawRows(SHAPES[name], rows, cols);
}

/** A letter (A to Z, either case) or a digit, or null for anything else. */
export function characterPattern(ch: string, rows: number, cols: number): Pattern | null {
  const key = ch.toUpperCase();
  const glyph = LETTERS[key] ?? DIGITS[key];
  return glyph ? drawRows(glyph, rows, cols) : null;
}

export const CHARACTERS = [...Object.keys(LETTERS), ...Object.keys(DIGITS)];
