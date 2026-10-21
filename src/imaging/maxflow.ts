/**
 * Minimum cut on a pixel grid (4 neighbours), by the Boykov-Kolmogorov max-flow algorithm (2004), the standard
 * one for image segmentation: it grows two search trees, from the source and from the sink, and reuses them
 * between augmentations, which on grids is much faster than general max-flow methods. Pure, unit tested.
 *
 * The graph: each pixel is linked to the source (cost of labelling it "sink side") and to the sink (cost of
 * labelling it "source side"), and to its right and lower neighbours (cost of separating them, both ways). The
 * cut of least total cost labels every pixel.
 */

/** Neighbour directions: right, down, left, up. The reverse of d is d ^ 2. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export interface GridGraph {
  width: number;
  height: number;
  /** Source -> pixel capacity. */
  source: Float32Array;
  /** Pixel -> sink capacity. */
  sink: Float32Array;
  /** Capacity between a pixel and its right neighbour (both ways). */
  right: Float32Array;
  /** Capacity between a pixel and its lower neighbour (both ways). */
  down: Float32Array;
}

export function gridGraph(width: number, height: number): GridGraph {
  const n = width * height;
  return { width, height, source: new Float32Array(n), sink: new Float32Array(n), right: new Float32Array(n), down: new Float32Array(n) };
}

const FREE = 0;
const S = 1;
const T = 2;
/** parent: no parent (orphan or free), or linked straight to the terminal. */
const NONE = -1;
const TERMINAL = -2;
const EPS = 1e-7;

/**
 * Solves the cut. Returns 1 per pixel on the source side, 0 on the sink side, and the flow (= the cut's cost).
 */
export function minCut(g: GridGraph): { side: Uint8Array; flow: number } {
  const { width: W, height: H } = g;
  const n = W * H;
  // Residual capacity of the edge from p in direction d.
  const cap = new Float32Array(n * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (x + 1 < W) {
        cap[p * 4] = g.right[p];
        cap[(p + 1) * 4 + 2] = g.right[p];
      }
      if (y + 1 < H) {
        cap[p * 4 + 1] = g.down[p];
        cap[(p + W) * 4 + 3] = g.down[p];
      }
    }
  // Terminal residuals: positive = from the source, negative = to the sink (the part both share flows at once).
  const tr = new Float64Array(n);
  let flow = 0;
  for (let p = 0; p < n; p++) {
    const both = Math.min(g.source[p], g.sink[p]);
    flow += both;
    tr[p] = g.source[p] - g.sink[p];
  }
  const tree = new Uint8Array(n);
  /** Direction from p to its parent, or NONE / TERMINAL. */
  const parent = new Int8Array(n).fill(NONE);
  const neighbour = (p: number, d: number) => {
    const x = p % W;
    const y = (p - x) / W;
    const nx = x + DX[d];
    const ny = y + DY[d];
    return nx < 0 || ny < 0 || nx >= W || ny >= H ? -1 : ny * W + nx;
  };

  const active: number[] = [];
  let head = 0;
  const isActive = new Uint8Array(n);
  const activate = (p: number) => {
    if (!isActive[p]) {
      isActive[p] = 1;
      active.push(p);
    }
  };
  for (let p = 0; p < n; p++) {
    if (tr[p] > EPS) {
      tree[p] = S;
      parent[p] = TERMINAL;
      activate(p);
    } else if (tr[p] < -EPS) {
      tree[p] = T;
      parent[p] = TERMINAL;
      activate(p);
    }
  }

  /** Whether p's chain of parents reaches its terminal (it hasn't been cut off by an augmentation). */
  const rooted = (p: number) => {
    let q = p;
    for (let guard = 0; guard <= n; guard++) {
      const d = parent[q];
      if (d === TERMINAL) return true;
      if (d === NONE) return false;
      q = neighbour(q, d);
    }
    return false;
  };

  const orphans: number[] = [];
  for (;;) {
    // ---- Growth: find an edge joining the two trees.
    let meetS = -1;
    let meetT = -1;
    let meetDir = -1;
    while (head < active.length && meetS < 0) {
      const p = active[head];
      if (!tree[p]) {
        isActive[p] = 0;
        head++;
        continue;
      }
      for (let d = 0; d < 4; d++) {
        const q = neighbour(p, d);
        if (q < 0) continue;
        // Residual in the tree's direction: S trees grow along p -> q, T trees along q -> p.
        const c = tree[p] === S ? cap[p * 4 + d] : cap[q * 4 + (d ^ 2)];
        if (c <= EPS) continue;
        if (!tree[q]) {
          tree[q] = tree[p];
          parent[q] = d ^ 2;
          activate(q);
        } else if (tree[q] !== tree[p]) {
          if (tree[p] === S) {
            meetS = p;
            meetT = q;
            meetDir = d;
          } else {
            meetS = q;
            meetT = p;
            meetDir = d ^ 2;
          }
          break;
        }
      }
      if (meetS < 0) {
        isActive[p] = 0;
        head++;
      }
    }
    if (meetS < 0) break;
    if (head > 4096 && head * 2 > active.length) {
      active.splice(0, head);
      head = 0;
    }

    // ---- Augmentation: push the bottleneck along source -> meetS -> meetT -> sink.
    let bottleneck = cap[meetS * 4 + meetDir];
    for (let p = meetS; ; ) {
      const d = parent[p];
      if (d === TERMINAL) {
        bottleneck = Math.min(bottleneck, tr[p]);
        break;
      }
      const q = neighbour(p, d);
      bottleneck = Math.min(bottleneck, cap[q * 4 + (d ^ 2)]);
      p = q;
    }
    for (let p = meetT; ; ) {
      const d = parent[p];
      if (d === TERMINAL) {
        bottleneck = Math.min(bottleneck, -tr[p]);
        break;
      }
      bottleneck = Math.min(bottleneck, cap[p * 4 + d]);
      p = neighbour(p, d);
    }
    flow += bottleneck;
    cap[meetS * 4 + meetDir] -= bottleneck;
    cap[meetT * 4 + (meetDir ^ 2)] += bottleneck;
    for (let p = meetS; ; ) {
      const d = parent[p];
      if (d === TERMINAL) {
        tr[p] -= bottleneck;
        if (tr[p] <= EPS) {
          parent[p] = NONE;
          orphans.push(p);
        }
        break;
      }
      const q = neighbour(p, d);
      cap[q * 4 + (d ^ 2)] -= bottleneck;
      cap[p * 4 + d] += bottleneck;
      if (cap[q * 4 + (d ^ 2)] <= EPS) {
        parent[p] = NONE;
        orphans.push(p);
      }
      p = q;
    }
    for (let p = meetT; ; ) {
      const d = parent[p];
      if (d === TERMINAL) {
        tr[p] += bottleneck;
        if (tr[p] >= -EPS) {
          parent[p] = NONE;
          orphans.push(p);
        }
        break;
      }
      const q = neighbour(p, d);
      cap[p * 4 + d] -= bottleneck;
      cap[q * 4 + (d ^ 2)] += bottleneck;
      if (cap[p * 4 + d] <= EPS) {
        parent[p] = NONE;
        orphans.push(p);
      }
      p = q;
    }

    // ---- Adoption: find each orphan a new parent in its tree, or free it.
    while (orphans.length) {
      const p = orphans.pop()!;
      const t = tree[p];
      if (!t || parent[p] !== NONE) continue; // already freed or re-adopted
      let adopted = false;
      for (let d = 0; d < 4 && !adopted; d++) {
        const q = neighbour(p, d);
        if (q < 0 || tree[q] !== t) continue;
        const c = t === S ? cap[q * 4 + (d ^ 2)] : cap[p * 4 + d];
        if (c > EPS && rooted(q)) {
          parent[p] = d;
          adopted = true;
        }
      }
      if (adopted) continue;
      for (let d = 0; d < 4; d++) {
        const q = neighbour(p, d);
        if (q < 0 || tree[q] !== t) continue;
        const c = t === S ? cap[q * 4 + (d ^ 2)] : cap[p * 4 + d];
        if (c > EPS) activate(q);
        if (parent[q] === (d ^ 2)) {
          parent[q] = NONE;
          orphans.push(q);
        }
      }
      tree[p] = FREE;
    }
  }

  const side = new Uint8Array(n);
  for (let p = 0; p < n; p++) side[p] = tree[p] === S ? 1 : 0;
  return { side, flow };
}
