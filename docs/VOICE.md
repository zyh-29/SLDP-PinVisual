# Voice commands

Press **Voice** at the top of the Display or Image tab (it stays on until
turned off, and can also be switched in the Device tab). A command field
appears under the title, with a microphone in it: type a command and press
return, or tap the microphone and speak. The **?** beside it lists examples,
each of which can be tapped to try it.
On iPhone, VoiceOver's two-finger double-tap on either tab opens it and starts
listening. Typing is there for noisy rooms, for speech the recogniser doesn't
follow, and for browsers without speech recognition.

Each command goes to the tab it belongs to: pin pictures to Display; graphs,
the camera and pictures to Image.

- **What you can say:** "show a circle" (also square, triangle, diamond,
  cross, plus, heart, smile, checkerboard, a line, arrow up/down/left/right;
  circles, squares, triangles and diamonds are solid, and "circle outline",
  "hollow square" or "ring" give just the edge),
  "letter B", "number 3", "raise row 2 column 3", "lower row 2", "clear",
  "fill", "invert", "undo", "redo", "what's on the board", "read row 2",
  "open saved Morning", "send", "reset", "repeat", "stop", "help". Number
  words, homophones ("row to") and spoken letter names ("bee") are understood.
- **Graphs:** "graph y equals x squared minus three", "plot sine of x",
  "y equals two x plus one". Spoken maths is turned into an equation
  (`src/voice/spokenMath.ts`) and read back in words before it's drawn. The
  rules a listener needs:
  - a function or root applies to the next term only: "sine of x plus one" is
    sin(x) + 1;
  - "the quantity" groups the rest: "sine of the quantity x plus one" is
    sin(x + 1) ("end quantity" closes it early);
  - "over" divides by the next term: "one over two x" is 1/(2x), "one over x
    plus one" is 1/x + 1.
  Typed maths ("y = x^2 - 3") works too.
- **The Image tab:** "start camera", "capture", "stop camera", "flip camera",
  "choose photo", "share screen", "stop sharing", "clear image", "use this
  pattern", "what do the pins see", "remove background on/off", "smart
  cut-out on", "one pin lines off", "tolerance up", "sensitivity down". In a
  browser, "choose photo" and "share screen" may need the button: browsers
  open those pickers only straight after a tap or key press.
- **Search:** "search for house" lists matching saved patterns. "Find
  pictures of a cat" searches Openverse and Wikimedia Commons (on by default;
  **Online Picture Search** in the Device tab turns it off), loads the first openly
  licensed picture on the Image tab and says its credit; "next" and
  "previous" go through the results. Silhouettes come first (drawn ones, then
  photos against the light, and only ones whose title names the thing), so
  the pins show one solid shape rather than a busy scene; ordinary photos
  follow. A result whose pins say nothing (two or fewer, or nearly all 30) is
  skipped, up to three in a row.
  The first answer comes as soon as the best source has replied, usually
  Wikimedia's drawings in about half a second, without waiting for a slow
  one. Slower sources add to the list for "next", and the total ("of 24") is
  said once it's final. The next few results are converted off screen at
  the same time, with the Image tab's own settings, so useless ones are
  skipped without loading each on the tab (`src/voice/PictureCheck.tsx`).
- **Going places:** "go to image", "go to display", "open device".
- **Say it your own way.** "Could you get rid of everything", "make the
  fourth column stick up", "turn the camera on", "I want to feel a picture of
  a tree" all work. See "How commands are understood" below.
- **Browser AI as a last resort:** where the browser has a built-in model
  (Chrome on a computer with Gemini Nano downloaded), a sentence neither the
  rules nor the voice model understood is rewritten as a command, then
  confirmed: "Did you mean: show a heart? Say yes or no." Nothing is done
  until "yes", and nothing leaves the computer.
- **Nothing moves without a yes.** "Send" and "reset" ask first ("Say yes to
  send, or no") and offer Yes / Cancel buttons. Any other command cancels the
  question.
- **Every answer says what happened,** including what was heard when it wasn't
  a command, and points to "help".
- **Listening** starts with a tone and a vibration and stops with a lower one.
  No spoken "listening", which the microphone would hear. On iPhone,
  VoiceOver's two-finger double-tap anywhere on the Display tab also starts
  it.
- **Where speech is recognised.** Commands are understood by the app itself
  (below). The audio is turned into words by the device:

  | Where | Recogniser | Leaves the device? |
  |---|---|---|
  | iPhone, Android app | The phone's own (`expo-speech-recognition`), on-device | No, where the phone supports it |
  | Chrome on a computer | Chrome's on-device recognition (downloads the language once) | No |
  | Chrome on Android, Safari, Edge | The browser's maker's servers | Only with **Online Speech Recognition** on (Device tab) |
  | Firefox | None | Type commands instead |

## How commands are understood

`src/voice/understand.ts` reads every sentence, spoken or typed, in steps,
fastest first. All of it runs on the device in about 0.05 ms.

1. **The command rules** (`src/voice/commands.ts`): fixed phrasings, exact and
   predictable.
2. **The rules again after tidying**: filler taken out anywhere ("could you
   just … now please"), and a few words folded into known ones ("hart",
   "pyramid", "ball").
3. **The voice model** (`src/voice/intent/`): a small neural network in the
   style of fastText. It reads the words, word pairs and three-letter pieces
   of words (so "sqare" or "camra" still land), and says which of 39 kinds of
   command the sentence is, and how sure it is. It's about 130,000 numbers
   stored as bytes (177 KB in the app) and needs no download, runtime or
   internet.
   - The model only picks the kind. The details (row 2, the letter B, what to
     search for) are read from the sentence and checked by the rules, so the
     model can't make up a row number or a search.
   - 80% sure or more: done. 40–80%: "Did you mean …? Say yes or no."
     Less: not a command.
   - Its guess is ignored when under half the words are ones it learned
     ("pizza" isn't a command, however sure it seems).
   - It overrules the rules only when 97% sure they misread a sentence ("find
     me an image of a car" is a picture search, not a saved pattern).
4. **The browser's AI**, where there is one (above).
5. **A picture search.** If it's still not a command, the thing it names is
   searched for as a picture and its pins shown, as if you had said "find
   pictures of …": "giraffe" or "I want to feel a cactus" shows a giraffe or a
   cactus. The answer starts "That isn't a command, so I searched for pictures
   of …". It's skipped when **Online Picture Search** is turned off, and doesn't happen while a yes-or-no question is waiting or when
   what's left is more than four words (likely talk, not a thing)
   (`searchTopic` in `understand.ts`).

**Training.** `npm run train:voice` (Node 22.18 or newer) builds about 15,000
example sentences from `scripts/voice-training-data.mjs` (each kind of command
said many ways, with filler, recogniser mishearings and typos), trains for
about a second, and writes `src/voice/intent/weights.ts`. To teach it a new
phrasing, add it to the lists there and retrain.

**Measuring.** `src/voice/__tests__/voicePhrases.ts` holds about 350 natural
phrasings, and none of them is used for training. Run
`VOICE_REPORT=1 npx jest understand.eval` for the report. When the model was
built:

| Phrases | Rules alone | With the model |
|---|---|---|
| Tuning set (189) | 69% understood | 98% understood, 2% asked, 0 wrong |
| Exam set (95, scored before any fixes) | 49% | 96% at first; 98% after fixes |
| Fresh set (62, written after tuning, scored once) | 50% | 97% at first; 98% after one fix ("capital letter r") |

The one fresh phrase still acted on wrongly is "what is for dinner", which
reads the board aloud. That's harmless, but it shows the model can be fooled
by sentences that sound like commands. The test fails if understanding drops
below these levels or more than one phrase per set is acted on wrongly.

## Speak Results

**Speak Results** (Device tab) reads results aloud with the device's voice,
for people who don't use a screen reader. While VoiceOver or TalkBack is on,
the app stays quiet and lets the screen reader speak, so nothing is heard
twice. (A browser can't tell whether a screen reader is running, so on the
website leave it off if you use one.)

To check voice control with blind users, see [TESTING.md](TESTING.md).
