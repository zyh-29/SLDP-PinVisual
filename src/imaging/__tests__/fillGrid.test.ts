import { fillGrid, OBJECT_MAX_STRETCH } from '../pinSampling';

// The grid is 6 x 5 pins (aspect 1.2).
const fill = (w: number, h: number) => fillGrid({ x: 100, y: 100, width: w, height: h }, 5, 6, 1);

describe('an object from a photo fills the pins, stretched up to a limit', () => {
  it('a car side-on (3.4 x wider than tall): stretched by the most allowed, centred on the car', () => {
    const b = fill(340, 100);
    expect(b.width).toBe(340);
    // Stretch = (340 / height) / 1.2 = the limit.
    expect(340 / b.height / 1.2).toBeCloseTo(OBJECT_MAX_STRETCH);
    expect(b.y + b.height / 2).toBeCloseTo(150);
    // It fills about 4 of the 5 rows (100 of 129 px), where unstretched it had 1.8.
    expect(100 / b.height).toBeGreaterThan(0.75);
  });

  it('a car seen from the front, close to the grid’s shape: fills it all, as it is', () => {
    expect(fill(160, 100)).toEqual({ x: 100, y: 100, width: 160, height: 100 });
  });

  it('a tall thing (a person): widened the same way', () => {
    const b = fill(40, 200);
    expect(b.height).toBe(200);
    expect((b.width / 200) * (1 / 1.2) * OBJECT_MAX_STRETCH).toBeCloseTo(1);
    expect(b.x + b.width / 2).toBeCloseTo(120);
  });
});
