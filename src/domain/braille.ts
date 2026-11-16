import { createEmptyPattern, type Pattern, type PinValue } from './pattern';

/**
 * Text as braille cells, one cell at a time on the pins: Unified English Braille, uncontracted (grade 1), the
 * letter-by-letter braille learners start with.
 *
 * A cell has six dots in two columns of three: 1, 2, 3 down the left and 4, 5, 6 down the right.
 */
export type Dot = 1 | 2 | 3 | 4 | 5 | 6;

export interface BrailleCell {
  /** Raised dots, in order. Empty for a space. */
  dots: Dot[];
  /** What the cell stands for, as said aloud: "h", "capital sign", "number sign", "space". */
  name: string;
  /** Which of the text's words (see BrailleText.words) the cell is part of; none for a space. */
  word?: number;
}

const LETTER_DOTS: Record<string, Dot[]> = {
  a: [1],
  b: [1, 2],
  c: [1, 4],
  d: [1, 4, 5],
  e: [1, 5],
  f: [1, 2, 4],
  g: [1, 2, 4, 5],
  h: [1, 2, 5],
  i: [2, 4],
  j: [2, 4, 5],
  k: [1, 3],
  l: [1, 2, 3],
  m: [1, 3, 4],
  n: [1, 3, 4, 5],
  o: [1, 3, 5],
  p: [1, 2, 3, 4],
  q: [1, 2, 3, 4, 5],
  r: [1, 2, 3, 5],
  s: [2, 3, 4],
  t: [2, 3, 4, 5],
  u: [1, 3, 6],
  v: [1, 2, 3, 6],
  w: [2, 4, 5, 6],
  x: [1, 3, 4, 6],
  y: [1, 3, 4, 5, 6],
  z: [1, 3, 5, 6],
};

/** Digits are the letters a to j after a number sign: 1 is a, 0 is j. */
const DIGIT_LETTER: Record<string, string> = { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e', '6': 'f', '7': 'g', '8': 'h', '9': 'i', '0': 'j' };

const PUNCTUATION: Record<string, BrailleCell> = {
  ',': { dots: [2], name: 'comma' },
  ';': { dots: [2, 3], name: 'semicolon' },
  ':': { dots: [2, 5], name: 'colon' },
  '.': { dots: [2, 5, 6], name: 'full stop' },
  '!': { dots: [2, 3, 5], name: 'exclamation mark' },
  '?': { dots: [2, 3, 6], name: 'question mark' },
  "'": { dots: [3], name: 'apostrophe' },
  '’': { dots: [3], name: 'apostrophe' },
  '-': { dots: [3, 6], name: 'hyphen' },
};

const CAPITAL: BrailleCell = { dots: [6], name: 'capital sign' };
const NUMBER: BrailleCell = { dots: [3, 4, 5, 6], name: 'number sign' };
/** After a number, a letter a to j would read as a digit: this says "a letter again". */
const GRADE_1: BrailleCell = { dots: [5, 6], name: 'letter sign' };
const SPACE: BrailleCell = { dots: [], name: 'space' };

/** Double quotes open with dots 2 3 6 and close with 3 5 6. */
const OPEN_QUOTE: BrailleCell = { dots: [2, 3, 6], name: 'opening quote' };
const CLOSE_QUOTE: BrailleCell = { dots: [3, 5, 6], name: 'closing quote' };

export interface BrailleText {
  cells: BrailleCell[];
  /** The text's words (anything between spaces), as typed. */
  words: string[];
  /** Characters with no braille here (left out), each once. */
  skipped: string[];
}

/** Text as uncontracted braille cells. */
export function toBraille(text: string): BrailleText {
  const cells: BrailleCell[] = [];
  const words: string[] = [];
  const add = (...c: BrailleCell[]) => cells.push(...c.map((x) => (x === SPACE ? x : { ...x, word: words.length - 1 })));
  const skipped = new Set<string>();
  let numeric = false;
  let quoteOpen = false;
  const chars = [...text.normalize('NFC')];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      // Several spaces read as one; none at the start.
      if (cells.length && cells[cells.length - 1] !== SPACE) cells.push(SPACE);
      numeric = false;
      continue;
    }
    if (i === 0 || /\s/.test(chars[i - 1])) words.push(chars.slice(i).join('').split(/\s/)[0]);
    if (/[0-9]/.test(ch)) {
      if (!numeric) add(NUMBER);
      numeric = true;
      add({ dots: LETTER_DOTS[DIGIT_LETTER[ch]], name: ch });
      continue;
    }
    // A full stop or comma between digits is part of the number (3.5, 1,000).
    if ((ch === '.' || ch === ',') && numeric && /[0-9]/.test(chars[i + 1] ?? '')) {
      add({ ...PUNCTUATION[ch], name: ch === '.' ? 'decimal point' : 'comma' });
      continue;
    }
    const lower = ch.toLowerCase();
    if (LETTER_DOTS[lower]) {
      if (numeric && 'abcdefghij'.includes(lower)) add(GRADE_1);
      numeric = false;
      if (ch !== lower) {
        // A word in capitals (two letters or more) starts with the capital word sign (dot 6 twice) instead of a
        // capital sign before each letter.
        const word = wordAt(chars, i);
        if (!word.allCaps) add(CAPITAL);
        else if (word.start === i)
          add({ dots: [6], name: 'capital word sign, first cell' }, { dots: [6], name: 'capital word sign, second cell' });
      }
      add({ dots: LETTER_DOTS[lower], name: lower });
      continue;
    }
    numeric = false;
    if (ch === '"' || ch === '“' || ch === '”') {
      const opening: boolean = ch === '“' || (ch === '"' && !quoteOpen);
      add(opening ? OPEN_QUOTE : CLOSE_QUOTE);
      quoteOpen = opening;
      continue;
    }
    if (PUNCTUATION[ch]) {
      add(PUNCTUATION[ch]);
      continue;
    }
    skipped.add(ch);
  }
  if (cells[cells.length - 1] === SPACE) cells.pop();
  return { cells, words, skipped: [...skipped] };
}

/** The run of letters around `i`: where it starts, and whether it's two or more capitals. */
function wordAt(chars: string[], i: number): { start: number; allCaps: boolean } {
  const letter = (c: string | undefined) => !!c && /[a-z]/i.test(c);
  let start = i;
  while (letter(chars[start - 1])) start--;
  let end = i;
  while (letter(chars[end])) end++;
  const word = chars.slice(start, end).join('');
  return { start, allCaps: word.length > 1 && word === word.toUpperCase() };
}

/**
 * Where a cell's dots go on the grid: the dots' three rows in the middle three rows, and their two columns side by
 * side, as in printed braille. On a 3-column grid that's the left and middle columns (dots 1 2 3 left, 4 5 6 in
 * the middle) and the right column stays down; on wider grids, the middle two columns. Null when the grid is
 * smaller than a cell.
 */
export function dotPositions(rows: number, cols: number): Record<Dot, { row: number; col: number }> | null {
  if (rows < 3 || cols < 2) return null;
  const top = Math.floor((rows - 3) / 2);
  const left = cols === 3 ? 0 : Math.floor((cols - 2) / 2);
  const right = left + 1;
  return {
    1: { row: top, col: left },
    2: { row: top + 1, col: left },
    3: { row: top + 2, col: left },
    4: { row: top, col: right },
    5: { row: top + 1, col: right },
    6: { row: top + 2, col: right },
  };
}

/** One braille cell on a grid of `rows` by `cols` pins (see dotPositions). */
export function cellPattern(cell: BrailleCell, rows: number, cols: number): Pattern {
  const p = createEmptyPattern(rows, cols);
  const at = dotPositions(rows, cols);
  if (!at) return p;
  const cells = p.cells.slice() as PinValue[];
  for (const d of cell.dots) cells[at[d].row * cols + at[d].col] = 1;
  return { ...p, cells };
}

/** "h, dots 1 2 5", or "space, no dots", as a screen reader should say it. */
export function describeCell(cell: BrailleCell): string {
  return `${cell.name}, ${cell.dots.length ? `dot${cell.dots.length > 1 ? 's' : ''} ${cell.dots.join(' ')}` : 'no dots'}`;
}
