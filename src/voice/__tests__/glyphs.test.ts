import { countRaised } from '@/domain/pattern';
import { CHARACTERS, characterPattern, drawRows, SHAPE_NAMES, shapePattern } from '../glyphs';

describe('pin pictures', () => {
  it('every letter and digit fits the 5 x 6 display and raises pins', () => {
    expect(CHARACTERS).toHaveLength(36);
    for (const ch of CHARACTERS) {
      const pat = characterPattern(ch, 5, 6)!;
      expect(pat.cells).toHaveLength(30);
      expect(countRaised(pat)).toBeGreaterThan(4);
    }
  });

  it('every shape fits and raises pins', () => {
    for (const name of SHAPE_NAMES) expect(countRaised(shapePattern(name, 5, 6))).toBeGreaterThan(4);
  });

  it('centres a narrow picture', () => {
    const pat = drawRows(['#', '#', '#', '#', '#'], 5, 6);
    expect(pat.cells.slice(0, 6)).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it('lower case and unknown characters', () => {
    expect(characterPattern('a', 5, 6)).toEqual(characterPattern('A', 5, 6));
    expect(characterPattern('?', 5, 6)).toBeNull();
  });
});
