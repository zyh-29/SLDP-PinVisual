/**
 * Understanding what was said or typed, fastest first:
 *
 * 1. The command rules (commands.ts): exact, predictable, instant.
 * 2. The same rules after tidying: filler taken out anywhere ("could you just clear it now"), and a few words
 *    folded into the ones the rules know ("hart" → heart, "pyramid" → triangle).
 * 3. The voice model (intent/model.ts), a small neural network: which kind of command it is and how sure.
 *    The details (which row, which shape, what to search for) are then read from the sentence by this file and
 *    the result checked by the rules again, so the model never invents a row number or a search.
 *       - Very sure: done.
 *       - Fairly sure: "Did you mean …?" (the app asks for a yes first).
 *       - Unsure: not a command (the browser's own AI may still be asked; see VoiceProvider).
 * 4. Still not a command: what it names is searched for as a picture (searchTopic; see VoiceProvider).
 *    The model also overrules the rules when it's all but certain they misread a sentence ("find me an image of
 *    a car" is a picture search, not a saved pattern called "me an image of a car").
 */
import { type Command, LETTER_NAMES, matchName, normalise, parseCommand, shapeIn, toNumber } from './commands';
import { anchored, classify, familiarity, type Intent } from './intent/model';

export interface Understanding {
  /** What to do now; { kind: 'unknown' } when asking or not understood. */
  command: Command;
  /** Instead of acting, ask "Did you mean …?" with this command. */
  confirm?: string;
  /** Which step understood it. */
  how: 'rules' | 'model' | 'none';
  /** The model's best guess. */
  intent?: Intent;
}

/** At or above: act on the model's reading. */
export const ACT = 0.8;
/** At or above (and below ACT): ask first. */
export const ASK = 0.4;
/** The model overrules a rule's reading only when at least this sure it's another kind of command. */
const OVERRULE = 0.97;
/**
 * The share of a sentence's words the model learned from (or near misspellings of them), below which its guess
 * isn't trusted at all: a model always picks something, even for "pizza".
 */
const FAMILIAR = 0.5;

const FILLER =
  /\b(please|kindly|just|actually|sorry|for me|thanks|thank you|oops|whoops|um+|uh+|er|a bit|a little|right now|quickly|if you can|pinvisual|pin visual)\b/g;
const LEAD =
  /^(now|so|ok|okay|hey|and|then|can you|could you|would you|will you|can we|could we|i want you to|i want to|i want|i would like to|i would like|id like to|id like|i need to|i need|lets|let me|go ahead and|try to)\s+/;
const SYNONYMS: [RegExp, string][] = [
  [/\bhart\b/g, 'heart'],
  [/\blove heart\b/g, 'heart'],
  [/\bpyramid\b/g, 'triangle'],
  [/\bball\b/g, 'circle'],
  [/\bsmiling face\b/g, 'smiley face'],
  [/\bcirc[el]+\b/g, 'circle'],
  [/\bcolum\b/g, 'column'],
  [/\bcamra\b/g, 'camera'],
  [/\bpitcher\b/g, 'picture'],
  [/\bupside down\b/g, 'inverted'],
  [/\b(i )?missed (that|it)\b/g, 'say that again'],
];

/** The sentence normalised, with filler removed anywhere in it and a few words folded into ones the rules know. */
export function tidy(text: string): string {
  let s = normalise(text);
  for (const [re, to] of SYNONYMS) s = s.replace(re, to);
  s = s.replace(FILLER, ' ').replace(/\s+/g, ' ').trim().replace(/\s+(now|then)$/, '');
  while (LEAD.test(s)) s = s.replace(LEAD, '');
  return s.trim();
}

/** The model's name for a command's kind. */
export function labelOf(c: Command): string {
  switch (c.kind) {
    case 'image':
      return c.action;
    case 'navigate':
      return 'navigate';
    case 'saved':
    case 'savedUnknown':
      return 'openSaved';
    case 'search':
      return c.pictures ? 'pictures' : 'searchSaved';
    case 'next':
      return c.back ? 'previous' : 'next';
    case 'unknown':
      return 'none';
    default:
      return c.kind;
  }
}

/** Kinds with nothing to fill in: the command to run for each. */
const FIXED: Record<string, string> = {
  help: 'help',
  repeat: 'repeat',
  stop: 'stop',
  yes: 'yes',
  no: 'no',
  describe: 'describe',
  clear: 'clear',
  fill: 'fill',
  invert: 'invert',
  undo: 'undo',
  redo: 'redo',
  send: 'send',
  reset: 'reset',
  next: 'next',
  previous: 'previous',
  voiceOff: 'turn off voice control',
  camera: 'start camera',
  capture: 'capture',
  stopCamera: 'stop camera',
  flipCamera: 'flip camera',
  photo: 'choose photo',
  shareScreen: 'share screen',
  stopSharing: 'stop sharing',
  clearImage: 'clear image',
  usePattern: 'use this pattern',
  describeResult: 'what do the pins see',
};

const ORDINAL = /^(first|second|third|fourth|fifth|sixth|\d+(st|nd|rd|th))$/;

/** The number for a row or column: "row 3", "row three", "the third row". */
function numberFor(words: string[], axis: RegExp): number | null {
  for (let i = 0; i < words.length; i++) {
    if (!axis.test(words[i])) continue;
    // "the second row third column": the ordinal before the word is this one's ("third" belongs to the column).
    if (i > 0 && ORDINAL.test(words[i - 1])) return toNumber(words[i - 1]);
    const after = toNumber(words[i + 1]);
    if (after !== null) return after;
  }
  return null;
}

/** Raise, lower or toggle, from the words used. */
function actionIn(s: string): 'raise' | 'lower' | 'toggle' | null {
  if (/\b(lower|drop|down|sink|off|flat|lowered)\b/.test(s)) return 'lower';
  if (/\b(toggle|flip|tap|switch|change|press)\b/.test(s)) return 'toggle';
  if (/\b(raise|lift|up|on|raised|set)\b/.test(s)) return 'raise';
  return null;
}

/** Words that only carry the request, not what it's about. */
const strip = (s: string, words: RegExp) => s.replace(words, ' ').replace(/\s+/g, ' ').trim();

/** Common names for graphs, as equations. */
const CURVES: [RegExp, string][] = [
  [/\bparabola\b/, 'x squared'],
  [/\b(sine|sin) (wave|curve)\b/, 'sine of x'],
  [/\b(cosine|cos) (wave|curve)\b/, 'cosine of x'],
  [/\bstraight line\b/, 'x'],
  [/\bhyperbola\b/, '1 over x'],
  [/\bcubic\b/, 'x cubed'],
];

/**
 * The command to run for a kind of command, filled in from the sentence; null when something it needs (a row
 * number, a search) isn't there.
 */
export function rewrite(label: string, s: string, savedNames: readonly string[] = []): string | null {
  if (FIXED[label]) return FIXED[label];
  const words = s.split(' ');
  switch (label) {
    case 'pin': {
      const row = numberFor(words, /^(row|roe|rows)$/);
      const col = numberFor(words, /^(column|col|columns)$/);
      if (row === null || col === null) return null;
      return `${actionIn(s) ?? 'toggle'} row ${row} column ${col}`;
    }
    case 'line': {
      const column = /\b(column|col|columns)\b/.test(s);
      const n = numberFor(words, column ? /^(column|col|columns)$/ : /^(row|roe|rows|line)$/);
      const action = actionIn(s) ?? 'raise';
      if (n === null || action === 'toggle') return null;
      return `${action} ${column ? 'column' : 'row'} ${n}`;
    }
    case 'describeRow': {
      const n = numberFor(words, /^(row|roe|rows|line)$/);
      return n === null ? null : `read row ${n}`;
    }
    case 'shape': {
      if (/\barrow\b/.test(s)) return `show ${/\b(up|upward|upwards)\b/.test(s) ? 'up' : /\b(down|downward|downwards)\b/.test(s) ? 'down' : /\bleft\b/.test(s) ? 'left' : 'right'} arrow`;
      if (/\bline\b/.test(s)) return /\b(vertical|up and down|standing|top to bottom|upright)\b/.test(s) ? 'show vertical line' : 'show horizontal line';
      const shape = shapeIn(s);
      return shape ? `show ${shape}` : null;
    }
    case 'character': {
      const letter = /\b(?:(?:capital|uppercase|upper case|lowercase|lower case|small)\s+)?letter\s+(\w+)|\b(?:capital|uppercase|upper case|lowercase|lower case)\s+(?!letter\b)(\w+)/.exec(s);
      if (letter) {
        const said = letter[1] ?? letter[2];
        const ch = LETTER_NAMES[said] ?? (said.length === 1 ? said.toUpperCase() : null);
        return ch ? `letter ${ch}` : null;
      }
      const digit = /\b(?:number|digit)\s+(\w+)/.exec(s);
      if (digit) {
        const n = toNumber(digit[1]);
        return n !== null && n <= 9 ? `number ${n}` : null;
      }
      const rest = strip(s, /\b(show|me|the|a|an|display|write|draw|spell|out|put|up|give|make|type|on its own)\b/g).split(' ');
      if (rest.length !== 1 || !rest[0]) return null;
      const n = toNumber(rest[0]);
      if (n !== null && n <= 9) return `number ${n}`;
      const ch = LETTER_NAMES[rest[0]];
      return ch ? `letter ${ch}` : null;
    }
    case 'openSaved': {
      const name = strip(s, /\b(open|load|play|use|get|show|me|bring|up|my|the|saved|pattern|patterns|called|named)\b/g);
      if (!name) return null;
      return `open saved ${matchName(name, savedNames) ?? name}`;
    }
    case 'searchSaved': {
      const q = (/\b(?:for|called|named)\s+(.+)$/.exec(s)?.[1] ?? s)
        .replace(/\b(search|find|look|for|my|the|saved|patterns?|called|named)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return q ? `search for ${q}` : null;
    }
    case 'pictures': {
      const looks = /\bwhat (?:does|do) (?:an? |the |some )?(.+?) looks? like\b/.exec(s) ?? /\blooks? like (?:an? |the )?(.+)$/.exec(s);
      const of = /\b(?:of|for)\s+(?:an?\s+|the\s+|some\s+)?(.+)$/.exec(s);
      const q = (looks?.[1] ?? of?.[1] ?? strip(s, /\b(find|show|me|search|get|look|up|pictures?|photos?|images?|drawings?|online|internet|web|the|a|an|some|i|want|to|feel|see|google)\b/g))
        .replace(/\b(online|on the internet|on the web|pictures?|photos?|images?)$/, '')
        .trim();
      return q ? `find pictures of ${q}` : null;
    }
    case 'graph': {
      let eq = s;
      const y = /\b(y|f of x) (equals|is)\b.*$/.exec(s);
      if (y) eq = y[0];
      else {
        for (const [re, to] of CURVES) if (re.test(eq)) eq = to;
        eq = eq.replace(/^((graph|plot|draw|sketch|show|me|make|i|want|to|see|can|you|display|the|a|an|of|function|line|curve|equation)\s+)+/, '');
      }
      return eq ? `graph ${eq}` : null;
    }
    case 'navigate': {
      const tab = /\b(pin test|pin testing|test|testing)\b/.test(s)
        ? 'pin test'
        : /\b(saved|library|my patterns|patterns)\b/.test(s)
          ? 'saved'
          : /\b(image|images|picture|pictures|photo|photos|camera)\b/.test(s)
            ? 'image'
            : /\b(display|preview|home|main)\b/.test(s)
              ? 'display'
              : /\b(device|settings|bluetooth|connection|connect|board)\b/.test(s)
                ? 'device'
                : null;
      return tab ? `go to ${tab}` : null;
    }
    case 'setting': {
      const which: [RegExp, string, RegExp][] = [
        [/background/, 'remove background', /\b(keep|show|with|leave)\b/],
        [/\bcut ?out\b/, 'smart cutout', /\b(dont|no|stop)\b/],
        [/\b(axes|axis|grid ?lines)\b/, 'remove axes', /\b(show|keep)\b/],
        [/\b(labels?|text|words)\b/, 'ignore labels', /\b(keep|show|read|include)\b/],
        [/\b(thin|thick|one pin|lines?)\b/, 'one pin lines', /\bthick\b/],
        [/\bsnap/, 'snap', /\b(dont|no|stop)\b/],
      ];
      const found = which.find(([re]) => re.test(s));
      if (!found) return null;
      const on = /\boff\b|\b(disable|deactivate)\b/.test(s) ? false : /\bon\b|\b(enable|activate)\b/.test(s) ? true : !found[2].test(s);
      return `turn ${on ? 'on' : 'off'} ${found[1]}`;
    }
    case 'adjust': {
      const setting = /toleran/.test(s) ? 'tolerance' : /sensitiv/.test(s) ? 'sensitivity' : null;
      if (!setting) return null;
      const down = /\b(down|decrease|less|lower|reduce|smaller)\b/.test(s);
      return `${setting} ${down ? 'down' : 'up'}`;
    }
    default:
      return null;
  }
}

const UNKNOWN = (text: string): Command => ({ kind: 'unknown', heard: text.trim() });

/** Longest topic searched for when a sentence isn't a command: anything longer is likely talk, not a thing. */
export const TOPIC_WORDS = 4;
const TOPIC_DROP =
  /\b(show|draw|display|make|give|get|find|search|look|looks|feel|see|want|wanna|like|need|me|my|i|you|a|an|the|some|of|for|it|is|this|that|what|whats|which|who|how|does|do|can|to|on|pictures?|photos?|images?|shapes?|drawings?|pins?|board)\b/g;

/**
 * What to search pictures for when a sentence isn't a command ("I want to feel a giraffe" → "giraffe"), or null
 * when nothing is left or it's too long to be the name of a thing.
 */
export function searchTopic(text: string): string | null {
  const s = tidy(text);
  const looks = /\bwhat (?:does|do|is) (?:an? |the )?(.+?) looks? like\b/.exec(s);
  const q = strip(looks?.[1] ?? s, TOPIC_DROP);
  if (!/[a-z]{2}/.test(q) || q.split(' ').length > TOPIC_WORDS) return null;
  return q;
}

/** What a sentence asks for. `savedNames`: the saved patterns, which can be opened by name. */
export function understand(text: string, savedNames: readonly string[] = []): Understanding {
  const ruled = parseCommand(text, savedNames);
  const tidied = tidy(text);
  const ranked = tidied && familiarity(tidied) >= FAMILIAR ? classify(tidied) : [];
  const top = ranked[0];

  // The model's reading, filled in and checked by the rules. It only counts when the sentence has a word of that
  // kind of command: otherwise the sentence names a thing (any thing), which is searched for as a picture.
  const modelReading = () => {
    if (!top || top.label === 'none' || !anchored(tidied, top.label)) return null;
    const canonical = rewrite(top.label, tidied, savedNames);
    if (!canonical) return null;
    const command = parseCommand(canonical, savedNames);
    return command.kind === 'unknown' || labelOf(command) !== top.label ? null : { command, canonical };
  };

  if (ruled.kind !== 'unknown') {
    // A saved pattern that doesn't exist is a weak reading ("use the back camera" isn't a pattern called "back
    // camera"): the model's reading goes first, as if the rules hadn't matched. Anything else, the model must be all
    // but certain to overrule.
    const weak = ruled.kind === 'savedUnknown';
    if (top && top.label !== labelOf(ruled) && top.probability >= (weak ? ASK : OVERRULE)) {
      const m = modelReading();
      if (m && top.probability >= ACT) return { command: m.command, how: 'model', intent: top };
      if (m) return { command: UNKNOWN(text), confirm: m.canonical, how: 'model', intent: top };
    }
    return { command: ruled, how: 'rules', intent: top };
  }

  if (tidied && tidied !== normalise(text)) {
    const c = parseCommand(tidied, savedNames);
    if (c.kind !== 'unknown') return { command: c, how: 'rules', intent: top };
  }

  const m = modelReading();
  if (m && top.probability >= ACT) return { command: m.command, how: 'model', intent: top };
  if (m && top.probability >= ASK) return { command: UNKNOWN(text), confirm: m.canonical, how: 'model', intent: top };
  return { command: ruled, how: 'none', intent: top };
}
