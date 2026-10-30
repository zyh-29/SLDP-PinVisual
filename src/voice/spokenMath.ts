/**
 * Spoken maths to an equation the app can draw: "y equals x squared minus three" -> "x^2 - 3", read back as
 * "y equals x squared, minus 3". Typed maths ("y = x^2 - 3", "sin(2x)") goes through the same reader.
 *
 * The rules a listener needs to know, kept few and consistent:
 * - A function or root applies to the next term only: "sine of x plus one" is sin(x) + 1.
 * - "the quantity ..." groups everything after it: "sine of the quantity x plus one" is sin(x + 1).
 *   "end quantity" (or "close bracket") ends a group early.
 * - "over" divides by the next term only: "one over x plus one" is 1/x + 1.
 * The read-back uses the same words, so what is drawn is what is heard.
 */

type Node =
  | { k: 'num'; v: number }
  | { k: 'x' }
  | { k: 'const'; name: 'pi' | 'e' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'fn'; name: FnName; a: Node }
  | { k: 'group'; a: Node };

type FnName = 'sin' | 'cos' | 'tan' | 'sqrt' | 'cbrt' | 'abs' | 'ln' | 'log' | 'exp';

type Tok = { t: 'num'; v: number } | { t: 'w'; v: string };

const SMALL: Record<string, number> = {
  zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** "x to the fourth": ordinals after a power are numbers. */
const ORDINALS: Record<string, number> = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const FRACTIONS: Record<string, number> = { half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5 };

/** Phrases replaced before reading, longest first (what recognisers write, and the different ways to say it). */
const PHRASES: [RegExp, string][] = [
  [/\bf of x\b|\bf\(x\)|\bg of x\b|\by of x\b/g, 'y'],
  [/\b(is equal to|equals|equal|is)\b/g, '='],
  [/\bcube root( of)?\b/g, ' cbrt '],
  [/\b(square root|root)( of)?\b/g, ' sqrt '],
  [/\b(absolute value|modulus|mod)( of)?\b/g, ' abs '],
  [/\bnatural log(arithm)?( of)?\b/g, ' ln '],
  [/\blog(arithm)?( of)?\b/g, ' log '],
  [/\b(e to the power of|e to the|exponential of|exp of)\b/g, ' exp '],
  [/\b(cosine|cos|co sign|cosign|co sine)( of)?\b/g, ' cos '],
  [/\b(sine|sin|sign|sein)( of)?\b/g, ' sin '],
  [/\b(tangent|tan)( of)?\b/g, ' tan '],
  [/\b(to the power of|raised to the power of|raised to|to the power|power of|to the)\b/g, ' ^ '],
  [/\b(squared|square)\b/g, ' ^ 2 '],
  [/\b(cubed|cube)\b/g, ' ^ 3 '],
  [/\b(multiplied by|times|multiply by|into)\b/g, ' * '],
  [/\b(divided by|over|divide by)\b/g, ' / '],
  [/\b(plus|add|and)\b/g, ' + '],
  [/\b(minus|take away|subtract|less)\b/g, ' - '],
  [/\b(negative|the negative of)\b/g, ' neg '],
  [/\b(the quantity|quantity|open bracket|open parenthesis|open paren|bracket)\b/g, ' ( '],
  [/\b(end quantity|close bracket|close parenthesis|close paren|end bracket)\b/g, ' ) '],
  [/\b(pie|pi)\b/g, ' pi '],
  [/\b(ex|eggs|axe|x's)\b/g, ' x '],
  [/\bpower\b/g, ''],
  [/(\d)(st|nd|rd|th)\b/g, '$1'],
];

function tokenize(text: string): Tok[] {
  let s = ` ${text.toLowerCase().replace(/[−–]/g, '-').replace(/×|·/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, ' pi ').replace(/\*\*/g, '^')} `;
  // "the quantity" before PHRASES's "the" handling; "end quantity" before "quantity".
  s = s.replace(/\bend quantity\b/g, ' ) ');
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  s = s.replace(/([()^*/+=-])/g, ' $1 ').replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  const words = s.split(/\s+/).filter((w) => w && !/^(the|a|an|of|graph|plot|draw|show|me|please|function)$/.test(w));
  // Number words: "twenty five", "two point five", "one half", "three quarters"
  const out: Tok[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (words[i - 1] === '^' && ORDINALS[w]) {
      out.push({ t: 'num', v: ORDINALS[w] });
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(w) || w in SMALL || w in TENS) {
      let v = /^\d/.test(w) ? Number(w) : (SMALL[w] ?? TENS[w]);
      if (w in TENS && SMALL[words[i + 1]] !== undefined && SMALL[words[i + 1]] < 10) v += SMALL[words[++i]];
      if (words[i + 1] === 'point' && words[i + 2] !== undefined) {
        const digits: string[] = [];
        let j = i + 2;
        while (j < words.length && (/^\d$/.test(words[j]) || (SMALL[words[j]] !== undefined && SMALL[words[j]] < 10))) {
          digits.push(String(/^\d$/.test(words[j]) ? words[j] : SMALL[words[j]]));
          j++;
        }
        if (digits.length) {
          v = Number(`${v}.${digits.join('')}`);
          i = j - 1;
        }
      }
      const frac = FRACTIONS[words[i + 1]];
      if (frac && !(words[i + 1] === 'fourth' && v === 0)) {
        out.push({ t: 'num', v: v / frac });
        i++;
        continue;
      }
      out.push({ t: 'num', v });
    } else if (w === 'a' && FRACTIONS[words[i + 1]]) {
      out.push({ t: 'num', v: 1 / FRACTIONS[words[++i]] });
    } else if (w === 'half' || w === 'quarter') {
      out.push({ t: 'num', v: 1 / FRACTIONS[w] });
    } else if (w === 'point' && /^\d+$/.test(words[i + 1] ?? '')) {
      out.push({ t: 'num', v: Number(`0.${words[++i]}`) });
    } else out.push({ t: 'w', v: w });
  }
  return out;
}

const FNS = new Set<FnName>(['sin', 'cos', 'tan', 'sqrt', 'cbrt', 'abs', 'ln', 'log', 'exp']);

class Reader {
  private i = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private isW(v: string) {
    const t = this.peek();
    return t?.t === 'w' && t.v === v;
  }
  private take(v: string) {
    if (this.isW(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  done() {
    return this.i >= this.toks.length;
  }
  rest() {
    return this.toks.slice(this.i).map((t) => (t.t === 'num' ? String(t.v) : t.v)).join(' ');
  }

  expr(): Node {
    let a = this.term();
    for (;;) {
      if (this.take('+')) a = { k: 'bin', op: '+', a, b: this.term() };
      else if (this.take('-')) a = { k: 'bin', op: '-', a, b: this.term() };
      else return a;
    }
  }

  term(): Node {
    let a = this.factor();
    for (;;) {
      if (this.take('*')) a = { k: 'bin', op: '*', a, b: this.factor() };
      else if (this.take('/')) a = { k: 'bin', op: '/', a, b: this.tight() }; // "one over two x" is 1/(2x)
      else if (this.startsAtom()) a = { k: 'bin', op: '*', a, b: this.factor() }; // 2x, 3 sin x
      else return a;
    }
  }

  /** A run of implicitly multiplied pieces with powers ("2 x squared"): what a function or "over" applies to. */
  tight(): Node {
    let a = this.power();
    while (this.startsAtom() && !this.startsFn()) a = { k: 'bin', op: '*', a, b: this.power() };
    return a;
  }

  factor(): Node {
    return this.power();
  }

  power(): Node {
    const a = this.unary();
    if (this.take('^')) return { k: 'bin', op: '^', a, b: this.unary() };
    return a;
  }

  unary(): Node {
    if (this.take('-') || this.take('neg')) return { k: 'neg', a: this.power() };
    return this.atom();
  }

  private startsFn() {
    const t = this.peek();
    return t?.t === 'w' && FNS.has(t.v as FnName);
  }

  private startsAtom() {
    const t = this.peek();
    if (!t) return false;
    if (t.t === 'num') return true;
    return t.v === 'x' || t.v === 'pi' || t.v === 'e' || t.v === '(' || FNS.has(t.v as FnName);
  }

  atom(): Node {
    const t = this.peek();
    if (!t) throw new Error('The equation stops too early.');
    this.i++;
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.v === 'x') return { k: 'x' };
    if (t.v === 'pi' || t.v === 'e') return { k: 'const', name: t.v };
    if (t.v === '(') {
      const a = this.expr();
      this.take(')');
      return { k: 'group', a };
    }
    if (FNS.has(t.v as FnName)) {
      // "sin(x + 1)" and "sine of the quantity x plus one" group; otherwise the next term only.
      const a = this.isW('(') ? this.atom() : this.tight();
      return { k: 'fn', name: t.v as FnName, a };
    }
    throw new Error(`“${t.v}” isn't part of an equation I know.`);
  }
}

/** The expression as the app's equation reader takes it. */
function toText(n: Node): string {
  switch (n.k) {
    case 'num':
      return String(n.v);
    case 'x':
      return 'x';
    case 'const':
      return n.name;
    case 'neg':
      return `-${wrap(n.a, 4)}`;
    case 'group':
      return `(${toText(n.a)})`;
    case 'fn':
      return n.name === 'cbrt' ? `(${toText(n.a)})^(1/3)` : `${n.name}(${unwrap(n.a)})`;
    case 'bin': {
      const p = PREC[n.op];
      const right = n.op === '-' || n.op === '/' || n.op === '^' ? p + 1 : p;
      return `${wrap(n.a, n.op === '^' ? p + 1 : p)} ${n.op} ${wrap(n.b, right)}`.replace(/ \^ /g, '^');
    }
  }
}
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 } as const;
const prec = (n: Node) => (n.k === 'bin' ? PREC[n.op] : n.k === 'neg' ? 2.5 : 4);
const wrap = (n: Node, min: number) => (prec(n) < min && n.k !== 'group' ? `(${toText(n)})` : toText(n));
const unwrap = (n: Node) => (n.k === 'group' ? toText(n.a) : toText(n));

const FN_WORDS: Record<FnName, string> = {
  sin: 'sine of',
  cos: 'cosine of',
  tan: 'tangent of',
  sqrt: 'the square root of',
  cbrt: 'the cube root of',
  abs: 'the absolute value of',
  ln: 'the natural log of',
  log: 'log of',
  exp: 'e to the',
};

const say = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

/** The expression in words, with the same rules as listening (a group is "the quantity ..."). */
function toWords(n: Node): string {
  switch (n.k) {
    case 'num':
      return say(n.v);
    case 'x':
      return 'x';
    case 'const':
      return n.name === 'pi' ? 'pi' : 'e';
    case 'neg':
      return `negative ${toWords(n.a)}`;
    case 'group':
      return `the quantity ${toWords(n.a)}`;
    case 'fn': {
      // "the quantity" only where it changes the meaning: a sum or difference inside.
      const sum = n.a.k === 'group' && n.a.a.k === 'bin' && (n.a.a.op === '+' || n.a.a.op === '-');
      const inner = n.a.k === 'group' ? (sum ? `the quantity ${toWords(n.a.a)}` : toWords(n.a.a)) : toWords(n.a);
      return `${FN_WORDS[n.name]} ${inner}`;
    }
    case 'bin': {
      if (n.op === '^' && n.b.k === 'num' && n.b.v === 2) return `${toWords(n.a)} squared`;
      if (n.op === '^' && n.b.k === 'num' && n.b.v === 3) return `${toWords(n.a)} cubed`;
      if (n.op === '^') return `${toWords(n.a)} to the power ${toWords(n.b)}`;
      if (n.op === '*') {
        // "2 x", "3 sine of x": implicit products read as they're said.
        return `${toWords(n.a)} ${n.b.k === 'num' ? 'times ' : ''}${toWords(n.b)}`;
      }
      const word = { '+': 'plus', '-': 'minus', '/': 'over' }[n.op];
      // A comma after a function or root ends it audibly: "sine of x, plus 1".
      const pause = n.a.k === 'fn' && (n.op === '+' || n.op === '-') ? ',' : '';
      return `${toWords(n.a)}${pause} ${word} ${toWords(n.b)}`;
    }
  }
}

export interface SpokenEquation {
  /** For the equation reader, e.g. "y = x^2 - 3". */
  text: string;
  /** To read back, e.g. "y equals x squared minus 3". */
  words: string;
}

/** Reads spoken (or typed) maths. Throws with a message that says what wasn't understood. */
export function readSpokenEquation(said: string): SpokenEquation {
  const toks = tokenize(said);
  // "y =" in front is optional.
  const eq = toks.findIndex((t) => t.t === 'w' && t.v === '=');
  const body = eq >= 0 ? toks.slice(eq + 1) : toks;
  if (eq > 1 || (eq === 1 && !(toks[0].t === 'w' && toks[0].v === 'y'))) throw new Error('Say y equals, then the equation.');
  if (!body.length) throw new Error('Say the equation after y equals.');
  const r = new Reader(body);
  const n = r.expr();
  if (!r.done()) throw new Error(`“${r.rest()}” isn't part of an equation I know.`);
  const expr = toText(n);
  if (!/x/.test(expr)) throw new Error('The equation needs an x in it.');
  return { text: `y = ${expr}`, words: `y equals ${toWords(n)}` };
}
