/**
 * Saved sequences: patterns played one after another on the board. Stored on the phone (or in the browser) only,
 * like saved patterns (patternStore.ts). No network.
 *
 * Each step keeps its own copy of the pins, so deleting or replacing a saved pattern later doesn't change a
 * sequence made from it.
 */
import { cellsFromString, type Pattern } from '@/domain/pattern';
import { type KeyValueStore, MAX_NAME_LENGTH, normalizeName, validateName } from './patternStore';

export interface SequenceStep {
  /** The name of the pattern it was made from, shown while playing. */
  name: string;
  rows: number;
  cols: number;
  /** Row-major '0'/'1' string, length rows * cols. */
  cells: string;
}

export interface SavedSequence {
  id: string;
  name: string;
  steps: SequenceStep[];
  createdAt: number;
  updatedAt: number;
}

export const SEQUENCE_STORAGE_KEY = '@pinvisual/sequences/v1';
export const MAX_STEPS = 100;

export function stepPattern(step: SequenceStep): Pattern | null {
  return cellsFromString(step.cells, step.rows, step.cols);
}

function isStep(v: unknown): v is SequenceStep {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    typeof o.rows === 'number' &&
    typeof o.cols === 'number' &&
    typeof o.cells === 'string' &&
    cellsFromString(o.cells, o.rows, o.cols) !== null
  );
}

function isSequence(v: unknown): v is SavedSequence {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.createdAt === 'number' &&
    typeof o.updatedAt === 'number' &&
    Array.isArray(o.steps) &&
    o.steps.length > 0 &&
    o.steps.every(isStep)
  );
}

/** Parses stored JSON, skipping damaged sequences rather than losing everything. */
export function parseStoredSequences(json: string | null): { sequences: SavedSequence[]; skipped: number } {
  if (!json) return { sequences: [], skipped: 0 };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { sequences: [], skipped: 1 };
  }
  if (!Array.isArray(raw)) return { sequences: [], skipped: 1 };
  const sequences = raw.filter(isSequence);
  return { sequences, skipped: raw.length - sequences.length };
}

/** Why these steps can't be saved, or null. */
export function validateSteps(steps: SequenceStep[]): string | null {
  if (!steps.length) return 'Add at least one pattern.';
  if (steps.length > MAX_STEPS) return `Use ${MAX_STEPS} steps or fewer.`;
  if (!steps.every(isStep)) return 'A step is damaged. Remove it and add it again.';
  return null;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Which step comes after `index`: the next one, back to the first when `loop` is on, or null at the end.
 */
export function nextStep(index: number, length: number, loop: boolean): number | null {
  if (index + 1 < length) return index + 1;
  return loop && length > 0 ? 0 : null;
}

/** The step before `index`, wrapping to the last when `loop` is on (otherwise it stays on the first). */
export function previousStep(index: number, length: number, loop: boolean): number {
  if (index > 0) return index - 1;
  return loop ? Math.max(0, length - 1) : 0;
}

export class SequenceStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<{ sequences: SavedSequence[]; skipped: number }> {
    const res = parseStoredSequences(await this.kv.getItem(SEQUENCE_STORAGE_KEY));
    res.sequences.sort((a, b) => b.updatedAt - a.updatedAt);
    return res;
  }

  /**
   * Saves a new sequence, or replaces the one with `id` (editing). Names are unique, ignoring case: saving a
   * name another sequence already has throws.
   */
  async save(name: string, steps: SequenceStep[], id?: string): Promise<SavedSequence> {
    const nameError = validateName(name);
    if (nameError) throw new Error(nameError);
    const stepsError = validateSteps(steps);
    if (stepsError) throw new Error(stepsError);
    const clean = normalizeName(name);
    const { sequences } = await this.list();
    const clash = sequences.find((s) => s.id !== id && s.name.toLowerCase() === clean.toLowerCase());
    if (clash) throw new Error(`A sequence named "${clash.name}" already exists.`);
    const existing = id ? sequences.find((s) => s.id === id) : undefined;
    const t = this.now();
    const record: SavedSequence = {
      id: existing?.id ?? newId(),
      name: clean,
      steps: steps.map((s) => ({ name: normalizeName(s.name).slice(0, MAX_NAME_LENGTH) || 'Untitled', rows: s.rows, cols: s.cols, cells: s.cells })),
      createdAt: existing?.createdAt ?? t,
      updatedAt: t,
    };
    const next = [record, ...sequences.filter((s) => s.id !== record.id)];
    await this.kv.setItem(SEQUENCE_STORAGE_KEY, JSON.stringify(next));
    return record;
  }

  async remove(id: string): Promise<void> {
    const { sequences } = await this.list();
    await this.kv.setItem(SEQUENCE_STORAGE_KEY, JSON.stringify(sequences.filter((s) => s.id !== id)));
  }
}
