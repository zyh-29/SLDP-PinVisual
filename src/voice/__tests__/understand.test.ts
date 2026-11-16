import { classify, familiarity } from '../intent/model';
import { WEIGHTS } from '../intent/weights';
import { rewrite, tidy, understand } from '../understand';

describe('tidy', () => {
  it('takes filler out anywhere and folds in known words', () => {
    expect(tidy('Could you just clear it now, please?')).toBe('clear it');
    expect(tidy('draw a hart')).toBe('draw a heart');
    expect(tidy('show me a pyramid')).toBe('show me a triangle');
  });
});

describe('understand', () => {
  it('uses the rules first, unchanged', () => {
    expect(understand('raise row 2 column 3')).toMatchObject({ how: 'rules', command: { kind: 'pin', action: 'raise', row: 2, col: 3 } });
    expect(understand('graph y equals x squared').command.kind).toBe('graph');
  });

  it('understands natural wording through the voice model', () => {
    expect(understand('get rid of everything')).toMatchObject({ how: 'model', command: { kind: 'clear' } });
    expect(understand('make the fourth column stick up').command).toEqual({ kind: 'line', action: 'raise', axis: 'column', index: 4 });
  });

  it('reads the details from the sentence, not the model', () => {
    expect(understand('lift the pin in the second row third column').command).toEqual({ kind: 'pin', action: 'raise', row: 2, col: 3 });
  });

  it('never acts on things that are not commands, or commands the app no longer has', () => {
    for (const s of ['what time is it', 'pizza', 'hello there', 'blah blah', 'the weather is nice', 'um', '', 'turn the camera on', 'take a picture', 'find pictures of a cat', 'next one'])
      expect(understand(s).command.kind).toBe('unknown');
  });

  it('reads a thing as a thing, never as a command it looks like', () => {
    // Any thing at all, including words the model learned or that look like commands ("flower" / "lower").
    const things = ['grenade', 'a grenade', 'show me a grenade', 'a giraffe please', 'the eiffel tower', 'flower', 'banana', 'a cake',
      'frog', 'ship', 'house', 'a tree', 'shark', 'statue', 'a crab', 'show me a rocket'];
    for (const s of things) {
      const u = understand(s);
      expect(u.command.kind).toBe('unknown');
      expect(u.confirm).toBeUndefined();
    }
  });

  it("doesn't trust the model with words it never learned", () => {
    expect(familiarity('pizza')).toBe(0);
    expect(familiarity('show a sqare')).toBe(1); // a near misspelling counts
    expect(understand('pizza').intent).toBeUndefined();
  });
});

describe('rewrite', () => {
  it('fills in each kind of command', () => {
    expect(rewrite('shape', 'an arrow facing down')).toBe('show down arrow');
    expect(rewrite('character', 'capital letter r')).toBe('letter R');
    expect(rewrite('setting', 'keep the background')).toBe('turn off remove background');
    expect(rewrite('adjust', 'make it less sensitive')).toBe('sensitivity down');
    expect(rewrite('navigate', 'take me to bluetooth')).toBe('go to device');
    expect(rewrite('graph', 'draw a parabola')).toBe('graph x squared');
    expect(rewrite('pin', 'raise row 2')).toBeNull(); // no column: not a pin
  });
});

describe('the voice model', () => {
  it('is small and quick', () => {
    expect(WEIGHTS.e.length + WEIGHTS.w.length).toBeLessThan(250_000);
    classify('warm up');
    const start = performance.now();
    for (let i = 0; i < 1000; i++) classify('could you please raise row two column three');
    const each = (performance.now() - start) / 1000;
    expect(each).toBeLessThan(1); // milliseconds
  });
});
