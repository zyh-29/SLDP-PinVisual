import { cellsToString, createEmptyPattern, togglePin } from '@/domain/pattern';
import {
  EXPORT_FORMAT,
  exportFileName,
  exportPatterns,
  isCompatible,
  type KeyValueStore,
  MAX_NAME_LENGTH,
  parseExport,
  parseStored,
  PatternStore,
  STORAGE_KEY,
  toPattern,
} from '../patternStore';

function memoryKv(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    async getItem(k) {
      return data[k] ?? null;
    },
    async setItem(k, v) {
      data[k] = v;
    },
  };
}

describe('PatternStore', () => {
  const p = togglePin(createEmptyPattern(5, 8), 2, 3);

  it('saves, lists, loads and deletes patterns with their dimensions', async () => {
    let t = 1000;
    const store = new PatternStore(memoryKv(), () => t++);
    const saved = await store.save('  Smiley   face ', p);
    expect(saved).toMatchObject({ name: 'Smiley face', rows: 5, cols: 8 });
    await store.save('Arrow', createEmptyPattern(5, 8));

    const { patterns } = await store.list();
    expect(patterns.map((x) => x.name)).toEqual(['Arrow', 'Smiley face']); // newest first
    expect(toPattern(patterns[1])).toEqual(p);

    await store.remove(saved.id);
    expect((await store.list()).patterns.map((x) => x.name)).toEqual(['Arrow']);
  });

  it('refuses duplicate names unless overwriting', async () => {
    const store = new PatternStore(memoryKv());
    const first = await store.save('Box', p);
    await expect(store.save('box', p)).rejects.toThrow(/already exists/);
    const second = await store.save('box', createEmptyPattern(5, 8), { overwrite: true });
    expect(second.id).toBe(first.id);
    expect((await store.list()).patterns).toHaveLength(1);
  });

  it('validates names', async () => {
    const store = new PatternStore(memoryKv());
    await expect(store.save('   ', p)).rejects.toThrow(/Enter a name/);
    await expect(store.save('x'.repeat(41), p)).rejects.toThrow(/40/);
  });

  it('flags patterns saved for a different grid size', async () => {
    const store = new PatternStore(memoryKv());
    const other = await store.save('Wide', createEmptyPattern(6, 10));
    expect(isCompatible(other, 5, 8)).toBe(false);
    expect(isCompatible(other, 6, 10)).toBe(true);
  });

  it('skips corrupt records without losing valid ones', () => {
    const valid = { id: 'a', name: 'A', rows: 1, cols: 2, cells: '01', createdAt: 1, updatedAt: 1 };
    const json = JSON.stringify([valid, { id: 'b', name: 'B', rows: 1, cols: 2, cells: '012' }, null]);
    expect(parseStored(json)).toEqual({ patterns: [valid], skipped: 2 });
    expect(parseStored('not json')).toEqual({ patterns: [], skipped: 1 });
    expect(parseStored(null)).toEqual({ patterns: [], skipped: 0 });
  });

  it('stores under a versioned key', async () => {
    const kv = memoryKv();
    await new PatternStore(kv).save('A', p);
    expect(Object.keys(kv.data)).toEqual([STORAGE_KEY]);
  });
});

describe('export and import', () => {
  const p = togglePin(createEmptyPattern(5, 8), 2, 3);
  const q = togglePin(createEmptyPattern(5, 8), 0, 0);

  it('round-trips: what one device exports, another imports exactly', async () => {
    let t = 1000;
    const a = new PatternStore(memoryKv(), () => t++);
    await a.save('Smiley', p);
    await a.save('Corner', q);
    const file = exportPatterns((await a.list()).patterns);

    const b = new PatternStore(memoryKv());
    const parsed = parseExport(file);
    expect(parsed.skipped).toBe(0);
    expect(await b.importPatterns(parsed.patterns)).toEqual({ added: 2, renamed: 0, duplicates: 0 });
    const got = (await b.list()).patterns;
    expect(got.map((x) => x.name).sort()).toEqual(['Corner', 'Smiley']);
    expect(toPattern(got.find((x) => x.name === 'Smiley')!)).toEqual(p);
  });

  it('never overwrites: identical patterns are skipped, different ones with a taken name are renamed', async () => {
    const store = new PatternStore(memoryKv());
    await store.save('Smiley', p);
    await store.save('Corner', q);
    const other = new PatternStore(memoryKv());
    await other.save('Smiley', p); // identical
    await other.save('corner', p); // same name (any case), different pins
    const res = await store.importPatterns(parseExport(exportPatterns((await other.list()).patterns)).patterns);
    expect(res).toEqual({ added: 1, renamed: 1, duplicates: 1 });
    const names = (await store.list()).patterns.map((x) => x.name).sort();
    expect(names).toEqual(['Corner', 'Smiley', 'corner (2)']);
    // The original "Corner" is untouched.
    expect(toPattern((await store.findByName('Corner'))!)).toEqual(q);
  });

  it('importing the same file twice adds nothing the second time', async () => {
    const src = new PatternStore(memoryKv());
    await src.save('A', p);
    const file = exportPatterns((await src.list()).patterns);
    const dst = new PatternStore(memoryKv());
    await dst.importPatterns(parseExport(file).patterns);
    expect(await dst.importPatterns(parseExport(file).patterns)).toEqual({ added: 0, renamed: 0, duplicates: 1 });
  });

  it('renamed names stay within the length limit and keep counting up', async () => {
    const long = 'x'.repeat(MAX_NAME_LENGTH);
    const store = new PatternStore(memoryKv());
    await store.save(long, p);
    const incoming = [q, createEmptyPattern(5, 8)].map((pat, i) => ({
      id: `in-${i}`,
      name: long,
      rows: 5,
      cols: 8,
      cells: cellsToString(pat),
      createdAt: 1,
      updatedAt: 1,
    }));
    expect((await store.importPatterns(incoming)).renamed).toBe(2);
    const names = (await store.list()).patterns.map((x) => x.name);
    expect(names.every((n) => n.length <= MAX_NAME_LENGTH)).toBe(true);
    expect(names.filter((n) => n.endsWith('(2)') || n.endsWith('(3)'))).toHaveLength(2);
  });

  it('skips damaged records and keeps the rest', () => {
    const file = JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      patterns: [
        { id: 'a', name: 'Good', rows: 5, cols: 8, cells: '0'.repeat(40), createdAt: 1, updatedAt: 1 },
        { id: 'b', name: 'Bad size', rows: 5, cols: 8, cells: '01', createdAt: 1, updatedAt: 1 },
        'nonsense',
      ],
    });
    const res = parseExport(file);
    expect(res.patterns.map((x) => x.name)).toEqual(['Good']);
    expect(res.skipped).toBe(2);
  });

  it('says clearly when a file is not an export, or is from a newer app', () => {
    expect(() => parseExport('not json')).toThrow(/not a PinVisual patterns file/);
    expect(() => parseExport(JSON.stringify({ hello: 'world' }))).toThrow(/not a PinVisual patterns file/);
    expect(() => parseExport(JSON.stringify({ format: EXPORT_FORMAT, version: 99, patterns: [] }))).toThrow(/newer version/);
  });

  it('accepts a bare list of patterns (the raw stored data)', () => {
    const raw = JSON.stringify([{ id: 'a', name: 'Raw', rows: 5, cols: 8, cells: '1'.repeat(40), createdAt: 1, updatedAt: 1 }]);
    expect(parseExport(raw).patterns).toHaveLength(1);
  });

  it('names the file by date', () => {
    expect(exportFileName(new Date(2026, 9, 9))).toBe('pinvisual-patterns-2026-10-09.json');
  });
});
