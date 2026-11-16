import { cellPattern, describeCell, dotPositions, toBraille } from '../braille';

const dots = (text: string) => toBraille(text).cells.map((c) => c.dots.join(''));
const names = (text: string) => toBraille(text).cells.map((c) => c.name);

describe('text to braille (UEB, uncontracted)', () => {
  it('spells letters', () => {
    expect(dots('abc')).toEqual(['1', '12', '14']);
    expect(dots('w')).toEqual(['2456']);
    expect(dots('z')).toEqual(['1356']);
  });

  it('marks a capital letter, and a word in capitals once', () => {
    expect(names('Hi')).toEqual(['capital sign', 'h', 'i']);
    expect(dots('OK go')).toEqual(['6', '6', '135', '13', '', '1245', '135']);
    expect(names('A')).toEqual(['capital sign', 'a']);
  });

  it('writes numbers with a number sign, and marks a letter a to j straight after one', () => {
    expect(names('42')).toEqual(['number sign', '4', '2']);
    expect(dots('42')).toEqual(['3456', '145', '12']);
    expect(names('3.5')).toEqual(['number sign', '3', 'decimal point', '5']);
    expect(names('2b')).toEqual(['number sign', '2', 'letter sign', 'b']);
    expect(names('2x')).toEqual(['number sign', '2', 'x']);
    expect(names('1 a')).toEqual(['number sign', '1', 'space', 'a']);
  });

  it('punctuation and spaces', () => {
    expect(names('Hi, you!')).toEqual(['capital sign', 'h', 'i', 'comma', 'space', 'y', 'o', 'u', 'exclamation mark']);
    expect(names('"no"')).toEqual(['opening quote', 'n', 'o', 'closing quote']);
    expect(names('  a   b  ')).toEqual(['a', 'space', 'b']);
  });

  it('knows which word each cell spells', () => {
    const b = toBraille('Hi  there 42');
    expect(b.words).toEqual(['Hi', 'there', '42']);
    expect(b.cells.map((c) => c.word ?? '_').join('')).toBe('000_11111_222');
  });

  it('leaves out what it has no braille for, and says so', () => {
    expect(toBraille('a€b')).toMatchObject({ skipped: ['€'] });
    expect(names('a€b')).toEqual(['a', 'b']);
  });
});

describe('a braille cell on the pins', () => {
  it('on 3 × 3: the two dot columns a pin apart', () => {
    const p = cellPattern({ dots: [1, 2, 5], name: 'h' }, 3, 3);
    expect(p.cells.join('')).toBe(['100', '101', '000'].join(''));
    expect(cellPattern({ dots: [1, 2, 3, 4, 5, 6], name: 'all' }, 3, 3).cells.join('')).toBe('101101101');
  });

  it('on a bigger grid: in the middle', () => {
    expect(dotPositions(5, 6)).toMatchObject({ 1: { row: 1, col: 2 }, 6: { row: 3, col: 3 } });
  });

  it('not at all on a grid smaller than a cell', () => {
    expect(dotPositions(2, 3)).toBeNull();
    expect(cellPattern({ dots: [1], name: 'a' }, 2, 3).cells.every((v) => v === 0)).toBe(true);
  });

  it('is described for a screen reader', () => {
    expect(describeCell({ dots: [1, 2, 5], name: 'h' })).toBe('h, dots 1 2 5');
    expect(describeCell({ dots: [1], name: 'a' })).toBe('a, dot 1');
    expect(describeCell({ dots: [], name: 'space' })).toBe('space, no dots');
  });
});
