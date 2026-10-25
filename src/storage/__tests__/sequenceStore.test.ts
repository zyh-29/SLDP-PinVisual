import { cellsToString, createEmptyPattern, togglePin } from '@/domain/pattern';
import type { KeyValueStore } from '../patternStore';
import {
  MAX_STEPS,
  nextStep,
  parseStoredSequences,
  previousStep,
  SEQUENCE_STORAGE_KEY,
  SequenceStore,
  type SequenceStep,
  stepPattern,
} from '../sequenceStore';

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

const step = (name: string, row: number): SequenceStep => {
  const p = togglePin(createEmptyPattern(5, 6), row, 0);
  return { name, rows: 5, cols: 6, cells: cellsToString(p) };
};

describe('SequenceStore', () => {
  it('saves, lists newest first, and keeps each step\'s pins', async () => {
    let t = 1;
    const store = new SequenceStore(memoryKv(), () => t++);
    await store.save('Shapes', [step('Circle', 0), step('Square', 1)]);
    await store.save('  Letters  ', [step('A', 2)]);
    const { sequences, skipped } = await store.list();
    expect(skipped).toBe(0);
    expect(sequences.map((s) => s.name)).toEqual(['Letters', 'Shapes']);
    expect(sequences[1].steps.map((s) => s.name)).toEqual(['Circle', 'Square']);
    expect(stepPattern(sequences[1].steps[1])?.cells[6]).toBe(1);
  });

  it('edits a sequence in place by id, keeping its creation time', async () => {
    let t = 10;
    const store = new SequenceStore(memoryKv(), () => t++);
    const first = await store.save('Shapes', [step('Circle', 0)]);
    const edited = await store.save('Shapes 2', [step('Circle', 0), step('Line', 3)], first.id);
    const { sequences } = await store.list();
    expect(sequences).toHaveLength(1);
    expect(edited).toMatchObject({ id: first.id, name: 'Shapes 2', createdAt: first.createdAt });
    expect(sequences[0].steps).toHaveLength(2);
  });

  it('refuses a name another sequence has, no steps, or too many steps', async () => {
    const store = new SequenceStore(memoryKv());
    await store.save('Shapes', [step('Circle', 0)]);
    await expect(store.save('shapes', [step('Circle', 0)])).rejects.toThrow('already exists');
    await expect(store.save('Empty', [])).rejects.toThrow('at least one');
    await expect(store.save('Long', Array.from({ length: MAX_STEPS + 1 }, () => step('x', 0)))).rejects.toThrow(`${MAX_STEPS}`);
    await expect(store.save('  ', [step('Circle', 0)])).rejects.toThrow('Enter a name');
  });

  it('deletes', async () => {
    const store = new SequenceStore(memoryKv());
    const s = await store.save('Shapes', [step('Circle', 0)]);
    await store.remove(s.id);
    expect((await store.list()).sequences).toEqual([]);
  });

  it('skips damaged records instead of losing everything', () => {
    const good = { id: 'a', name: 'Good', steps: [step('x', 0)], createdAt: 1, updatedAt: 1 };
    const badPins = { ...good, id: 'b', steps: [{ name: 'x', rows: 5, cols: 6, cells: '01' }] };
    const noSteps = { ...good, id: 'c', steps: [] };
    const res = parseStoredSequences(JSON.stringify([good, badPins, noSteps, 'junk']));
    expect(res.sequences.map((s) => s.id)).toEqual(['a']);
    expect(res.skipped).toBe(3);
    expect(parseStoredSequences('{not json')).toEqual({ sequences: [], skipped: 1 });
    expect(parseStoredSequences(null)).toEqual({ sequences: [], skipped: 0 });
  });

  it('is stored apart from saved patterns', async () => {
    const kv = memoryKv();
    await new SequenceStore(kv).save('Shapes', [step('Circle', 0)]);
    expect(Object.keys(kv.data)).toEqual([SEQUENCE_STORAGE_KEY]);
  });
});

describe('stepping through a sequence', () => {
  it('stops at the end, or goes back to the start when looping', () => {
    expect(nextStep(0, 3, false)).toBe(1);
    expect(nextStep(2, 3, false)).toBeNull();
    expect(nextStep(2, 3, true)).toBe(0);
    expect(nextStep(0, 1, true)).toBe(0);
  });

  it('goes back, staying on the first step unless looping', () => {
    expect(previousStep(2, 3, false)).toBe(1);
    expect(previousStep(0, 3, false)).toBe(0);
    expect(previousStep(0, 3, true)).toBe(2);
  });
});
