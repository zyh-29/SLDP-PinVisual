/**
 * On-device AI help, where the browser has a model built in (Chrome on Windows, macOS, Linux and Chromebook Plus,
 * with Gemini Nano downloaded): a sentence the command list doesn't know ("put a love heart up") is rewritten as
 * one of the listed commands ("show a heart"). The app then asks "Did you mean …?" before doing anything, so a
 * wrong guess costs a "no". Nothing leaves the computer. Elsewhere it does nothing and commands work as listed.
 *
 * The model is never downloaded by the app: Chrome downloads it itself (several GB); until it has, this is off.
 */
import type { AiStatus } from './aiFallback';

export type { AiStatus };

interface Session {
  prompt(input: string, o?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  clone(): Promise<Session>;
  destroy(): void;
}
interface LanguageModelApi {
  availability(o?: object): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create(o?: object): Promise<Session>;
}

const LANGS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

const api = (): LanguageModelApi | null =>
  typeof window !== 'undefined' ? ((window as unknown as { LanguageModel?: LanguageModelApi }).LanguageModel ?? null) : null;

export async function aiStatus(): Promise<AiStatus> {
  const lm = api();
  if (!lm) return 'unavailable';
  try {
    const a = await lm.availability(LANGS);
    return a === 'available' ? 'available' : a === 'unavailable' ? 'unavailable' : 'downloadable';
  } catch {
    return 'unavailable';
  }
}

const SYSTEM = `You help a blind person control PinVisual, an app for a 5 by 6 tactile pin display.
Rewrite what they said as exactly ONE command from this list, filling in the parts in angle brackets.
If nothing fits, answer with an empty command. Never invent other commands.

show a <circle | square | triangle | diamond | cross | plus | heart | smile | checkerboard | horizontal line | vertical line | arrow up | arrow down | arrow left | arrow right>
letter <A to Z>
number <0 to 9>
raise row <1-5> column <1-6>
lower row <1-5> column <1-6>
raise row <1-5> / lower row <1-5> / raise column <1-6> / lower column <1-6>
clear / fill / invert / undo / redo
what's on the board / read row <1-5>
open saved <name>
send / reset
graph y equals <equation using x, written like x^2 - 3 or sin(x)>
start camera / capture / stop camera / flip camera / choose photo / share screen / stop sharing / clear image
use this pattern / what do the pins see
turn on <remove background | smart cut-out | remove axes | labels | one pin lines | snap>
turn off <remove background | smart cut-out | remove axes | labels | one pin lines | snap>
tolerance up / tolerance down / sensitivity up / sensitivity down
go to <display | image | saved | pin test | device>
search for <name> / find pictures of <thing> / next / previous
help`;

const EXAMPLES: [string, string][] = [
  ['can you put a love heart up', 'show a heart'],
  ['make the whole second line stick up', 'raise row 2'],
  ['draw me a parabola', 'graph y equals x^2'],
  ['I want to feel a picture of a dog', 'find pictures of dog'],
  ['turn the camera on please', 'start camera'],
  ['get rid of everything', 'clear'],
  ['what time is it', ''],
];

const SCHEMA = { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false };

let base: Promise<Session> | null = null;

function session(lm: LanguageModelApi): Promise<Session> {
  base ??= lm
    .create({
      ...LANGS,
      initialPrompts: [
        { role: 'system', content: SYSTEM },
        ...EXAMPLES.flatMap(([said, command]) => [
          { role: 'user', content: said },
          { role: 'assistant', content: JSON.stringify({ command }) },
        ]),
      ],
    })
    .catch((e) => {
      base = null;
      throw e;
    });
  return base;
}

/** A listed command for what was said, or null (no model here, nothing fits, or it took too long). */
export async function aiSuggest(said: string): Promise<string | null> {
  const lm = api();
  if (!lm || (await aiStatus()) !== 'available') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let s: Session | null = null;
  try {
    // A fresh copy each time, so one request never colours the next.
    s = await (await session(lm)).clone();
    const raw = await s.prompt(said, { responseConstraint: SCHEMA, signal: ctrl.signal });
    const command = (JSON.parse(raw) as { command?: unknown }).command;
    return typeof command === 'string' && command.trim() ? command.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    s?.destroy();
  }
}
