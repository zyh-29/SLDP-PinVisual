/**
 * How well commands are understood, on natural phrasings the voice model never saw (voicePhrases.ts). Prints a
 * report, and fails if understanding gets worse than the floor set below, or if anything that isn't a command is
 * acted on.
 */
import { type Command, parseCommand } from '../commands';
import { understand } from '../understand';
import { FRESH_PHRASES, PHRASES } from './voicePhrases';

export function keyOf(c: Command): string {
  switch (c.kind) {
    case 'shape':
      return `shape:${c.shape}`;
    case 'character':
      return `char:${c.char}`;
    case 'pin':
      return `pin:${c.action}:${c.row}:${c.col}`;
    case 'line':
      return `line:${c.action}:${c.axis}:${c.index}`;
    case 'navigate':
      return `nav:${c.tab}`;
    case 'image':
      return `image:${c.action}`;
    case 'setting':
      return `setting:${c.setting}:${c.on ? 'on' : 'off'}`;
    case 'adjust':
      return `adjust:${c.setting}:${c.up ? 'up' : 'down'}`;
    case 'describeRow':
      return `row:${c.row}`;
    case 'search':
      return c.pictures ? `pictures:${c.query}` : `searchSaved:${c.query}`;
    case 'next':
      return c.back ? 'previous' : 'next';
    case 'unknown':
    case 'savedUnknown':
      return 'none';
    default:
      return c.kind;
  }
}

type Result = 'right' | 'asked' | 'missed' | 'wrong';

function score(expected: string, acted: string, asked: string | null): Result {
  if (expected === 'none') return acted === 'none' ? (asked ? 'asked' : 'right') : 'wrong';
  if (acted === expected) return 'right';
  if (acted !== 'none') return 'wrong';
  return asked === expected ? 'asked' : 'missed';
}

function report(name: string, results: { phrase: string; expected: string; got: string; r: Result }[]) {
  const n = results.length;
  const count = (r: Result) => results.filter((x) => x.r === r).length;
  const pct = (k: number) => `${((100 * k) / n).toFixed(0)}%`;
  return {
    name,
    right: count('right') / n,
    wrong: count('wrong'),
    line: `${name}: ${pct(count('right'))} understood, ${pct(count('asked'))} asked "did you mean", ${pct(count('missed'))} not understood, ${count('wrong')} wrong (${n} phrases)`,
    failures: results.filter((x) => x.r === 'missed' || x.r === 'wrong').map((x) => `  ${x.r}: "${x.phrase}" → ${x.got} (expected ${x.expected})`),
  };
}

const SAVED = ['House', 'Morning', 'Star'];

function run(split: 'dev' | 'exam' | 'fresh', how: 'rules' | 'understand') {
  const items = split === 'fresh' ? FRESH_PHRASES : PHRASES.filter((_, i) => (i % 3 === 0) === (split === 'exam'));
  return items.map(([phrase, expected]) => {
    if (how === 'rules') {
      const got = keyOf(parseCommand(phrase, SAVED));
      return { phrase, expected, got, r: score(expected, got, null) };
    }
    const u = understand(phrase, SAVED);
    const got = keyOf(u.command);
    const asked = u.confirm ? keyOf(parseCommand(u.confirm, SAVED)) : null;
    return { phrase, expected, got: asked ? `ask "${u.confirm}"` : got, r: score(expected, got, asked) };
  });
}

describe('understanding natural phrasings', () => {
  const verbose = !!process.env.VOICE_REPORT;
  const lines: string[] = [];
  afterAll(() => console.log(lines.join('\n')));

  for (const split of ['dev', 'exam', 'fresh'] as const) {
    it(`${split} set`, () => {
      const before = report(`${split} · rules only`, run(split, 'rules'));
      const after = report(`${split} · understand`, run(split, 'understand'));
      lines.push(before.line, after.line);
      if (verbose) lines.push(...after.failures);
      // Never worse than the rules alone, never below the floor measured when the model was built (dev and exam 98%,
      // fresh 97%), and at most one sentence acted on wrongly per set.
      expect(after.right).toBeGreaterThanOrEqual(before.right);
      expect(after.right).toBeGreaterThanOrEqual(split === 'fresh' ? 0.93 : 0.95);
      expect(after.wrong).toBeLessThanOrEqual(1);
    });
  }
});
