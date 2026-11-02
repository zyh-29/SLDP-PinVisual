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
    expect(understand('turn the camera on')).toMatchObject({ command: { kind: 'image', action: 'camera' } });
    expect(understand('make the fourth column stick up').command).toEqual({ kind: 'line', action: 'raise', axis: 'column', index: 4 });
  });

  it('reads the details from the sentence, not the model', () => {
    expect(understand('lift the pin in the second row third column').command).toEqual({ kind: 'pin', action: 'raise', row: 2, col: 3 });
    expect(understand('i want to feel a picture of a tree').command).toEqual({ kind: 'search', query: 'tree', pictures: true });
  });

  it('never acts on things that are not commands', () => {
    for (const s of ['what time is it', 'pizza', 'hello there', 'blah blah', 'the weather is nice', 'um', ''])
      expect(understand(s).command.kind).toBe('unknown');
  });

  it("doesn't trust the model with words it never learned", () => {
    expect(familiarity('pizza')).toBe(0);
    expect(familiarity('show a sqare')).toBe(1); // a near misspelling counts
    expect(understand('pizza').intent).toBeUndefined();
  });

  it('a saved pattern that does not exist gives way to the model', () => {
    // The rules alone read this as opening a saved pattern called "the back camera".
    expect(understand('use the back camera').command).toMatchObject({ kind: 'image', action: 'flipCamera' });
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
