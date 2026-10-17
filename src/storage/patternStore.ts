/**
 * Saved patterns, stored on the phone only (AsyncStorage). No network.
 * Each record keeps its own rows/cols so patterns made for a different grid
 * size are detected instead of being silently misread.
 */
import { cellsFromString, cellsToString, type Pattern } from '@/domain/pattern';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface SavedPattern {
  id: string;
  name: string;
  rows: number;
  cols: number;
  /** Row-major '0'/'1' string, length rows * cols. */
  cells: string;
  createdAt: number;
  updatedAt: number;
}

export const STORAGE_KEY = '@pinvisual/patterns/v1';
export const MAX_NAME_LENGTH = 40;

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function validateName(name: string): string | null {
  const n = normalizeName(name);
  if (!n) return 'Enter a name.';
  if (n.length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  return null;
}

export function isCompatible(saved: SavedPattern, rows: number, cols: number): boolean {
  return saved.rows === rows && saved.cols === cols;
}

export function toPattern(saved: SavedPattern): Pattern | null {
  return cellsFromString(saved.cells, saved.rows, saved.cols);
}

function isSavedPattern(v: unknown): v is SavedPattern {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.rows === 'number' &&
    typeof o.cols === 'number' &&
    typeof o.cells === 'string' &&
    typeof o.createdAt === 'number' &&
    typeof o.updatedAt === 'number' &&
    cellsFromString(o.cells, o.rows, o.cols) !== null
  );
}

/** Parses stored JSON, skipping corrupt records rather than losing everything. */
export function parseStored(json: string | null): { patterns: SavedPattern[]; skipped: number } {
  if (!json) return { patterns: [], skipped: 0 };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { patterns: [], skipped: 1 };
  }
  if (!Array.isArray(raw)) return { patterns: [], skipped: 1 };
  const patterns = raw.filter(isSavedPattern);
  return { patterns, skipped: raw.length - patterns.length };
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PatternStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<{ patterns: SavedPattern[]; skipped: number }> {
    const res = parseStored(await this.kv.getItem(STORAGE_KEY));
    res.patterns.sort((a, b) => b.updatedAt - a.updatedAt);
    return res;
  }

  async findByName(name: string): Promise<SavedPattern | undefined> {
    const n = normalizeName(name).toLowerCase();
    return (await this.list()).patterns.find((p) => p.name.toLowerCase() === n);
  }

  /** Saves a new pattern, or overwrites the one with the same name when `overwrite` is true. */
  async save(name: string, pattern: Pattern, options: { overwrite?: boolean } = {}): Promise<SavedPattern> {
    const nameError = validateName(name);
    if (nameError) throw new Error(nameError);
    const clean = normalizeName(name);
    const { patterns } = await this.list();
    const existing = patterns.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (existing && !options.overwrite) throw new Error(`A pattern named "${existing.name}" already exists.`);
    const t = this.now();
    const record: SavedPattern = {
      id: existing?.id ?? newId(),
      name: clean,
      rows: pattern.rows,
      cols: pattern.cols,
      cells: cellsToString(pattern),
      createdAt: existing?.createdAt ?? t,
      updatedAt: t,
    };
    const next = [record, ...patterns.filter((p) => p.id !== record.id)];
    await this.kv.setItem(STORAGE_KEY, JSON.stringify(next));
    return record;
  }

  async remove(id: string): Promise<void> {
    const { patterns } = await this.list();
    await this.kv.setItem(STORAGE_KEY, JSON.stringify(patterns.filter((p) => p.id !== id)));
  }
}
