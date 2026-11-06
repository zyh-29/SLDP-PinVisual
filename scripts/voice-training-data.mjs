// Training sentences for the voice model (scripts/train-voice-model.mjs): many ways of saying each kind of
// command, put together from lists of verbs, objects and synonyms, with filler words ("please", "can you"),
// speech-recogniser mistakes ("hart", "row too") and typos mixed in. Seeded, so every run makes the same data.
//
// Each label is a kind of command. The model only decides the kind; the details (which row, which shape, what to
// search for) are read from the sentence by src/voice/understand.ts.

/** Small fast seeded random numbers (mulberry32). */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Saved pattern names used in examples. */
export const NAMES = ['house', 'morning', 'star', 'robot', 'flower', 'my name', 'test one', 'cat', 'smiley', 'boat', 'tree', 'rocket', 'sun', 'class demo', 'pattern one', 'lesson two', 'map', 'fish'];
/** Things to find pictures of. */
export const THINGS = ['cat', 'dog', 'dogs', 'house', 'car', 'apple', 'tree', 'bird', 'giraffe', 'butterfly', 'moon', 'horse', 'elephant', 'plane', 'airplane', 'boat', 'flower', 'guitar', 'chair', 'bicycle', 'fish', 'star', 'rabbit', 'lion', 'shoe', 'cup', 'banana', 'train', 'castle', 'whale', 'spider', 'key', 'umbrella', 'mountain', 'eiffel tower'];
/** Filler said before and after a command. */
export const PRE = ['please', 'can you', 'could you', 'would you', 'i want to', 'id like to', 'i would like to', 'lets', 'now', 'ok', 'okay', 'hey', 'um', 'uh', 'so', 'just', 'go ahead and', 'pinvisual', 'i need to', 'can we', 'could we', 'i want you to', 'right'];
export const POST = ['please', 'now', 'for me', 'thanks', 'thank you', 'right now', 'quickly', 'ok', 'if you can', 'pinvisual'];

export function examples(seed = 1, perLabel = 400, { noise = true } = {}) {
  const rnd = random(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const maybe = (s, p = 0.5) => (rnd() < p ? (typeof s === 'function' ? s() : s) : '');
  const join = (...parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  const wrap = (s) => join(maybe(() => pick(PRE), 0.35), s, maybe(() => pick(POST), 0.25));

  // Numbers as a speech recogniser writes them.
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const SOUNDS = { 1: ['won'], 2: ['to', 'too'], 3: ['tree'], 4: ['for', 'fore'], 8: ['ate'] };
  const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  const num = (n) => {
    const r = rnd();
    if (r < 0.4) return String(n);
    if (r < 0.85 || !SOUNDS[n]) return WORDS[n];
    return pick(SOUNDS[n]);
  };
  const ART = ['a', 'an', 'the', 'one', 'some', ''];

  const RAISE = ['raise', 'lift', 'push up', 'put up', 'pop up', 'set', 'bring up', 'turn on'];
  const LOWER = ['lower', 'drop', 'push down', 'put down', 'sink', 'turn off', 'bring down'];
  const TOGGLE = ['toggle', 'flip', 'tap', 'switch', 'change', 'press'];
  const UPWORDS = ['up', 'go up', 'stick up', 'come up', 'raised', 'on'];
  const DOWNWORDS = ['down', 'go down', 'flat', 'lowered', 'off'];

  const SHAPES = [
    'circle', 'round shape', 'ball', 'dot', 'oval', 'square', 'box', 'block', 'rectangle', 'triangle', 'pyramid',
    'diamond', 'rhombus', 'heart', 'love heart', 'hart', 'smiley', 'smiley face', 'happy face', 'smiling face', 'smile',
    'cross', 'x shape', 'times sign', 'plus', 'plus sign', 'checkerboard', 'chess board', 'checker pattern', 'checkered pattern',
    'up arrow', 'arrow pointing up', 'arrow facing up', 'down arrow', 'arrow pointing down', 'arrow facing down',
    'left arrow', 'arrow pointing left', 'arrow to the left', 'right arrow', 'arrow pointing right', 'arrow to the right',
    'horizontal line', 'line across', 'flat line', 'vertical line', 'line going up and down', 'standing line', 'ring', 'star',
  ];
  const OUTLINABLE = ['circle', 'square', 'triangle', 'diamond', 'box'];
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const LETTER_SOUNDS = { b: ['bee', 'be'], c: ['see', 'sea'], d: ['dee'], g: ['gee'], j: ['jay'], k: ['kay'], o: ['oh'], p: ['pee'], q: ['cue', 'queue'], r: ['are'], t: ['tee', 'tea'], u: ['you'], y: ['why'], z: ['zed', 'zee'] };
  const letter = (l) => (LETTER_SOUNDS[l] && rnd() < 0.4 ? pick(LETTER_SOUNDS[l]) : l);
  const EQS = ['y equals x squared', 'x squared', 'x cubed', 'sine of x', 'sin x', 'cosine of x', 'cosine x', 'one over x', '1 over x', 'square root of x', 'y equals 2 x plus 1', 'x plus 3', 'y equals x', 'tangent of x', 'y equals x squared minus 3', 'two x minus one', 'a parabola', 'a sine wave', 'a cosine wave', 'a straight line', 'a hyperbola', 'y = x^2', 'the absolute value of x', 'x to the power of 3', 'half x', 'negative x squared'];

  const GEN = {
    clear: () =>
      rnd() < 0.7
        ? join(pick(['clear', 'wipe', 'erase', 'empty', 'blank', 'clean', 'reset', 'remove everything from', 'get rid of everything on', 'lower all the pins in', 'delete everything on', 'rub out', 'clear out', 'wipe out']), pick(['the grid', 'the preview', 'the pattern', 'it', 'everything', 'all the pins', 'the screen', 'the board', 'all', '', 'the whole thing']))
        : pick(['start over', 'start again', 'start again with a blank grid', 'blank grid', 'make it empty', 'empty it', 'all pins down', 'lower everything', 'clear all', 'get rid of everything', 'nothing on the grid', 'empty the pins', 'take everything off', 'remove all the pins', 'fresh start', 'clean slate']),
    fill: () =>
      pick([
        join(pick(['fill', 'fill in', 'fill up']), pick(['the grid', 'it', 'everything', 'the whole thing', 'all of it', 'the preview', 'it all in', ''])),
        join(pick(['raise', 'lift', 'put up', 'push up']), pick(['all the pins', 'every pin', 'every single pin', 'everything', 'all of them', 'the whole grid'])),
        pick(['all pins up', 'everything up', 'make them all go up', 'make it all raised', 'turn all the pins on', 'put all the pins up', 'all of them up', 'max out the pins', 'every pin up', 'make every pin stick up']),
      ]),
    invert: () =>
      rnd() < 0.7
        ? join(pick(['invert', 'inverse', 'reverse', 'flip', 'swap', 'negate', 'turn over', 'switch around']), pick(['it', 'the pattern', 'the pins', 'the grid', 'everything', 'the preview', 'up and down pins', 'all the pins', '']))
        : pick(['make the up ones down and the down ones up', 'swap raised and lowered', 'opposite pins', 'the opposite', 'negative', 'flip everything', 'raised ones down and lowered ones up', 'do the opposite']),
    undo: () =>
      pick([
        join(pick(['undo', 'oops undo', 'revert', 'take back', 'cancel the last']), pick(['that', 'it', 'the last thing', 'the last change', 'the last step', 'my last move', ''])),
        pick(['go back', 'go back a step', 'go back one step', 'step back', 'take that back', 'back a step', 'that was wrong undo it', 'that was a mistake', 'oops', 'previous step', 'undo undo', 'one step back', 'reverse the last change', 'i made a mistake go back']),
      ]),
    redo: () =>
      pick([
        join('redo', pick(['that', 'it', 'the last change', 'the last thing', 'that last change', ''])),
        pick(['go forward', 'go forward a step', 'step forward', 'put it back the way it was', 'bring it back', 'undo the undo', 'forward one step', 'redo what i undid', 'put back what i undid', 'next step']),
      ]),
    shape: () => {
      if (rnd() < 0.2) {
        const s = pick(OUTLINABLE);
        return join(pick(['show', 'draw', 'make', 'display', '', 'give me']), pick([`the outline of a ${s}`, `a hollow ${s}`, `an empty ${s}`, `${s} outline`, `just the edge of a ${s}`, `a ${s} border`, `an outlined ${s}`, `the edges of a ${s}`]));
      }
      return join(pick(['show', 'show me', 'draw', 'make', 'display', 'put up', 'give me', 'i want', 'can i have', 'create', 'bring up', 'render', '', '', '']), pick(ART), maybe(() => pick(['solid', 'filled', 'big', 'small'])), pick(SHAPES), maybe(() => pick(['shape', 'on the pins', 'on the grid', 'pattern', 'please']), 0.3));
    },
    character: () => {
      if (rnd() < 0.55) {
        const l = letter(pick(LETTERS));
        return pick([
          `letter ${l}`, `the letter ${l}`, `show the letter ${l}`, `capital ${l}`, `write the letter ${l}`, `display letter ${l}`, `type the letter ${l}`,
          `spell out the letter ${l}`, `show me the letter ${l}`, `can you show me the letter ${l}`, `show a ${l}`, `show an ${l}`, `draw the letter ${l}`, `upper case ${l}`,
        ]);
      }
      const n = Math.floor(rnd() * 10);
      const w = rnd() < 0.5 ? String(n) : WORDS[n];
      return pick([`number ${w}`, `the number ${w}`, `show the number ${w}`, `digit ${w}`, `the digit ${w}`, `show a ${w}`, `show me a ${w}`, `write the number ${w}`, `display ${w}`, `draw a ${w}`, w, WORDS[n], WORDS[n], `number ${num(n)}`]);
    },
    pin: () => {
      const r = 1 + Math.floor(rnd() * 5);
      const c = 1 + Math.floor(rnd() * 6);
      const act = pick([...RAISE, ...LOWER, ...TOGGLE]);
      return pick([
        `${act} row ${num(r)} column ${num(c)}`,
        `${act} the pin at row ${num(r)} column ${num(c)}`,
        `${act} the pin in row ${num(r)} column ${num(c)}`,
        `row ${num(r)} column ${num(c)} ${pick([...UPWORDS, ...DOWNWORDS])}`,
        `${act} pin ${num(r)} ${num(c)}`,
        `${act} the pin in the ${ORD[r]} row ${ORD[c]} column`,
        `${act} the ${ORD[r]} row ${ORD[c]} column`,
        `${act} column ${num(c)} row ${num(r)}`,
        `${act} row ${num(r)} col ${num(c)}`,
        `make row ${num(r)} column ${num(c)} ${pick([...UPWORDS, ...DOWNWORDS])}`,
        `${act} pin row ${num(r)} column ${num(c)}`,
        `put row ${num(r)} column ${num(c)} ${pick(['up', 'down'])}`,
      ]);
    },
    line: () => {
      const axis = pick(['row', 'row', 'column', 'line']);
      const n = 1 + Math.floor(rnd() * (axis === 'column' ? 6 : 5));
      const act = pick([...RAISE, ...LOWER]);
      return pick([
        `${act} ${axis} ${num(n)}`,
        `${act} the whole ${ORD[n]} ${axis}`,
        `${act} the ${ORD[n]} ${axis}`,
        `make ${axis} ${num(n)} ${pick([...UPWORDS, ...DOWNWORDS])}`,
        `make the ${ORD[n]} ${axis} ${pick(['stick up', 'go up', 'go down', 'come up', 'drop'])}`,
        `make the whole ${ORD[n]} ${axis} ${pick(['stick up', 'go up', 'go down'])}`,
        `put all of ${axis} ${num(n)} ${pick(['up', 'down'])}`,
        `${axis} ${num(n)} ${pick(['up', 'down'])}`,
        `${act} every pin in ${axis} ${num(n)}`,
        `${act} all the pins in the ${ORD[n]} ${axis}`,
        `the entire ${ORD[n]} ${axis} ${pick(['up', 'down'])}`,
      ]);
    },
    describe: () =>
      pick([
        'whats on the board', 'what is on the grid', 'whats on the grid', 'describe it', 'describe the grid', 'describe the preview', 'describe the pattern', 'what does it look like', 'tell me what is showing',
        'what pins are up', 'which pins are raised', 'read me the pattern', 'read the grid', 'what have i got', 'what is there', 'status', 'where am i', 'how does it look', 'whats showing',
        'what is the pattern', 'what is on the display', 'read it to me', 'tell me what is on the pins', 'which ones are up', 'what am i looking at', 'what shape is it', 'read the preview', 'what is showing right now',
      ]),
    describeRow: () => {
      const n = 1 + Math.floor(rnd() * 5);
      return pick([
        `${pick(['read', 'describe', 'check', 'what is in', 'whats in', 'tell me about', 'what about', 'read out', 'which pins are up in', 'how does'])} row ${num(n)}${rnd() < 0.1 ? ' look' : ''}`,
        `describe the ${ORD[n]} row`, `read the ${ORD[n]} row`, `what is in the ${ORD[n]} row`, `tell me about the ${ORD[n]} row`,
      ]);
    },
    openSaved: () => join(pick(['open', 'load', 'play', 'use', 'get', 'show me', 'bring up']), pick(['my', 'the', '']), pick(['saved', 'saved pattern', 'pattern', '']), pick(NAMES), maybe('pattern', 0.3)),
    searchSaved: () => {
      const n = pick(NAMES);
      return pick([`search for ${n}`, `find ${n}`, `look for ${n}`, `find my ${n} pattern`, `search my patterns for ${n}`, `find the saved pattern called ${n}`, `look for my ${n}`, `search saved for ${n}`, `find the pattern ${n}`]);
    },
    pictures: () => {
      const t = pick(THINGS);
      const a = pick(['a', 'an', 'the', 'some', '']);
      const pic = pick(['picture', 'photo', 'image', 'pictures', 'photos', 'images', 'drawing', 'silhouette']);
      return pick([
        join(pick(['find', 'show me', 'search for', 'get me', 'look up', 'find me', 'i want to feel', 'i want to see', 'give me', 'fetch', 'download']), pick(['a', 'an', 'some', '']), pic, 'of', a, t),
        join(pick(['search the internet for', 'search online for', 'look online for', 'search the web for', 'google']), a, t),
        `what does ${a} ${t} look like`.replace(/\s+/g, ' '),
        `show me what ${a} ${t} looks like`.replace(/\s+/g, ' '),
        `find ${t} pictures`, `${t} pictures`, `pictures of ${t}`, `look up ${a} ${t} online`.replace(/\s+/g, ' '),
      ]);
    },
    send: () =>
      pick([
        join('send', pick(['it', 'this', 'that', 'the pattern', 'the preview', 'the shape', 'it to the board', 'this to the display', 'it to the pins', 'to the device', ''])),
        join(pick(['put this on', 'push it to', 'upload to', 'show this on', 'transfer it to', 'apply it to', 'put it on', 'move it to']), pick(['the display', 'the board', 'the pins', 'the real pins', 'the device', 'the real board', 'the tactile display'])),
        pick(['transmit', 'make the board show this', 'make the pins show this', 'display it on the device', 'go live', 'show it for real']),
      ]),
    reset: () =>
      pick([
        join('reset', pick(['', 'the pins', 'the board', 'the display', 'the physical pins', 'the physical display', 'the device', 'the real display', 'all the real pins', 'the hardware'])),
        join(pick(['lower all', 'put down all', 'drop all', 'flatten']), pick(['the real pins', 'the physical pins', 'the board pins', 'the board', 'the pins on the device'])),
        pick(['put the board pins down', 'make the board flat', 'all the real pins down', 'lower the physical pins']),
      ]),
    yes: () => pick(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'do it', 'go ahead', 'confirm', 'that is right', 'thats right', 'correct', 'yes please', 'absolutely', 'of course', 'affirmative', 'sure go ahead', 'yeah do it', 'sounds good', 'alright', 'go for it', 'yes do it', 'thats it', 'exactly', 'yes thats what i meant', 'please do']),
    no: () => pick(['no', 'nope', 'nah', 'cancel', 'cancel that', 'never mind', 'dont', 'dont do it', 'no thanks', 'abort', 'forget it', 'not that', 'no dont', 'no way', 'thats wrong', 'no thats not it', 'do not', 'stop no', 'leave it', 'no cancel']),
    help: () => pick(['help', 'what can i say', 'what can you do', 'list commands', 'list the commands', 'what commands are there', 'how do i use this', 'how does this work', 'i need help', 'options', 'show me the commands', 'what are my options', 'instructions', 'tell me the commands', 'what do i say', 'help me', 'what are the commands', 'what can i ask', 'how does voice control work', 'what words work']),
    repeat: () => pick(['repeat', 'say that again', 'again', 'pardon', 'what did you say', 'what did you just say', 'sorry i missed that', 'come again', 'repeat that', 'say again', 'i didnt hear', 'one more time', 'i didnt catch that', 'what was that', 'pardon me', 'sorry what', 'can you repeat', 'repeat the last thing', 'say it again']),
    stop: () => pick(['stop', 'stop talking', 'quiet', 'be quiet', 'silence', 'shh', 'shush', 'hush', 'shut up', 'enough', 'stop speaking', 'mute', 'quiet please', 'stop reading', 'thats enough', 'no more talking', 'stop the voice']),
    voiceOff: () => pick(['turn off voice control', 'voice control off', 'stop listening', 'stop listening to me', 'disable voice', 'hide voice control', 'close voice control', 'turn the microphone off', 'voice off', 'stop voice commands', 'switch off voice control', 'i dont want voice control', 'turn off the voice', 'disable voice control', 'stop the microphone']),
    camera: () =>
      pick([
        join(pick(['start', 'turn on', 'open', 'use', 'switch on', 'launch', 'begin', 'start up']), pick(['the camera', 'camera', 'the live camera', 'live camera', 'my camera'])),
        pick(['turn the camera on', 'camera on', 'live camera', 'i want to use the camera', 'camera please', 'camera', 'point the camera', 'go live with the camera', 'show what the camera sees', 'use my camera']),
      ]),
    capture: () => pick(['capture', 'take a picture', 'take a photo', 'snap it', 'snap', 'shoot', 'capture this', 'take the shot', 'grab a photo', 'freeze the frame', 'take it', 'photograph this', 'take a picture now', 'capture it', 'take a snapshot', 'grab this', 'freeze', 'keep this frame', 'take the photo now', 'click']),
    stopCamera: () => join(pick(['stop', 'turn off', 'close', 'end', 'switch off', 'shut', 'shut off', 'exit']), pick(['the camera', 'camera', 'the live camera', 'my camera'])) || 'camera off',
    flipCamera: () =>
      pick([
        join(pick(['flip', 'switch', 'turn', 'change', 'swap', 'reverse']), pick(['the camera', 'camera', 'cameras', 'the camera around'])),
        join(pick(['switch to', 'use', 'go to', 'change to']), pick(['the front camera', 'the back camera', 'the selfie camera', 'the rear camera', 'the other camera'])),
        pick(['selfie camera', 'front camera', 'back camera', 'rear camera', 'other camera']),
      ]),
    photo: () =>
      pick([
        join(pick(['choose', 'pick', 'select', 'upload', 'open', 'browse', 'load']), pick(['a photo', 'a picture', 'an image', 'a file', 'my photos', 'my pictures', 'the gallery', 'a picture from my library', 'a photo from my phone', 'an image from my files', 'photos'])),
        pick(['photo library', 'open gallery', 'my photos', 'pick from gallery', 'camera roll', 'choose photo', 'i want to pick a picture']),
      ]),
    shareScreen: () => pick(['share my screen', 'start screen sharing', 'screen share', 'share the screen', 'share a window', 'share my window', 'start sharing my screen', 'share screen', 'share my desktop', 'use my screen', 'show my screen']),
    stopSharing: () => pick(['stop sharing', 'stop screen sharing', 'stop sharing the screen', 'end screen share', 'stop sharing my window', 'end sharing', 'stop sharing my screen', 'stop the screen share', 'unshare']),
    clearImage: () =>
      join(pick(['clear', 'remove', 'get rid of', 'delete', 'close', 'discard', 'throw away', 'drop']), pick(['the image', 'the picture', 'the photo', 'this picture', 'this image', 'the current picture'])),
    usePattern: () => pick(['use this pattern', 'use these pins', 'use this', 'use it', 'keep this one', 'thats good use it', 'i like this one', 'use the result', 'take this pattern', 'apply this', 'use that pattern', 'use this one', 'keep it', 'this one is good', 'use the pins', 'thats the one', 'perfect use that', 'copy this to the display']),
    describeResult: () => pick(['what do the pins see', 'describe the picture', 'what is in the photo', 'whats in the picture', 'describe the result', 'what does the image show', 'read the result', 'what did the camera see', 'what is in the image', 'describe the photo', 'what does the picture look like on the pins', 'tell me about the picture']),
    setting: () => {
      const s = pick([
        ['remove background', 'background removal', 'the background', 'background'],
        ['smart cutout', 'smart cut out', 'cut out', 'the cutout'],
        ['remove axes', 'the axes', 'axes', 'grid lines', 'the gridlines'],
        ['ignore labels', 'labels', 'the labels', 'text', 'the text'],
        ['one pin lines', 'thin lines', 'one pin wide lines'],
        ['snap', 'snapping', 'snap to shape'],
      ]);
      const what = pick(s);
      return pick([
        `${pick(['turn on', 'turn off', 'enable', 'disable', 'switch on', 'switch off'])} ${what}`,
        `${what} ${pick(['on', 'off'])}`,
        `turn ${what} ${pick(['on', 'off'])}`,
        pick(['remove the background', 'keep the background', 'remove the axes', 'hide the grid lines', 'show the axes', 'ignore the labels', 'ignore text', 'make the lines thin', 'snap to shape', 'cut out the subject', 'no background', 'hide the axes', 'get rid of the background', 'keep the labels', 'thick lines', 'dont snap']),
      ]);
    },
    adjust: () =>
      pick([
        `${pick(['increase', 'raise', 'turn up', 'more', 'higher', 'boost', 'decrease', 'lower', 'turn down', 'less', 'reduce'])} ${pick(['the ', ''])}${pick(['tolerance', 'sensitivity'])}`,
        `${pick(['tolerance', 'sensitivity'])} ${pick(['up', 'down', 'higher', 'lower', 'up a bit', 'down a bit'])}`,
        pick(['more sensitive', 'less sensitive', 'make it more sensitive', 'make it less sensitive', 'more tolerant', 'less tolerant']),
      ]),
    navigate: () => {
      const tab = pick(['display', 'preview', 'home', 'main screen', 'image', 'images', 'picture', 'pictures', 'photo', 'camera page', 'saved', 'saved patterns', 'my patterns', 'library', 'pin test', 'pin testing', 'test page', 'device', 'settings', 'bluetooth', 'connection', 'board settings', 'bluetooth settings']);
      return pick([
        join(pick(['go to', 'open', 'switch to', 'take me to', 'show', 'go back to', 'bring up', 'navigate to', 'jump to', 'show me']), pick(['the', '']), tab, pick(['tab', 'page', 'screen', ''])),
        tab === 'bluetooth settings' || tab === 'board settings' ? tab : `${tab} tab`,
      ]);
    },
    graph: () => join(pick(['graph', 'plot', 'draw', 'show me', 'make', 'i want to see', 'can you graph', 'sketch', 'display', '']), pick(['the graph of', 'a graph of', 'the function', 'the line', 'the curve', 'the equation', '', '']), pick(EQS)),
    next: () => pick(['next', 'next one', 'another', 'another one', 'show me another', 'try a different picture', 'skip', 'skip this one', 'next picture', 'give me another', 'different one', 'the next one', 'try another', 'show another picture', 'not this one next', 'something else', 'a different one']),
    previous: () => pick(['previous', 'previous one', 'the one before', 'go back to the last picture', 'back one picture', 'last picture', 'the previous picture', 'before that one', 'the earlier one', 'go back a picture', 'the picture before']),
    none: () => {
      if (rnd() < 0.6)
        return pick([
          'what is the time', 'whats the time', 'good morning', 'good night', 'hi there', 'hey how is it going', 'how is your day', 'it is raining outside', 'i like dogs', 'my name is sam',
          'tell me something funny', 'whats the weather like', 'is it going to rain', 'remind me to buy milk', 'text my friend', 'phone my brother', 'set a timer for ten minutes', 'wake me up at six',
          'turn up the music', 'play a song', 'open youtube', 'order some food', 'where is the nearest shop', 'who are you', 'what is the meaning of life', 'i am tired', 'i am hungry',
          'nothing', 'hmm', 'er', 'ah', 'okay then', 'i was just saying', 'sorry wrong window', 'what', 'whatever', 'testing testing', 'is this thing on', 'one two three testing',
          'my homework is due tomorrow', 'the teacher said so', 'lunch is at noon', 'we went to the park', 'i dont understand', 'i have no idea', 'maybe later', 'let me think',
          'thats interesting', 'cool', 'nice', 'wow', 'great job', 'thanks a lot', 'cheers', 'bye', 'goodbye', 'see you later', 'how old are you', 'do you like cats', 'what day is it',
          'book a taxi', 'send an email to my teacher', 'how much is that', 'translate this to french', 'what is two plus two', 'spell necessary', 'my battery is low', 'the cat is sleeping',
        ]);
      const VOCAB = ['the', 'a', 'i', 'you', 'it', 'is', 'was', 'my', 'we', 'they', 'and', 'but', 'so', 'very', 'really', 'today', 'yesterday', 'school', 'mum', 'dad', 'friend', 'went', 'go', 'like', 'want', 'have', 'got', 'nice', 'big', 'little', 'happy', 'sad', 'food', 'water', 'car', 'bus', 'home', 'outside', 'weather', 'music', 'time', 'phone', 'game', 'book', 'class', 'think', 'know', 'said', 'yeah', 'well', 'just', 'maybe', 'later'];
      const n = 2 + Math.floor(rnd() * 5);
      return Array.from({ length: n }, () => pick(VOCAB)).join(' ');
    },
  };

  // What a speech recogniser or a hurried typist might do to a sentence.
  const MISHEAR = { heart: 'hart', two: 'to', four: 'for', column: 'colum', camera: 'camra', picture: 'pitcher', row: 'roe', three: 'tree', circle: 'circel', triangle: 'triangel', square: 'sqaure', clear: 'cleer', invert: 'in vert', undo: 'and do', redo: 're do', capture: 'captcha', letter: 'leter', background: 'back ground' };
  const noisy = (s) => {
    const w = s.split(' ');
    const r = rnd();
    if (r < 0.06 && w.length > 2) w.splice(Math.floor(rnd() * w.length), 1);
    else if (r < 0.14) {
      const i = Math.floor(rnd() * w.length);
      if (MISHEAR[w[i]]) w[i] = MISHEAR[w[i]];
    } else if (r < 0.2) {
      const i = Math.floor(rnd() * w.length);
      const x = w[i];
      if (x.length >= 5) {
        const j = 1 + Math.floor(rnd() * (x.length - 2));
        w[i] = rnd() < 0.5 ? x.slice(0, j) + x.slice(j + 1) : x.slice(0, j) + x[j + 1] + x[j] + x.slice(j + 2);
      }
    }
    return w.join(' ');
  };

  const out = [];
  for (const [label, gen] of Object.entries(GEN)) {
    const n = label === 'none' ? perLabel * 4 : perLabel;
    for (let i = 0; i < n; i++) {
      const s = gen();
      // Bare yes/no/stop-style words aren't wrapped in "please … thanks": they'd stop being the short answers they are.
      const text = ['yes', 'no', 'stop', 'none', 'repeat'].includes(label) ? s : wrap(s);
      out.push([noise ? noisy(text) : text, label]);
    }
  }
  return out;
}
