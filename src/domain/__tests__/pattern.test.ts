import {
  cellsFromString,
  cellsToString,
  createEmptyPattern,
  fitPatternToGrid,
  getPin,
  packPins,
  pinIndex,
  pinPosition,
  servoForPin,
  togglePin,
  unpackPins,
  validatePattern,
} from '../pattern';

describe('pin ordering', () => {
  it('is row-major from the top-left', () => {
    expect(pinIndex(0, 0, 8)).toBe(0);
    expect(pinIndex(0, 7, 8)).toBe(7);
    expect(pinIndex(1, 0, 8)).toBe(8);
    expect(pinIndex(4, 7, 8)).toBe(39);
    expect(pinPosition(13, 8)).toEqual({ row: 1, col: 5 });
  });

  it('packs pin i into byte i/8, bit i%8, LSB first', () => {
    let p = createEmptyPattern(5, 8);
    p = togglePin(p, 0, 0); // index 0  -> byte 0 bit 0
    p = togglePin(p, 0, 7); // index 7  -> byte 0 bit 7
    p = togglePin(p, 1, 1); // index 9  -> byte 1 bit 1
    p = togglePin(p, 4, 7); // index 39 -> byte 4 bit 7
    expect(Array.from(packPins(p))).toEqual([0x81, 0x02, 0x00, 0x00, 0x80]);
  });

  it('pads unused trailing bits with zeros and round-trips', () => {
    let p = createEmptyPattern(3, 3); // 9 pins -> 2 bytes
    p = togglePin(p, 2, 2); // index 8 -> byte 1 bit 0
    const bytes = packPins(p);
    expect(Array.from(bytes)).toEqual([0x00, 0x01]);
    expect(unpackPins(bytes, 3, 3)).toEqual(p);
  });

  it('maps pins to suggested PCA9685 channels', () => {
    expect(servoForPin(0)).toEqual({ board: 0, i2cAddress: 0x40, channel: 0 });
    expect(servoForPin(15)).toEqual({ board: 0, i2cAddress: 0x40, channel: 15 });
    expect(servoForPin(16)).toEqual({ board: 1, i2cAddress: 0x41, channel: 0 });
    expect(servoForPin(39)).toEqual({ board: 2, i2cAddress: 0x42, channel: 7 });
  });
});

describe('pattern editing', () => {
  it('toggles a single pin without mutating the original', () => {
    const p = createEmptyPattern(2, 2);
    const q = togglePin(p, 1, 0);
    expect(getPin(p, 1, 0)).toBe(0);
    expect(getPin(q, 1, 0)).toBe(1);
    expect(getPin(togglePin(q, 1, 0), 1, 0)).toBe(0);
  });

  it('ignores out-of-range toggles', () => {
    const p = createEmptyPattern(2, 2);
    expect(togglePin(p, 5, 0)).toBe(p);
  });

  it('validates shape and values', () => {
    expect(validatePattern(createEmptyPattern(5, 8))).toBeNull();
    expect(validatePattern({ rows: 2, cols: 2, cells: [0, 1, 0] })).toMatch(/Expected 4/);
    expect(validatePattern({ rows: 1, cols: 2, cells: [0, 2 as 0] })).toMatch(/invalid value/);
    expect(validatePattern({ rows: 0, cols: 2, cells: [] })).toMatch(/Invalid grid/);
  });

  it('serialises to a 0/1 string and back', () => {
    const p = togglePin(createEmptyPattern(2, 3), 0, 1);
    expect(cellsToString(p)).toBe('010000');
    expect(cellsFromString('010000', 2, 3)).toEqual(p);
    expect(cellsFromString('0100', 2, 3)).toBeNull();
    expect(cellsFromString('01x000', 2, 3)).toBeNull();
  });

  it('fits a pattern into another grid, centred', () => {
    // 3x3 with a centre pin -> 5x5 keeps it at the centre.
    const small = togglePin(createEmptyPattern(3, 3), 1, 1);
    const big = fitPatternToGrid(small, 5, 5);
    expect(getPin(big, 2, 2)).toBe(1);
    expect(big.cells.filter((v) => v === 1)).toHaveLength(1);
    // And back down again.
    expect(fitPatternToGrid(big, 3, 3)).toEqual(small);
  });
});
