import { gridGraph, minCut } from '../maxflow';

/** Cost of a labelling (1 = source side). */
function energy(g: ReturnType<typeof gridGraph>, side: ArrayLike<number>) {
  const { width: W, height: H } = g;
  let e = 0;
  for (let p = 0; p < W * H; p++) {
    e += side[p] ? g.sink[p] : g.source[p];
    const x = p % W;
    if (x + 1 < W && side[p] !== side[p + 1]) e += g.right[p];
    if (p + W < W * H && side[p] !== side[p + W]) e += g.down[p];
  }
  return e;
}

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('min cut on a grid', () => {
  it('matches the best of every possible labelling on small random grids', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = random(seed);
      const W = 2 + Math.floor(rnd() * 3);
      const H = 2 + Math.floor(rnd() * 2);
      const g = gridGraph(W, H);
      for (let p = 0; p < W * H; p++) {
        g.source[p] = rnd() < 0.3 ? 0 : rnd() * 10;
        g.sink[p] = rnd() < 0.3 ? 0 : rnd() * 10;
        g.right[p] = rnd() * 6;
        g.down[p] = rnd() * 6;
      }
      let best = Infinity;
      const lab = new Uint8Array(W * H);
      for (let m = 0; m < 1 << (W * H); m++) {
        for (let p = 0; p < W * H; p++) lab[p] = (m >> p) & 1;
        best = Math.min(best, energy(g, lab));
      }
      const r = minCut(g);
      expect(r.flow).toBeCloseTo(best, 3);
      expect(energy(g, r.side)).toBeCloseTo(best, 3);
    }
  });

  it('separates a noisy square from its background, smoothing the noise away', () => {
    const W = 40;
    const H = 30;
    const g = gridGraph(W, H);
    const rnd = random(7);
    const truth = (p: number) => {
      const x = p % W;
      const y = (p - x) / W;
      return x >= 12 && x < 28 && y >= 8 && y < 22 ? 1 : 0;
    };
    for (let p = 0; p < W * H; p++) {
      // Each pixel's own evidence is right only 70% of the time.
      const says = rnd() < 0.7 ? truth(p) : 1 - truth(p);
      g.source[p] = says ? 2 : 0;
      g.sink[p] = says ? 0 : 2;
      g.right[p] = 1.2;
      g.down[p] = 1.2;
    }
    const { side } = minCut(g);
    let wrong = 0;
    for (let p = 0; p < W * H; p++) if (side[p] !== truth(p)) wrong++;
    expect(wrong / (W * H)).toBeLessThan(0.05);
  });

  it('a big grid is quick', () => {
    const W = 160;
    const H = 120;
    const g = gridGraph(W, H);
    const rnd = random(3);
    for (let p = 0; p < W * H; p++) {
      const x = p % W;
      const inside = Math.hypot(x - 80, (p - x) / W - 60) < 35;
      g.source[p] = (inside ? 3 : 0) + rnd() * 2;
      g.sink[p] = (inside ? 0 : 3) + rnd() * 2;
      g.right[p] = 2;
      g.down[p] = 2;
    }
    const t0 = performance.now();
    minCut(g);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
