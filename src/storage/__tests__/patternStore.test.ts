import { createEmptyPattern, togglePin } from '@/domain/pattern';
import { isCompatible, type KeyValueStore, parseStored, PatternStore, STORAGE_KEY, toPattern } from '../patternStore';

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
