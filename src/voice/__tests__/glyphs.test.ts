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

  it('shapes are solid; their outlines are the same shape, edge only', () => {
    for (const name of ['circle', 'square', 'triangle', 'diamond'] as const) {
      const solid = shapePattern(name, 5, 6);
      const edge = shapePattern(`${name} outline`, 5, 6);
      expect(countRaised(solid)).toBeGreaterThan(countRaised(edge));
      // Every edge pin is part of the solid shape.
      edge.cells.forEach((v, i) => v && expect(solid.cells[i]).toBe(1));
    }
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
