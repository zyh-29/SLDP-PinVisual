import { type Command, matchName, normalise, parseCommand } from '../commands';

const saved = ['Morning', 'House', 'Smiley face', 'Row test'];
const p = (s: string) => parseCommand(s, saved);

describe('voice commands', () => {
  it.each<[string, Command]>([
    ['Show a circle.', { kind: 'shape', shape: 'circle' }],
    ['please draw an up arrow', { kind: 'shape', shape: 'arrow up' }],
    ['heart', { kind: 'shape', shape: 'heart' }],
    ['make a box', { kind: 'shape', shape: 'square' }],
    ['show me a horizontal line', { kind: 'shape', shape: 'horizontal line' }],
    ['letter B', { kind: 'character', char: 'B' }],
    ['show the letter bee', { kind: 'character', char: 'B' }],
    ['show a', { kind: 'character', char: 'A' }],
    ['capital why', { kind: 'character', char: 'Y' }],
    ['number three', { kind: 'character', char: '3' }],
    ['show 7', { kind: 'character', char: '7' }],
    ['Raise row 2 column 3', { kind: 'pin', action: 'raise', row: 2, col: 3 }],
    ['raise row to column three', { kind: 'pin', action: 'raise', row: 2, col: 3 }],
    ['lower row five column six', { kind: 'pin', action: 'lower', row: 5, col: 6 }],
    ['row 1 column 4 up', { kind: 'pin', action: 'raise', row: 1, col: 4 }],
    ['toggle column 2 row 3', { kind: 'pin', action: 'toggle', row: 3, col: 2 }],
    ['row 2 column 2', { kind: 'pin', action: 'toggle', row: 2, col: 2 }],
    ['pin 2 3', { kind: 'pin', action: 'toggle', row: 2, col: 3 }],
    ['raise row 2', { kind: 'line', action: 'raise', axis: 'row', index: 2 }],
    ['lower column four', { kind: 'line', action: 'lower', axis: 'column', index: 4 }],
    ['clear', { kind: 'clear' }],
    ['clear the grid', { kind: 'clear' }],
    ['lower all pins', { kind: 'clear' }],
    ['raise all', { kind: 'fill' }],
    ['invert', { kind: 'invert' }],
    ['undo', { kind: 'undo' }],
    ['go back', { kind: 'undo' }],
    ['redo', { kind: 'redo' }],
    ["What's on the board?", { kind: 'describe' }],
    ['describe', { kind: 'describe' }],
    ['read row 3', { kind: 'describeRow', row: 3 }],
    ['send', { kind: 'send' }],
    ['send it to the board', { kind: 'send' }],
    ['reset physical pins', { kind: 'reset' }],
    ['reset', { kind: 'reset' }],
    ['yes', { kind: 'yes' }],
    ['okay', { kind: 'yes' }],
    ['cancel', { kind: 'no' }],
    ['help', { kind: 'help' }],
    ['what can I say', { kind: 'help' }],
    ['say that again', { kind: 'repeat' }],
    ['stop', { kind: 'stop' }],
    ['open saved morning', { kind: 'saved', name: 'Morning' }],
    ['load house', { kind: 'saved', name: 'House' }],
    ['open saved mornin', { kind: 'saved', name: 'Morning' }],
    ['show saved smiley face', { kind: 'saved', name: 'Smiley face' }],
    ['open saved garden', { kind: 'savedUnknown', heard: 'garden' }],
    ['play the trumpet', { kind: 'unknown', heard: 'play the trumpet' }],
  ])('%s', (said, expected) => {
    expect(p(said)).toEqual(expected);
  });

  it('a shape name beats a saved pattern only when "saved" or "open" is not said', () => {
    expect(p('show a smiley face')).toEqual({ kind: 'shape', shape: 'smile' });
    expect(p('open smiley face')).toEqual({ kind: 'saved', name: 'Smiley face' });
  });

  it('takes off filler words', () => {
    expect(normalise('Hey, could you please clear the grid now?')).toBe('clear the grid');
  });

  it('matches names loosely but not wildly', () => {
    expect(matchName('house', saved)).toBe('House');
    expect(matchName('smiley', saved)).toBe('Smiley face');
    expect(matchName('garden', saved)).toBeNull();
  });

  it('empty or nonsense is unknown', () => {
    expect(p('').kind).toBe('unknown');
    expect(p('um').kind).toBe('unknown');
  });
});

describe('graph, Image tab, search and navigation commands', () => {
  it.each<[string, Command]>([
    ['graph y equals x squared', { kind: 'graph', said: 'y equals x squared' }],
    ['plot sine of x', { kind: 'graph', said: 'sine of x' }],
    ['draw the graph of x cubed', { kind: 'graph', said: 'x cubed' }],
    ['y equals two x plus one', { kind: 'graph', said: 'y equals two x plus one' }],
    ['y = x^2 - 3', { kind: 'graph', said: 'y = x^2 - 3' }],
    ['draw x squared minus four', { kind: 'graph', said: 'x squared minus four' }],
    ['start camera', { kind: 'image', action: 'camera' }],
    ['turn on the camera', { kind: 'image', action: 'camera' }],
    ['take a picture', { kind: 'image', action: 'capture' }],
    ['capture', { kind: 'image', action: 'capture' }],
    ['stop the camera', { kind: 'image', action: 'stopCamera' }],
    ['flip camera', { kind: 'image', action: 'flipCamera' }],
    ['choose a photo', { kind: 'image', action: 'photo' }],
    ['share my screen', { kind: 'image', action: 'shareScreen' }],
    ['stop sharing', { kind: 'image', action: 'stopSharing' }],
    ['clear the image', { kind: 'image', action: 'clearImage' }],
    ['use this pattern', { kind: 'image', action: 'usePattern' }],
    ['what do the pins see', { kind: 'image', action: 'describeResult' }],
    ['turn off remove background', { kind: 'setting', setting: 'removeBackground', on: false }],
    ['smart cutout on', { kind: 'setting', setting: 'smartCutout', on: true }],
    ['one pin lines off', { kind: 'setting', setting: 'oneLine', on: false }],
    ['tolerance up', { kind: 'adjust', setting: 'tolerance', up: true }],
    ['lower the sensitivity', { kind: 'adjust', setting: 'sensitivity', up: false }],
    ['go to the image tab', { kind: 'navigate', tab: 'image' }],
    ['open device', { kind: 'navigate', tab: 'device' }],
    ['show saved', { kind: 'navigate', tab: 'saved' }],
    ['search for house', { kind: 'search', query: 'house', pictures: false }],
    ['find pictures of a cat', { kind: 'search', query: 'cat', pictures: true }],
    ['show me a photo of the eiffel tower', { kind: 'search', query: 'eiffel tower', pictures: true }],
    ['next', { kind: 'next', back: false }],
    ['another one', { kind: 'next', back: false }],
    ['previous', { kind: 'next', back: true }],
    ['voice control off', { kind: 'voiceOff' }],
  ])('%s', (said, expected) => {
    expect(p(said)).toEqual(expected);
  });

  it('shapes and letters still win over graphs without maths in them', () => {
    expect(p('draw a circle')).toEqual({ kind: 'shape', shape: 'circle' });
    expect(p('draw a line')).toEqual({ kind: 'shape', shape: 'horizontal line' });
    expect(p('show x')).toEqual({ kind: 'character', char: 'X' });
    expect(p('open saved morning')).toEqual({ kind: 'saved', name: 'Morning' });
  });
});
