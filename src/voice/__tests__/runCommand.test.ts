import { cellsFromString, countRaised, createEmptyPattern, getPin } from '@/domain/pattern';
import { parseCommand } from '../commands';
import { describeRow, runCommand, type VoiceContext } from '../runCommand';

const empty = createEmptyPattern(5, 6);
const ctx = (over: Partial<VoiceContext> = {}): VoiceContext => ({
  pattern: empty,
  connected: true,
  busy: false,
  canUndo: true,
  canRedo: false,
  pending: null,
  saved: [{ name: 'Morning', pattern: cellsFromString('1'.repeat(6) + '0'.repeat(24), 5, 6) }],
  lastReply: '',
  ...over,
});
const run = (said: string, over?: Partial<VoiceContext>) => runCommand(parseCommand(said, ['Morning']), ctx(over));

describe('running voice commands', () => {
  it('a shape becomes the preview, and the reply says how many pins and what next', () => {
    const o = run('show a circle');
    expect(countRaised(o.show!.pattern)).toBeGreaterThan(8);
    expect(o.reply).toMatch(/^Showing a circle\. \d+ of 30 pins raised\. Say send to put it on the board\.$/);
  });

  it('no "say send" hint without a board', () => {
    expect(run('letter b', { connected: false }).reply).toBe(`Showing letter B. ${run('letter b').reply.split('. ')[1]}.`);
  });

  it('one pin, said with words', () => {
    const o = run('raise row two column three');
    expect(getPin(o.show!.pattern, 1, 2)).toBe(1);
    expect(o.reply).toMatch(/^Row 2, column 3 raised\. 1 of 30/);
  });

  it('a pin already in place, or outside the display', () => {
    expect(run('lower row 1 column 1').reply).toBe('Row 1, column 1 is already lowered.');
    expect(run('raise row 9 column 1').reply).toBe('The display has 5 rows and 6 columns.');
  });

  it('sending asks first; yes sends, no cancels', () => {
    const ask = run('send');
    expect(ask.pending).toBe('send');
    expect(ask.effect).toBeUndefined();
    expect(run('yes', { pending: 'send' })).toMatchObject({ effect: 'send', pending: null });
    expect(run('send', { pending: 'send' }).effect).toBe('send');
    expect(run('no', { pending: 'send' })).toMatchObject({ reply: 'Cancelled. Nothing was sent.', pending: null });
  });

  it('any other command drops the question', () => {
    expect(run('show a heart', { pending: 'send' }).pending).toBeNull();
  });

  it('no sending without a board, or while it is busy', () => {
    expect(run('send', { connected: false }).pending).toBeNull();
    expect(run('send', { busy: true }).reply).toMatch(/busy/);
    expect(run('yes', { pending: 'send', connected: false }).effect).toBeUndefined();
  });

  it('reset asks first too', () => {
    expect(run('reset').pending).toBe('reset');
    expect(run('yes', { pending: 'reset' }).effect).toBe('reset');
  });

  it('saved patterns, by name', () => {
    expect(run('open saved morning').show?.source).toBe('Morning');
    expect(run('open saved evening').reply).toBe('No saved pattern is called evening. Saved patterns: Morning.');
  });

  it('reading rows', () => {
    const p = cellsFromString('010010' + '0'.repeat(24), 5, 6)!;
    expect(describeRow(p, 0)).toBe('Row 1: columns 2 and 5 raised.');
    expect(run('read row 2', { pattern: p }).reply).toBe('Row 2: all lowered.');
  });

  it('unknown speech repeats what was heard and points to help', () => {
    expect(run('play the trumpet').reply).toBe('I heard “play the trumpet”, but that isn\'t a command. Say help for the list.');
  });

  it('repeat says the last reply again, and keeps a question open', () => {
    expect(run('repeat', { lastReply: 'Hello.', pending: 'send' })).toMatchObject({ reply: 'Hello.', pending: 'send' });
  });

  it('undo only when there is something to undo', () => {
    expect(run('undo').effect).toBe('undo');
    expect(run('undo', { canUndo: false }).reply).toBe('There is nothing to undo.');
  });
});

describe('graphs and suggestions', () => {
  it('a spoken graph is read back in words, and drawn as text the equation reader takes', () => {
    const o = run('graph y equals sine of the quantity x plus one');
    expect(o.reply).toBe('Drawing y equals sine of the quantity x plus 1.');
    expect(o.effect).toEqual({ type: 'graph', text: 'y = sin(x + 1)', words: 'y equals sine of the quantity x plus 1' });
  });

  it('an equation it cannot read says why, with an example', () => {
    expect(run('graph y equals banana').reply).toBe(
      "I couldn't read that equation. “banana” isn't part of an equation I know. For example, say graph y equals x squared.",
    );
  });

  it('a suggestion runs only after yes', () => {
    expect(run('yes', { pending: { suggestion: 'show a heart' } }).effect).toEqual({ type: 'run', text: 'show a heart' });
    expect(run('no', { pending: { suggestion: 'show a heart' } })).toMatchObject({ reply: 'OK, ignored.', pending: null });
  });

  it('on the Image tab, send and describe are about its pins', () => {
    const active = cellsFromString('1'.repeat(30), 5, 6)!;
    expect(run('send', { active }).reply).toBe('Send these pins to the board? 30 of 30 pins raised. Say yes to send, or no.');
    expect(run("what's on the board", { active }).reply).toMatch(/^30 of 30 pins raised/);
  });
});
