import { countRaised, describePattern, getPin, type Pattern, type PinValue } from '@/domain/pattern';
import { type Command, HELP_TEXT, type ImageAction, type ImageSetting, type Tab } from './commands';
import { characterPattern, shapePattern } from './glyphs';
import { readSpokenEquation } from './spokenMath';

/** What a command needs to know about the app. */
export interface VoiceContext {
  pattern: Pattern;
  connected: boolean;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * The pins "send" and "what's on the board" are about: the Image tab's result while it's open and has one,
   * otherwise the preview (`pattern`, which edits always change).
   */
  active?: Pattern;
  /** A command waiting for "yes": sending, lowering the real pins, or a suggestion to confirm. */
  pending: Pending;
  saved: readonly { name: string; pattern: Pattern | null }[];
  lastReply: string;
}

export type Pending = 'send' | 'reset' | { suggestion: string } | null;

/** Something the hook does after answering (some need the Image tab, or the internet, and answer later). */
export type Effect =
  | 'send'
  | 'reset'
  | 'undo'
  | 'redo'
  | 'stop'
  | { type: 'graph'; text: string; words: string }
  | { type: 'image'; action: ImageAction }
  | { type: 'setting'; setting: ImageSetting; on: boolean }
  | { type: 'adjust'; setting: 'tolerance' | 'sensitivity'; up: boolean }
  | { type: 'navigate'; tab: Tab }
  | { type: 'search'; query: string; pictures: boolean }
  | { type: 'next'; back: boolean }
  | { type: 'voiceOff' }
  | { type: 'run'; text: string };

/** What to do about a command: what to say, and what to change. */
export interface Outcome {
  reply: string;
  /** A new preview. */
  show?: { pattern: Pattern; source: string };
  /** Waiting for "yes" after this (null: nothing waiting). */
  pending: Pending;
  effect?: Effect;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 of 30 pins raised." */
export function raisedSummary(p: Pattern): string {
  return `${countRaised(p)} of ${p.rows * p.cols} pins raised.`;
}

/** One row read out: "Row 3: columns 2 and 5 raised." */
export function describeRow(p: Pattern, row: number): string {
  const up: number[] = [];
  for (let c = 0; c < p.cols; c++) if (getPin(p, row, c) === 1) up.push(c + 1);
  if (!up.length) return `Row ${row + 1}: all lowered.`;
  if (up.length === p.cols) return `Row ${row + 1}: all raised.`;
  const list = up.length === 1 ? `column ${up[0]}` : `columns ${up.slice(0, -1).join(', ')} and ${up[up.length - 1]}`;
  return `Row ${row + 1}: ${list} raised.`;
}

function withCells(p: Pattern, f: (row: number, col: number, v: PinValue) => PinValue): Pattern {
  const cells = p.cells.map((v, i) => f(Math.floor(i / p.cols), i % p.cols, v));
  return { ...p, cells };
}

const outOfRange = (p: Pattern) => `The display has ${plural(p.rows, 'row')} and ${plural(p.cols, 'column')}.`;

/** After a change to the preview: what it is now, and how to get it onto the board. */
function changed(ctx: VoiceContext, what: string, pattern: Pattern, source: string): Outcome {
  const next = ctx.connected ? ' Say send to put it on the board.' : '';
  return { reply: `${what} ${raisedSummary(pattern)}${next}`, show: { pattern, source }, pending: null };
}

export function runCommand(cmd: Command, ctx: VoiceContext): Outcome {
  const p = ctx.pattern;
  const active = ctx.active ?? p;
  const suggestion = ctx.pending && typeof ctx.pending === 'object' ? ctx.pending.suggestion : null;
  switch (cmd.kind) {
    case 'help':
      return { reply: HELP_TEXT, pending: ctx.pending };
    case 'repeat':
      return { reply: ctx.lastReply || 'Nothing has been said yet.', pending: ctx.pending };
    case 'stop':
      return { reply: '', pending: null, effect: 'stop' };

    case 'yes':
      if (suggestion) return { reply: '', pending: null, effect: { type: 'run', text: suggestion } };
      if (ctx.pending === 'send') return confirmSend(ctx);
      if (ctx.pending === 'reset') return confirmReset(ctx);
      return { reply: 'There is nothing to confirm.', pending: null };
    case 'no':
      return {
        reply: suggestion ? 'OK, ignored.' : ctx.pending === 'send' ? 'Cancelled. Nothing was sent.' : ctx.pending ? 'Cancelled.' : 'OK.',
        pending: null,
      };

    case 'send':
      // "send" said again while asked: that's a yes.
      if (ctx.pending === 'send') return confirmSend(ctx);
      if (!ctx.connected) return { reply: 'No board is connected. Connect one in the Device tab first.', pending: null };
      if (ctx.busy) return { reply: 'The board is busy. Try again in a moment.', pending: null };
      return {
        reply: `Send ${ctx.active ? 'these pins' : 'this pattern'} to the board? ${raisedSummary(active)} Say yes to send, or no.`,
        pending: 'send',
      };
    case 'reset':
      if (ctx.pending === 'reset') return confirmReset(ctx);
      if (!ctx.connected) return { reply: 'No board is connected, so there are no pins to lower.', pending: null };
      if (ctx.busy) return { reply: 'The board is busy. Try again in a moment.', pending: null };
      return { reply: 'Lower all the pins on the board? Say yes to lower them, or no.', pending: 'reset' };

    case 'describe':
      return { reply: describePattern(active), pending: ctx.pending };
    case 'describeRow':
      if (cmd.row < 1 || cmd.row > active.rows) return { reply: outOfRange(active), pending: ctx.pending };
      return { reply: describeRow(active, cmd.row - 1), pending: ctx.pending };

    case 'clear':
      return changed(ctx, 'Preview cleared.', withCells(p, () => 0), 'Voice');
    case 'fill':
      return changed(ctx, 'All pins raised.', withCells(p, () => 1), 'Voice');
    case 'invert':
      return changed(ctx, 'Inverted.', withCells(p, (_r, _c, v) => (v ? 0 : 1)), 'Voice');
    case 'undo':
      return ctx.canUndo ? { reply: 'Undone.', pending: null, effect: 'undo' } : { reply: 'There is nothing to undo.', pending: null };
    case 'redo':
      return ctx.canRedo ? { reply: 'Redone.', pending: null, effect: 'redo' } : { reply: 'There is nothing to redo.', pending: null };

    case 'pin': {
      const { row, col } = cmd;
      if (row < 1 || row > p.rows || col < 1 || col > p.cols) return { reply: outOfRange(p), pending: null };
      const was = getPin(p, row - 1, col - 1);
      const now: PinValue = cmd.action === 'raise' ? 1 : cmd.action === 'lower' ? 0 : was ? 0 : 1;
      const where = `Row ${row}, column ${col}`;
      if (now === was) return { reply: `${where} is already ${was ? 'raised' : 'lowered'}.`, pending: null };
      const next = withCells(p, (r, c, v) => (r === row - 1 && c === col - 1 ? now : v));
      return changed(ctx, `${where} ${now ? 'raised' : 'lowered'}.`, next, 'Voice');
    }
    case 'line': {
      const max = cmd.axis === 'row' ? p.rows : p.cols;
      if (cmd.index < 1 || cmd.index > max) return { reply: outOfRange(p), pending: null };
      const v: PinValue = cmd.action === 'raise' ? 1 : 0;
      const next = withCells(p, (r, c, old) => ((cmd.axis === 'row' ? r : c) === cmd.index - 1 ? v : old));
      const name = `${cmd.axis === 'row' ? 'Row' : 'Column'} ${cmd.index}`;
      return changed(ctx, `${name} ${cmd.action === 'raise' ? 'raised' : 'lowered'}.`, next, 'Voice');
    }

    case 'shape':
      return changed(ctx, `Showing ${/^[aeiou]/.test(cmd.shape) ? 'an' : 'a'} ${cmd.shape}.`, shapePattern(cmd.shape, p.rows, p.cols), cmd.shape);
    case 'character': {
      const pattern = characterPattern(cmd.char, p.rows, p.cols)!;
      const label = /\d/.test(cmd.char) ? `number ${cmd.char}` : `letter ${cmd.char}`;
      return changed(ctx, `Showing ${label}.`, pattern, label[0].toUpperCase() + label.slice(1));
    }

    case 'saved': {
      const s = ctx.saved.find((x) => x.name === cmd.name);
      if (!s?.pattern) return { reply: `${cmd.name} was saved for a different size of display, so it can't be shown here.`, pending: null };
      return changed(ctx, `Opened ${cmd.name}.`, s.pattern, cmd.name);
    }
    case 'savedUnknown':
      return {
        reply: ctx.saved.length
          ? `No saved pattern is called ${cmd.heard}. Saved patterns: ${ctx.saved.map((x) => x.name).join(', ')}.`
          : 'There are no saved patterns yet.',
        pending: null,
      };

    case 'graph':
      try {
        const eq = readSpokenEquation(cmd.said);
        return { reply: `Drawing ${eq.words}.`, pending: null, effect: { type: 'graph', text: eq.text, words: eq.words } };
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        return { reply: `I couldn't read that equation. ${why} For example, say graph y equals x squared.`, pending: null };
      }
    case 'image':
      return { reply: '', pending: null, effect: { type: 'image', action: cmd.action } };
    case 'setting':
      return { reply: '', pending: null, effect: { type: 'setting', setting: cmd.setting, on: cmd.on } };
    case 'adjust':
      return { reply: '', pending: null, effect: { type: 'adjust', setting: cmd.setting, up: cmd.up } };
    case 'navigate':
      return { reply: '', pending: null, effect: { type: 'navigate', tab: cmd.tab } };
    case 'search':
      return { reply: '', pending: null, effect: { type: 'search', query: cmd.query, pictures: cmd.pictures } };
    case 'next':
      return { reply: '', pending: null, effect: { type: 'next', back: cmd.back } };
    case 'voiceOff':
      return { reply: 'Voice control off. Press Voice Control on the Display tab to turn it back on.', pending: null, effect: { type: 'voiceOff' } };

    case 'unknown':
      return {
        reply: cmd.heard
          ? `I heard “${cmd.heard}”, but that isn't a command. Say help for the list.`
          : "I didn't catch that. Say help for the list.",
        pending: ctx.pending,
      };
  }
}

function confirmSend(ctx: VoiceContext): Outcome {
  if (!ctx.connected) return { reply: 'The board disconnected, so nothing was sent.', pending: null };
  return { reply: 'Sending. The pins will move.', pending: null, effect: 'send' };
}

function confirmReset(ctx: VoiceContext): Outcome {
  if (!ctx.connected) return { reply: 'The board disconnected, so nothing was lowered.', pending: null };
  return { reply: 'Lowering all pins. The pins will move.', pending: null, effect: 'reset' };
}
