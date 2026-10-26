import { graphRangeLabel, graphRangeText, MAX_RANGE_UNITS, panStep, parseGraphRange, rangeWidth, sameGraphRange } from '../graphRange';

const range = (text: string) => {
  const r = parseGraphRange(text);
  return 'range' in r ? r.range : r.error;
};

describe('typing a graph range', () => {
  it('a number alone, or with ± (typed as +- or +/-), is both sides', () => {
    for (const t of ['5', '±5', '+-5', '+/-5', '-+5', ' ± 5 ', '+ - 5'])
      expect(range(t)).toEqual({ kind: 'window', units: 5, side: 'both' });
  });

  it('+ is the right side, - (or a typed minus or dash) the left', () => {
    expect(range('+3')).toEqual({ kind: 'window', units: 3, side: 'right' });
    for (const t of ['-3', '−3', '–3', '- 3']) expect(range(t)).toEqual({ kind: 'window', units: 3, side: 'left' });
  });

  it('decimals', () => {
    expect(range('2.5')).toEqual({ kind: 'window', units: 2.5, side: 'both' });
    expect(range('+.5')).toEqual({ kind: 'window', units: 0.5, side: 'right' });
    expect(range('4.')).toEqual({ kind: 'window', units: 4, side: 'both' });
  });

  it('empty or "auto" is Auto; "whole" or "all" the whole curve', () => {
    expect(range('')).toEqual({ kind: 'auto' });
    expect(range('  Auto ')).toEqual({ kind: 'auto' });
    expect(range('Whole')).toEqual({ kind: 'whole' });
    expect(range('all')).toEqual({ kind: 'whole' });
  });

  it('says what is wrong instead of guessing', () => {
    for (const t of ['abc', '5x', '+', '±', '1/2', '--5', '5-', '1e3']) expect(range(t)).toMatch(/Type a number/);
    expect(range('0')).toMatch(/above 0/);
    expect(range('+0.0')).toMatch(/above 0/);
    expect(range(String(MAX_RANGE_UNITS * 2))).toMatch(/or less/);
  });

  it('written back as typed, and for reading', () => {
    for (const t of ['', 'whole', '±5', '+5', '-2.5']) {
      const r = parseGraphRange(t);
      expect('range' in r && graphRangeText(r.range)).toBe(t);
    }
    expect(graphRangeLabel({ kind: 'window', units: 2, side: 'left' })).toBe('−2');
    expect(graphRangeLabel({ kind: 'auto' })).toBe('Auto');
  });

  it('the same range typed differently is the same (no new work for "5" then "5.0")', () => {
    const a = parseGraphRange('5');
    const b = parseGraphRange('+-5.0');
    expect('range' in a && 'range' in b && sameGraphRange(a.range, b.range)).toBe(true);
    expect(sameGraphRange({ kind: 'window', units: 5, side: 'both' }, { kind: 'window', units: 5, side: 'right' })).toBe(false);
    expect(sameGraphRange({ kind: 'auto' }, { kind: 'whole' })).toBe(false);
  });
});

describe('window width and arrow steps', () => {
  it('± covers twice the units, one side once', () => {
    expect(rangeWidth({ units: 5, side: 'both' })).toBe(10);
    expect(rangeWidth({ units: 5, side: 'right' })).toBe(5);
  });

  it('a round step of about a fifth of the width', () => {
    expect(panStep({ units: 2, side: 'both' })).toBe(1);
    expect(panStep({ units: 5, side: 'both' })).toBe(2);
    expect(panStep({ units: 10, side: 'both' })).toBe(5);
    expect(panStep({ units: 5, side: 'right' })).toBe(1);
    expect(panStep({ units: 0.5, side: 'both' })).toBe(0.2);
    expect(panStep({ units: 250, side: 'both' })).toBe(100);
  });
});
