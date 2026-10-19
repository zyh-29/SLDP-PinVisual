/**
 * Saved patterns, stored on the phone (or in the browser) only (AsyncStorage). No network.
 * Each record keeps its own rows/cols so patterns made for a different grid
 * size are detected instead of being silently misread.
 * Export / import: a JSON file the user keeps or moves to another device (see patternFile.ts).
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

// ---------- Export and import (a file the user keeps, moves to another device, or shares) ----------

export const EXPORT_FORMAT = 'pinvisual-patterns';
export const EXPORT_VERSION = 1;

/** The patterns as a small JSON file: what Export saves and Import reads. */
export function exportPatterns(patterns: SavedPattern[], exportedAt = Date.now()): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt, patterns }, null, 2);
}

/** A file name for an export, e.g. pinvisual-patterns-2026-10-19.json. */
export function exportFileName(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${EXPORT_FORMAT}-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.json`;
}

/**
 * Reads an exported file (or a bare list of patterns). Damaged records are skipped and counted. Throws with a
 * readable message when the text isn't an export at all.
 */
export function parseExport(text: string): { patterns: SavedPattern[]; skipped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a PinVisual patterns file.');
  }
  let list: unknown = raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (o.format !== EXPORT_FORMAT) throw new Error('This is not a PinVisual patterns file.');
    if (typeof o.version !== 'number' || o.version > EXPORT_VERSION)
      throw new Error('This file was made by a newer version of PinVisual. Update the app to import it.');
    list = o.patterns;
  }
  if (!Array.isArray(list)) throw new Error('This is not a PinVisual patterns file.');
  const patterns = list.filter(isSavedPattern).map((p) => ({ ...p, name: normalizeName(p.name).slice(0, MAX_NAME_LENGTH) || 'Untitled' }));
  return { patterns, skipped: list.length - patterns.length };
}

export interface ImportResult {
  /** Patterns added (including renamed ones). */
  added: number;
  /** Added under a new name, because a different pattern already had theirs: "Arrow" became "Arrow (2)". */
  renamed: number;
  /** Already here (same name, size and pins): left alone. */
  duplicates: number;
}

/** "Name (2)", "Name (3)"... the first that's free, kept within the name length limit. */
function freeName(name: string, taken: Set<string>): string {
  for (let k = 2; ; k++) {
    const suffix = ` (${k})`;
    const candidate = `${name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
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

  /**
   * Adds imported patterns. Nothing here is ever overwritten: an identical pattern (same name, size and pins) is
   * skipped, and a different one with a name already in use is added as "Name (2)".
   */
  async importPatterns(incoming: SavedPattern[]): Promise<ImportResult> {
    const { patterns } = await this.list();
    const byName = new Map(patterns.map((p) => [p.name.toLowerCase(), p]));
    const ids = new Set(patterns.map((p) => p.id));
    const added: SavedPattern[] = [];
    let renamed = 0;
    let duplicates = 0;
    for (const p of incoming) {
      const same = byName.get(p.name.toLowerCase());
      if (same && same.rows === p.rows && same.cols === p.cols && same.cells === p.cells) {
        duplicates++;
        continue;
      }
      const name = same ? freeName(p.name, new Set(byName.keys())) : p.name;
      if (same) renamed++;
      const record: SavedPattern = { ...p, name, id: ids.has(p.id) ? newId() : p.id };
      ids.add(record.id);
      byName.set(name.toLowerCase(), record);
      added.push(record);
    }
    if (added.length) await this.kv.setItem(STORAGE_KEY, JSON.stringify([...added, ...patterns]));
    return { added: added.length, renamed, duplicates };
  }
}
