import { parseEquation } from '@/imaging/equation';
import { readSpokenEquation } from '../spokenMath';

const at = (text: string, x: number) => parseEquation(text.replace(/^y = /, ''))(x);

describe('spoken maths', () => {
  it.each([
    ['y equals x squared minus three', 'y = x^2 - 3', 'y equals x squared minus 3'],
    ['x squared', 'y = x^2', 'y equals x squared'],
    ['y = x^2 - 3', 'y = x^2 - 3', 'y equals x squared minus 3'],
    ['sine of x', 'y = sin(x)', 'y equals sine of x'],
    ['sine of x plus one', 'y = sin(x) + 1', 'y equals sine of x, plus 1'],
    ['sine of the quantity x plus one', 'y = sin(x + 1)', 'y equals sine of the quantity x plus 1'],
    ['one over x', 'y = 1 / x', 'y equals 1 over x'],
    ['one over two x', 'y = 1 / (2 * x)', 'y equals 1 over 2 x'],
    ['one over the quantity x plus one', 'y = 1 / (x + 1)', 'y equals 1 over the quantity x plus 1'],
    ['two x plus one', 'y = 2 * x + 1', 'y equals 2 x plus 1'],
    ['x cubed minus x', 'y = x^3 - x', 'y equals x cubed minus x'],
    ['x to the power of four', 'y = x^4', 'y equals x to the power 4'],
    ['x to the fourth', 'y = x^4', 'y equals x to the power 4'],
    ['square root of x', 'y = sqrt(x)', 'y equals the square root of x'],
    ['absolute value of x', 'y = abs(x)', 'y equals the absolute value of x'],
    ['f of x equals negative x squared', 'y = -(x^2)', 'y equals negative x squared'],
    ['y equals one half x', 'y = 0.5 * x', 'y equals 0.5 x'],
    ['y equals two point five x', 'y = 2.5 * x', 'y equals 2.5 x'],
    ['y equals twenty five minus x squared', 'y = 25 - x^2', 'y equals 25 minus x squared'],
    ['cosine of two x', 'y = cos(2 * x)', 'y equals cosine of 2 x'],
    ['co sign of x', 'y = cos(x)', 'y equals cosine of x'],
    ['three sine of x', 'y = 3 * sin(x)', 'y equals 3 sine of x'],
    ['natural log of x', 'y = ln(x)', 'y equals the natural log of x'],
    ['e to the x', 'y = exp(x)', 'y equals e to the x'],
    ['sin(2x)', 'y = sin(2 * x)', 'y equals sine of 2 x'],
    ['pi x', 'y = pi * x', 'y equals pi x'],
  ])('%s', (said, text, words) => {
    const r = readSpokenEquation(said);
    expect(r.text).toBe(text);
    expect(r.words).toBe(words);
  });

  it('every result is drawable and means the right thing', () => {
    expect(at(readSpokenEquation('one over the quantity x plus one').text, 1)).toBeCloseTo(0.5);
    expect(at(readSpokenEquation('sine of x plus one').text, 0)).toBeCloseTo(1);
    expect(at(readSpokenEquation('f of x equals negative x squared').text, 3)).toBeCloseTo(-9);
    expect(at(readSpokenEquation('cube root of x').text, 8)).toBeCloseTo(2);
  });

  it('says what it did not understand', () => {
    expect(() => readSpokenEquation('x banana')).toThrow('“banana” isn\'t part of an equation I know.');
    expect(() => readSpokenEquation('y equals')).toThrow('Say the equation after y equals.');
    expect(() => readSpokenEquation('y equals five')).toThrow('The equation needs an x in it.');
  });
});
