import { GRID_LIMITS, SERVO_LAYOUT } from '@/config/hardware';

/** 1 = raised, 0 = lowered. */
export type PinValue = 0 | 1;

/**
 * A pin pattern in row-major order.
 * Row 0 is the top row and column 0 the leftmost column, as seen by a person
 * facing the display. cells[row * cols + col] is that pin.
 */
export interface Pattern {
  readonly rows: number;
  readonly cols: number;
  readonly cells: readonly PinValue[];
}

export function pinIndex(row: number, col: number, cols: number): number {
  return row * cols + col;
}

export function pinPosition(index: number, cols: number): { row: number; col: number } {
  return { row: Math.floor(index / cols), col: index % cols };
}

export function isValidDimension(rows: number, cols: number): boolean {
  return (
    Number.isInteger(rows) &&
    Number.isInteger(cols) &&
    rows >= 1 &&
    cols >= 1 &&
    rows <= GRID_LIMITS.maxRows &&
    cols <= GRID_LIMITS.maxCols
  );
}

export function createEmptyPattern(rows: number, cols: number): Pattern {
  if (!isValidDimension(rows, cols)) {
    throw new Error(`Invalid grid size ${rows} x ${cols}`);
  }
  return { rows, cols, cells: new Array<PinValue>(rows * cols).fill(0) };
}

export function getPin(p: Pattern, row: number, col: number): PinValue {
  return p.cells[pinIndex(row, col, p.cols)];
}

export function togglePin(p: Pattern, row: number, col: number): Pattern {
  if (row < 0 || row >= p.rows || col < 0 || col >= p.cols) return p;
  const cells = p.cells.slice();
  const i = pinIndex(row, col, p.cols);
  cells[i] = cells[i] === 1 ? 0 : 1;
  return { ...p, cells };
}

export function countRaised(p: Pattern): number {
  let n = 0;
  for (const v of p.cells) n += v;
  return n;
}

export function patternsEqual(a: Pattern, b: Pattern): boolean {
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
  return true;
}

/** Returns an error message, or null when the pattern is well formed. */
export function validatePattern(p: Pattern): string | null {
  if (!isValidDimension(p.rows, p.cols)) return `Invalid grid size ${p.rows} x ${p.cols}`;
  if (p.cells.length !== p.rows * p.cols) {
    return `Expected ${p.rows * p.cols} pins, got ${p.cells.length}`;
  }
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i] !== 0 && p.cells[i] !== 1) return `Pin ${i} has invalid value ${String(p.cells[i])}`;
  }
  return null;
}

/**
 * Bit-pack pins for the wire: pin i goes to byte floor(i / 8), bit (i % 8),
 * least-significant bit first. Unused trailing bits are 0.
 */
export function packPins(p: Pattern): Uint8Array {
  const out = new Uint8Array(Math.ceil(p.cells.length / 8));
  p.cells.forEach((v, i) => {
    if (v === 1) out[i >> 3] |= 1 << (i & 7);
  });
  return out;
}

export function unpackPins(bytes: Uint8Array, rows: number, cols: number): Pattern {
  const n = rows * cols;
  if (bytes.length !== Math.ceil(n / 8)) {
    throw new Error(`Expected ${Math.ceil(n / 8)} bytes for ${n} pins, got ${bytes.length}`);
  }
  const cells: PinValue[] = [];
  for (let i = 0; i < n; i++) cells.push(((bytes[i >> 3] >> (i & 7)) & 1) as PinValue);
  return { rows, cols, cells };
}

/**
 * Re-fit a pattern into a different grid size, centred: extra rows/columns are
 * cropped evenly from both sides, missing ones are padded with lowered pins.
 */
export function fitPatternToGrid(p: Pattern, rows: number, cols: number): Pattern {
  const out = createEmptyPattern(rows, cols);
  const cells = out.cells.slice();
  const rowOffset = Math.floor((p.rows - rows) / 2);
  const colOffset = Math.floor((p.cols - cols) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sr = r + rowOffset;
      const sc = c + colOffset;
      if (sr >= 0 && sr < p.rows && sc >= 0 && sc < p.cols) {
        cells[pinIndex(r, c, cols)] = getPin(p, sr, sc);
      }
    }
  }
  return { rows, cols, cells };
}

/** Compact '0'/'1' string form used for storage. */
export function cellsToString(p: Pattern): string {
  return p.cells.join('');
}

export function cellsFromString(s: string, rows: number, cols: number): Pattern | null {
  if (!isValidDimension(rows, cols) || s.length !== rows * cols || !/^[01]*$/.test(s)) return null;
  return { rows, cols, cells: Array.from(s, (ch) => (ch === '1' ? 1 : 0)) };
}

/** Suggested servo wiring for a pin index (documentation / mock display only). */
export function servoForPin(index: number): { board: number; i2cAddress: number; channel: number } {
  const board = Math.floor(index / SERVO_LAYOUT.channelsPerBoard);
  return {
    board,
    i2cAddress: SERVO_LAYOUT.firstI2cAddress + board,
    channel: index % SERVO_LAYOUT.channelsPerBoard,
  };
}
