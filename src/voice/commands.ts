import { SHAPE_NAMES, type ShapeName } from './glyphs';

/**
 * Voice (or typed) commands: what a sentence asks for. Understood on the device from a fixed list of phrasings,
 * so nothing is sent anywhere and the same sentence always does the same thing. Speech recognisers write what
 * they hear ("raise row to column three", "letter bee"), so number words, homophones and spoken letter names are
 * accepted too.
 */
export type PinAction = 'raise' | 'lower' | 'toggle';

export type Command =
  | { kind: 'help' }
  | { kind: 'repeat' }
  | { kind: 'stop' }
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'describe' }
  | { kind: 'describeRow'; row: number }
  | { kind: 'clear' }
  | { kind: 'fill' }
  | { kind: 'invert' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'pin'; action: PinAction; row: number; col: number }
  | { kind: 'line'; action: Exclude<PinAction, 'toggle'>; axis: 'row' | 'column'; index: number }
  | { kind: 'shape'; shape: ShapeName }
  | { kind: 'character'; char: string }
  | { kind: 'saved'; name: string }
  | { kind: 'savedUnknown'; heard: string }
  | { kind: 'send' }
  | { kind: 'reset' }
  | { kind: 'unknown'; heard: string };

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  won: 1,
  first: 1,
  two: 2,
  to: 2,
  too: 2,
  second: 2,
  three: 3,
  third: 3,
  tree: 3,
  four: 4,
  for: 4,
  fore: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
  eight: 8,
  ate: 8,
  eighth: 8,
  nine: 9,
  ninth: 9,
  ten: 10,
  tenth: 10,
};

/** A number said as a word or written as digits ("3", "3rd", "three", "third"), or null. */
export function toNumber(word: string | undefined): number | null {
  if (!word) return null;
  const digits = /^(\d+)(st|nd|rd|th)?$/.exec(word);
  if (digits) return Number(digits[1]);
  return NUMBER_WORDS[word] ?? null;
}

/** How speech recognisers write letters said on their own. */
const LETTER_NAMES: Record<string, string> = {
  a: 'A', ay: 'A', eh: 'A',
  b: 'B', be: 'B', bee: 'B',
  c: 'C', see: 'C', sea: 'C', cee: 'C',
  d: 'D', dee: 'D',
  e: 'E',
  f: 'F', ef: 'F', eff: 'F',
  g: 'G', gee: 'G',
  h: 'H', aitch: 'H',
  i: 'I', eye: 'I', aye: 'I',
  j: 'J', jay: 'J',
  k: 'K', kay: 'K',
  l: 'L', el: 'L', ell: 'L',
  m: 'M', em: 'M',
  n: 'N', en: 'N',
  o: 'O', oh: 'O', owe: 'O',
  p: 'P', pee: 'P', pea: 'P',
  q: 'Q', cue: 'Q', queue: 'Q',
  r: 'R', are: 'R', ar: 'R',
  s: 'S', es: 'S', ess: 'S',
  t: 'T', tee: 'T', tea: 'T',
  u: 'U', you: 'U',
  v: 'V', vee: 'V',
  w: 'W', 'double u': 'W', 'double you': 'W',
  x: 'X', ex: 'X',
  y: 'Y', why: 'Y', wye: 'Y',
  z: 'Z', zee: 'Z', zed: 'Z',
};

/** Other names for the shapes. The first match in this list wins, so longer phrases come first. */
const SHAPE_WORDS: [RegExp, ShapeName][] = [
  [/\b(up arrow|arrow (pointing )?up|upward arrow)\b/, 'arrow up'],
  [/\b(down arrow|arrow (pointing )?down|downward arrow)\b/, 'arrow down'],
  [/\b(left arrow|arrow (pointing )?(to the )?left)\b/, 'arrow left'],
  [/\b(right arrow|arrow (pointing )?(to the )?right|arrow)\b/, 'arrow right'],
  [/\b(vertical line|line down|up and down line|standing line)\b/, 'vertical line'],
  [/\b(horizontal line|line across|flat line|dash|line)\b/, 'horizontal line'],
  [/\b(checkerboard|checker board|checkers|chessboard|chess board|checked)\b/, 'checkerboard'],
  [/\b(smiley face|smiley|smile|happy face|face)\b/, 'smile'],
  [/\b(plus sign|plus)\b/, 'plus'],
  [/\b(cross|x shape|times sign)\b/, 'cross'],
  [/\b(circle|ring|round|oval)\b/, 'circle'],
  [/\b(square|box|rectangle|frame|border|outline)\b/, 'square'],
  [/\b(triangle)\b/, 'triangle'],
  [/\b(diamond|rhombus)\b/, 'diamond'],
  [/\b(heart)\b/, 'heart'],
];

/** Lower case, no punctuation, single spaces, and the polite or filler words around a command taken off. */
export function normalise(text: string): string {
  let s = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lead = /^(please|hey|ok|okay|now|so|um|uh|and|then|can you|could you|would you|will you|i want to|i want|id like to|id like|let me|lets|go ahead and|pinvisual|pin visual)\s+/;
  while (lead.test(s)) s = s.replace(lead, '');
  s = s.replace(/\s+(please|now|for me|thanks|thank you)$/, '');
  return s;
}

const SHOW = '(?:show(?: me)?|draw|make|display|put up|give me|do|raise|bring up)';

/** Text after a "show"-like verb (or the whole text when there isn't one), without "a", "the" and the like. */
function shownThing(s: string): string {
  return s
    .replace(new RegExp(`^${SHOW}\\s+`), '')
    .replace(/^(an?|the|one|some)\s+/, '')
    .replace(/\s+(shape|sign|symbol|pattern|on the (grid|preview|board|display))$/, '')
    .trim();
}

const RAISE = /^(raise|lift|push up|put up|turn on|set|up|fill in|fill)\b/;
const LOWER = /^(lower|drop|push down|put down|turn off|unset|down|clear|remove)\b/;
const TOGGLE = /^(toggle|flip|switch|change|tap|press)\b/;

function actionOf(s: string): PinAction | null {
  if (RAISE.test(s)) return 'raise';
  if (LOWER.test(s)) return 'lower';
  if (TOGGLE.test(s)) return 'toggle';
  // "row 2 column 3 up"
  if (/\b(up|on|raised)$/.test(s)) return 'raise';
  if (/\b(down|off|lowered)$/.test(s)) return 'lower';
  return null;
}

/** Edit distance, for matching a saved pattern's name to what the recogniser heard. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return d[b.length];
}

/** The saved name closest to what was heard: the same, starting with it, containing it, or a near miss. */
export function matchName(heard: string, names: readonly string[]): string | null {
  const h = normalise(heard);
  if (!h) return null;
  const keyed = names.map((n) => ({ n, k: normalise(n) }));
  const exact = keyed.find((x) => x.k === h);
  if (exact) return exact.n;
  const starts = keyed.filter((x) => x.k.startsWith(h) || h.startsWith(x.k));
  if (starts.length === 1) return starts[0].n;
  const contains = keyed.filter((x) => x.k.includes(h));
  if (contains.length === 1) return contains[0].n;
  let best: { n: string; d: number } | null = null;
  for (const x of keyed) {
    const dist = distance(h, x.k);
    if (dist <= Math.max(1, Math.floor(x.k.length / 4)) && (!best || dist < best.d)) best = { n: x.n, d: dist };
  }
  return best?.n ?? null;
}

/** Reads a sentence as a command. `savedNames` are the saved patterns, which can be opened by name. */
export function parseCommand(text: string, savedNames: readonly string[] = []): Command {
  const s = normalise(text);
  if (!s) return { kind: 'unknown', heard: text.trim() };

  // Talking to the app itself
  if (/^(help|what can i say|what can you do|commands|list commands|options|what are the commands)$/.test(s)) return { kind: 'help' };
  if (/^(repeat|repeat that|again|say again|say that again|what|pardon|sorry|come again|what did you say)$/.test(s)) return { kind: 'repeat' };
  if (/^(stop|stop talking|quiet|be quiet|silence|shush|hush|shut up)$/.test(s)) return { kind: 'stop' };
  if (/^(yes|yeah|yep|yup|yes please|confirm|confirmed|ok|okay|sure|do it|go|go ahead|correct|affirmative)$/.test(s)) return { kind: 'yes' };
  if (/^(no|nope|nah|cancel|never mind|nevermind|dont|do not|no thanks|abort)$/.test(s)) return { kind: 'no' };

  // The board
  if (/^(reset|reset (the )?(physical )?(pins|board|display)|reset physical pins|lower (all )?(the )?(physical|real) pins)$/.test(s))
    return { kind: 'reset' };
  if (/^(send|send it|send (the |this )?(pattern|preview|picture|shape)|send (it )?to (the )?(board|display|pins)|put it on the (board|display)|show (it )?on the (board|display))$/.test(s))
    return { kind: 'send' };

  // Reading the preview
  const readRow = /^(read|describe|whats in|what is in|what about|check) row (\w+)$/.exec(s);
  if (readRow && toNumber(readRow[2]) !== null) return { kind: 'describeRow', row: toNumber(readRow[2])! };
  if (
    /^(describe|describe it|read|read it|read (the )?(grid|preview|pattern|board|display)|describe (the )?(grid|preview|pattern|board|display)|status|where am i)$/.test(s) ||
    /^(whats|what is|what s) (on|showing|on the|in the)\b/.test(s) ||
    /^what do i have/.test(s)
  )
    return { kind: 'describe' };

  // Editing the preview
  if (/^(undo|undo that|go back|back|take that back|take it back)$/.test(s)) return { kind: 'undo' };
  if (/^(redo|redo that|go forward)$/.test(s)) return { kind: 'redo' };
  if (/^(clear|clear (it|all|everything)|clear (the )?(grid|preview|pattern|display)|erase|erase (it|all|everything)|wipe|lower (all|everything|all pins|every pin|all the pins)|all down|start over|blank)$/.test(s))
    return { kind: 'clear' };
  if (/^(fill|fill (it|all|everything)|fill (the )?(grid|preview)|raise (all|everything|all pins|every pin|all the pins)|all up)$/.test(s)) return { kind: 'fill' };
  if (/^(invert|inverse|reverse|negative|flip (all|everything|it|the grid|the preview)|swap)$/.test(s)) return { kind: 'invert' };

  // One pin: "raise row 2 column 3", "row 2 column 3 up", "toggle pin 2 3"
  const pin =
    /\brow (\w+) (?:and )?(?:column|col|columns|call|colum) (\w+)\b/.exec(s) ?? /\b(?:column|col) (\w+) (?:and )?row (\w+)\b/.exec(s);
  if (pin) {
    const rowFirst = /\brow \w+ (?:and )?(?:column|col|columns|call|colum)/.test(s);
    const row = toNumber(rowFirst ? pin[1] : pin[2]);
    const col = toNumber(rowFirst ? pin[2] : pin[1]);
    if (row !== null && col !== null) return { kind: 'pin', action: actionOf(s) ?? 'toggle', row, col };
  }
  const pair = /^(?:(\w+(?: up| down| on| off)?) )?pin (\w+) (?:and |by )?(\w+)(?: (up|down|on|off))?$/.exec(s);
  if (pair && toNumber(pair[2]) !== null && toNumber(pair[3]) !== null)
    return { kind: 'pin', action: actionOf(s) ?? 'toggle', row: toNumber(pair[2])!, col: toNumber(pair[3])! };

  // A whole row or column: "raise row 2", "lower column 4"
  const line = /^(.*?)\s*\b(row|column|col) (\w+)(?: (up|down|on|off))?$/.exec(s);
  if (line && toNumber(line[3]) !== null) {
    const action = actionOf(s);
    if (action === 'raise' || action === 'lower')
      return { kind: 'line', action, axis: line[2] === 'row' ? 'row' : 'column', index: toNumber(line[3])! };
  }

  // Saved patterns: "open saved Morning", "load my house pattern"
  const saved = /^(?:open|load|play|use|show(?: me)?|get)\s+(?:(?:my|the)\s+)?(?:saved\s+)?(?:pattern\s+)?(.+?)(?:\s+pattern)?$/.exec(s);
  const savedAsked = /^(open|load|use|get)\b/.test(s) || /\bsaved\b/.test(s);
  if (saved && savedAsked) {
    const heard = saved[1].replace(/^(saved|pattern|called|named)\s+/, '').trim();
    const name = matchName(heard, savedNames);
    return name ? { kind: 'saved', name } : { kind: 'savedUnknown', heard };
  }

  // A letter or a digit: "letter b", "show the letter bee", "number 3", "capital a"
  const thing = shownThing(s);
  const letter = /^(?:the )?(?:letter|capital|capital letter|small letter|lowercase|uppercase) (.+)$/.exec(thing);
  if (letter) {
    const ch = LETTER_NAMES[letter[1]] ?? (letter[1].length === 1 ? letter[1].toUpperCase() : null);
    if (ch) return { kind: 'character', char: ch };
  }
  const digit = /^(?:the )?(?:number|digit) (\w+)$/.exec(thing);
  if (digit) {
    const n = toNumber(digit[1]);
    if (n !== null && n <= 9) return { kind: 'character', char: String(n) };
  }

  // A shape: "show a circle", "draw an up arrow", or just "heart"
  for (const [re, shape] of SHAPE_WORDS) if (re.test(thing) && SHAPE_NAMES.includes(shape)) return { kind: 'shape', shape };

  // "show b", "show bee", "show 3", "show three": a single letter or digit after a show verb
  if (new RegExp(`^${SHOW}\\s`).test(s)) {
    const rest = s.replace(new RegExp(`^${SHOW}\\s+`), '').replace(/^the\s+/, '');
    if (/^\d$/.test(rest)) return { kind: 'character', char: rest };
    const n = toNumber(rest);
    if (n !== null && n <= 9 && !/^(to|too|for|fore|won|ate|tree)$/.test(rest)) return { kind: 'character', char: String(n) };
    if (LETTER_NAMES[rest]) return { kind: 'character', char: LETTER_NAMES[rest] };
    // A saved pattern's name after "show"
    const name = matchName(rest, savedNames);
    if (name) return { kind: 'saved', name };
  }

  // A saved pattern's name on its own
  const bare = matchName(s, savedNames);
  if (bare && normalise(bare) === s) return { kind: 'saved', name: bare };

  return { kind: 'unknown', heard: text.trim() };
}

/** The spoken list of things to say, short enough to listen to in one go. */
export const HELP_TEXT =
  'You can say: show a circle, or another shape such as square, triangle, heart or arrow up. ' +
  'Letter B, or number 3. Raise row 2 column 3, or lower row 2. Clear, fill, invert, undo or redo. ' +
  'What is on the board, or read row 2. Open saved, then a pattern name. ' +
  'Send, to put it on the board, or reset, to lower the real pins. Repeat, to hear the last answer again, or stop.';

/** Words the recogniser should expect (better accuracy for short commands). */
export const HINT_WORDS = [
  'show', 'circle', 'square', 'triangle', 'diamond', 'heart', 'cross', 'plus', 'arrow', 'smile', 'checkerboard', 'line',
  'letter', 'number', 'row', 'column', 'raise', 'lower', 'toggle', 'clear', 'fill', 'invert', 'undo', 'redo',
  'send', 'reset', 'yes', 'no', 'help', 'repeat', 'stop', 'open saved', 'read row', "what's on the board",
];
