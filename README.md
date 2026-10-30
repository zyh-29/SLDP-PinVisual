# PinVisual

PinVisual is a phone and web app for a tactile pin display. You draw a pattern,
or give it a picture, and it works out which pins should be up (1) and which
should be down (0). The pattern goes over Bluetooth Low Energy to an ESP32,
which moves the servos through PCA9685 boards.

Everything runs on the device. There are no accounts and nothing is sent to a
server.

- Firmware protocol: [docs/PROTOCOL.md](docs/PROTOCOL.md)
- Board firmware (ESP32 + PCA9685), wiring and setup: [firmware/README.md](firmware/README.md)
- Grid size and hardware settings: `src/config/hardware.ts` (the grid is 5 × 6 for now)

Built with Expo (SDK 58), React Native and TypeScript.

## Where things stand

| Feature | Status |
|---|---|
| Drawing on the grid, Clear Grid | Works (tested in the iOS simulator) |
| Send Pattern / Reset Physical Pins | Tested against a simulated board; not yet tried on real hardware |
| Protocol (framing, CRC, chunking, retries, timeouts, ACKs) | Done, with unit tests |
| Picture to pins (background removal, graphs, cropping, thin lines) | Works on the web; still needs a run-through on a phone |
| Shape snapping (triangle to hexagon, circle, oval) | Works |
| Smart Cut-Out (on-device subject segmentation) | Works on the web. iOS and Android versions are written but need a development build |
| Saving, loading and deleting patterns | Works |
| Exporting and importing a backup file | Works on the web; the phone share sheet hasn't been tried yet |
| Tap to pick what becomes pins | Works |
| Live camera (web, phones and laptops) | Works in Chrome; not yet tried on a real phone |
| Camera lock and capture | Works in Chrome; not yet tried on a real phone |
| Graph Range (Auto, or a typed range such as `5`, `+5` or `-5`) | Works on the web. Reading axis numbers needs `tesseract.js`; on phones one grid square counts as one unit |
| Graph zoom, panning, and a spoken description of the graph | Works |
| One-Pin Lines (curves drawn one pin wide) | Works |
| Typing an equation to draw it | Works |
| Send Live to Board | Tested against a simulated board only |
| Bluetooth on phones | Written, never run. Needs a development build, a phone and firmware |
| Web layout (laptop, tablet, phone) | Works |
| Web Bluetooth (Chrome, Edge) | Written, never run against a board |
| Voice commands (spoken or typed) on the Display tab | Works in Chrome with a stand-in recogniser and by typing. Not yet tried with a real microphone, VoiceOver or TalkBack. Phones need a development build |
| Speak Results (the device's voice reads results) | Written; not yet heard on a phone |
| Showing letters and digits on the pins (A to Z, 0 to 9) | Works (by voice or typed command) |
| Letter recognition (reading letters from a picture) | Not started |
| Board firmware (ESP32 + PCA9685) | Written. Its protocol code passes its tests on a computer; not yet run on an ESP32 |
| BLE UUIDs | Set; the app and the firmware use the same ones (checked by a test) |
| Checking where the pins really are | Not possible: the hardware has no position sensors. The app only knows the board acknowledged a command |

## Project layout

```
src/
  app/          Screens (Expo Router): Display, Image, Saved, Device
  config/       hardware.ts: grid size, BLE UUIDs, protocol timing
  domain/       pattern.ts: the grid model, pin order, bit packing
  protocol/     Message encoding, CRC-16, chunking, CommandClient (acks and retries)
  device/       Bluetooth drivers (BleDriver.ts for phones, BleDriver.web.ts for browsers),
                DeviceController, LiveSender, and a simulated board used only by tests
  imaging/      Everything that turns a picture into pins:
                  lighting                          evening out a camera picture's light
                  foreground, refineMask, maxflow   background removal
                  smartCrop, curves, plotGrid       choosing what becomes pins
                  scene                             landscapes: the sky and the skyline
                  graph, graphScale, graphSummary   graphs: range, units, description
                  equation                          typed equations
                  features, featureTracker,         camera lock
                  itemTracker, tracker
                  surface                           flattening screens and pages
                  shapes, pinSampling               shapes, and the final pins
                  imageInput.web, cameraDevice.web  camera, screen sharing, drag and drop
  voice/        Voice commands and speech:
                  commands, runCommand              what a sentence asks for, and doing it
                  glyphs                            shapes, letters and digits drawn for the pins
                  recognizer(.web)                  hearing one command (on the device where possible)
                  announce, liveRegion.web          telling screen readers (and Speak Results)
  storage/      Saved patterns (stored locally) and backup files
  state/        React providers and hooks; useImageConversion runs the Image tab
  ui/           Theme, components, tab bar and sidebar, the Image tab's cards
```

The app only talks to real boards. The tests use a simulated board
(`src/device/__tests__/support`) that speaks the same protocol and can be made
slow, lossy or faulty to test retries and error handling.

## Getting started

You'll need Node.js 22.13 or newer (React Native 0.88 requires it). For native
builds you also need Xcode and CocoaPods for iOS, or Android Studio for
Android. EAS Build works too.

```bash
npm install
npm test            # unit tests
npm run typecheck
npx expo lint
```

GitHub Actions runs the same checks and a web build on every push
(`.github/workflows/ci.yml`).

### Running the app

```bash
npm start
```

This starts Expo in Expo Go mode. Press `i` for the iOS simulator, `a` for
Android, `w` for the browser, or scan the QR code with Expo Go.

Bluetooth doesn't work in Expo Go. The app says so on the Device tab, and
everything else still works. Once you have a development build installed, use
`npm run start:dev-client` instead. Plain `npx expo start` expects a
development build because `expo-dev-client` is installed.

### Web version

```bash
npm run web         # dev server at http://localhost:8081
npm run build:web   # static site in dist/
```

To put it online:

1. Build it. For the root of a site, run `npm run build:web`. For a subfolder
   such as `https://example.com/pinvisual/`, run
   `WEB_BASE_URL=/pinvisual npm run build:web`.
2. Upload everything in `dist/`, including the hidden `.nojekyll` file and the
   `_expo`, `ort`, `models` and `tesseract` folders.
3. Serve it over https. The camera, screen sharing and Bluetooth all need it
   (localhost is fine too).

No server code is needed. The build writes a page for every tab
(`scripts/web-routes.mjs`), so refreshing works on any static host. On Vercel,
import the repo and deploy; `vercel.json` has the settings and every push to
`main` redeploys. The cut-out model files (about 15 MB) only load when a photo
needs them.

On laptops the app uses a sidebar and a two-column layout. On tablets and
phones it uses a bottom tab bar, like the native app.

Web Bluetooth works in Chrome and Edge on desktop and Android. Safari, Firefox
and iOS browsers don't support it, and the Device tab says so.

## Using a picture

The Image tab takes a photo, a dropped or pasted image, a typed equation, a
shared screen (desktop browsers) or the live camera (web).

### How a picture becomes pins

The picture is scaled down to 800 px, then:

0. **Light** (camera pictures). A phone camera never sees paper evenly lit:
   the corners are darker, a lamp makes a bright pool, a window lights one
   side. `lighting.ts` measures the light across the picture and divides it
   out, the way astronomy software removes a sky background:
   - The picture is cut into 32 px cells. Each cell's paper colour is the
     average of its brighter pixels, so ink crossing it doesn't count.
   - A smooth surface is fitted through the cells. Cells that don't fit,
     such as the subject itself, are given less and less weight (a robust,
     reweighted fit), so the surface follows the paper alone.
   - Each pixel is divided by the surface, per colour, which also removes a
     warm lamp's tint.

   It's skipped when the light is already even, and when neighbouring cells
   jump sharply. Light changes gradually; a jump means a thing (a card on a
   desk, a checked cloth, a dark object and its shadow), which the next steps
   handle. It takes about 7 ms per frame.
1. **Background.** The background colour is taken from a thin ring around the
   edge of the crop.
2. **Subject.** Pixels that differ enough from the background are the subject.
   The cut-off (Tolerance) is set automatically for each picture, or you can
   drag the slider.
3. **Clean-up.** For shapes and objects, a second pass based on GrabCut
   (`refineMask.ts`) tidies the outline. It learns what the background and
   the subject look like, then decides all pixels together with a minimum cut
   (`maxflow.ts`). This removes speckles and patterned backgrounds. Graphs and
   thin line drawings skip it, because it would erase thin lines.
4. **Axes and gridlines.** Long straight lines that cross are taken as axes
   and removed, leaving the curve. A letter like T or E isn't mistaken for
   axes, because nothing is left once its lines go.
5. **Labels.** Small pieces such as tick numbers and captions are dropped.
6. **Smart crop** (`smartCrop.ts`) decides what becomes pins:
   - On a graph, coloured curves are kept and the grid, text and buttons are
     ignored. Black curves are found by first finding the plot area by its
     gridlines.
   - Otherwise it picks the most likely object: big, central, not touching the
     edge, and not text.
   - Tap the picture to choose something else: one shape, one curve, one of
     several graphs. Auto Crop goes back to automatic. You can also drag the
     crop box yourself.
7. **Thin lines** are thickened to about half a pin, so a line through a pin
   raises it.
8. **Shapes.** Closed outlines are filled in. Clean triangles, squares,
   circles and so on are redrawn as perfect shapes that fill the grid, with
   small tilts straightened. Turn off the *Snap to …* switch to keep the original.
9. **Pins.** The crop is fitted to the grid. Sensitivity sets how much of a
   pin must be covered before it's raised.

*What the pins see* shows the result, with the removed background as a
checkerboard.

### Smart Cut-Out

For photos with a busy background, an on-device model separates the main
subject. It switches on by itself and can be turned off.

- iOS 17+: Apple Vision, through `modules/subject-segmentation`
- Android: Google ML Kit Subject Segmentation (beta), same module
- Web: U²-Net small (`public/models/u2netp.onnx`, Apache-2.0) with ONNX Runtime Web

The phone versions need a development build. In Expo Go the switch is hidden.

On the web, the model only counts as having found a subject when it is sure
of at least 0.3% of the picture. On a landscape it is never sure of anything
(its strongest point is a guess), and that guess used to become the "subject":
a patch of meadow, a bend in a river. Cars, even a small one far off, cover
1.6% or more.

A shape cut out of a photo is never snapped to a triangle or hexagon: a car is
not a hexagon, however close its outline comes. It is stretched to fill the
pins instead, up to 2.2 times taller (or wider) than it really is: a car seen
from the side is three or four times wider than tall, and kept to those
proportions it was a single row of pins. Filling the rows shows the cabin on
top, the body, and the wheels at the bottom corners.

### Landscapes

A photo of mountains or hills has no single object to cut out. The pins show
the **skyline** instead: the land raised, the sky lowered, cropped around the
ridge so the peaks fill the grid (`scene.ts`).

- **Sky:** the smooth area joined to the top of the picture, right across it.
  Clouds stop it, but they are islands: land never floats above sky, so the
  skyline is just below each column's lowest sky.
- **Landscape or object?** A car under the sky has a skyline too (trees,
  buildings). It's a landscape only when the cut-out found nothing, or what it
  found follows the skyline (its top edge is the ridge). A car's roof sits well
  below the trees behind it, so the car is shown.
- **Tap** something in the picture to show just that instead.

Tested on 11 photos (6 cars, 5 mountains): every car was cut out and every
mountain photo shown as a skyline. Limits: clouds lying right on the peaks with
no sky under them count as land, and a mountain fading into haze counts as
sky (the dark foreground is then shown).

### Graphs

Squeezing a whole curve onto 30 pins can lose its shape. Graph Range starts on
Auto: the whole curve when that shows everything (a parabola, a line), or the
part where it turns and bends (the two humps of `x^3 - 3x`, the top of a bell
curve). Waves show one at a time.

To see a set part instead, type a range in the Graph Range field:

| Type | Shows |
|---|---|
| `5`, `±5`, `+-5` or `+/-5` | 5 units each side of the middle of the graph |
| `+5` | the 5 units right of the middle |
| `-5` | the 5 units left of the middle |
| `whole` | the whole curve |
| nothing | Auto |

A typed range keeps the graph's real proportions, and the curve's lowest or
highest point sits in the bottom or top row when it is in view.

The units come from the numbers on the axes, read with Tesseract.js on the
device. If they can't be read, one grid square counts as one unit, which can
be wrong. When you zoom in, the curve keeps its size on the pins. The arrows
under Graph Range move the window, and a short text description of the graph
is given for screen readers.

You can also type an equation such as `y = x^2 - 3` or `sin(x)`. It is drawn
at an exact scale, so no numbers need reading.

### Live camera (web)

Point a phone or webcam at a worksheet, a screen or an object, and the pins
follow it.

- **Lock.** When the camera sees the same item twice in a row, it locks on
  (*Live · Locked*) and follows it as you move. Tap another item to switch.
  Tracking uses ORB feature points (`features.ts`, `featureTracker.ts`), with
  template matching as a fallback for plain items.
- **Capture.** Once locked, the camera keeps one sharp frame of the item
  (*Live · Captured*). The pins come from that frame, so they stay still while
  the video keeps running. Tapping something else, Auto Crop or drawing your
  own crop box releases it. Stop Camera keeps the captured frame as a still
  picture.
- **Screens and paper.** Pointed at a laptop screen or a sheet of paper, the
  camera finds its four corners and straightens it (*Live · Flat*).
- **Uneven light.** Vignetting, a desk lamp or a window no longer makes the
  paper itself look like the subject (step 0 above). In tests with 6 drawings
  under 7 kinds of light, wrong pins fell from 173 to 18 of 1,260; vignetting
  and lamp light went from 4–30 wrong pins per picture to none.
- **Steadier pins.** Frames are lightly blurred to remove sensor noise, and
  each pin is averaged over a few frames so it doesn't flicker.
- **Speed.** Frames are 640 px and the app adapts how often it processes them
  to how fast the phone is.
- **Focus and light.** Blurry frames are skipped while the lens refocuses, and
  very dark frames aren't processed. Tapping the picture also focuses there
  (Chrome on Android).
- **Cars, mountains and other scenes.** Once the camera has settled (locked
  on an item, or about 1.5 s on a busy scene with nothing to lock onto), the
  frame it keeps is judged as a photo: Smart Cut-Out and the landscape check
  run on it, so a car is cut out and a mountain shows its skyline. A kept
  scene lets go when the camera turns to something else. Frames from the
  camera always count as photos, however smooth the phone makes them.
- **Pictures of things.** Pointed at a printed photo or a photo on a screen,
  the camera finds the print or screen, straightens it (*Live · Flat*) and
  cuts the object out of the photo inside: a printed car comes out as a car.
  Not yet for landscapes in a print or on a screen: a smooth printed sky
  doesn't count as a photo, and a screen's bezel hides where the ground ends.
- **Not a page:** a bright, smooth patch hanging from the top of the view (an
  overcast sky above a car) is not taken for a sheet of paper to straighten.
- **Capture button.** Takes a full-resolution photo and carries on with it as
  a still picture.

The camera only works over https or on localhost. If the app is inside an
`<iframe>`, add `allow="camera"` to it.

### Screen sharing (desktop web)

Share Screen lets you pick a screen, window or tab. The pins follow it live,
up to five times a second. Nothing is sent to the board until you press
**Use This Pattern** and then **Send**.

Share the window with your graph or shape, not the entire screen. On the
entire screen PinVisual sees itself (its own preview and pins) and other
windows, and may pick those instead. Chrome and Edge list windows first and
leave PinVisual's own tab out. If the entire screen is shared anyway, the
Image tab says so. Things cut off by the edge of the screen are passed over,
since they are usually part of another window.

## Testing on a real phone

The simulator can't check these:

1. Permission prompts: Bluetooth, Android "Nearby devices", location on
   Android 11 and older, and the photo library.
2. Scanning finds the ESP32 (named `PinVisual…`).
3. Connecting finds the service and both characteristics.
4. The Device tab shows the negotiated MTU.
5. Send: the firmware receives the right bytes (see the test vectors in
   `docs/PROTOCOL.md`) and the app shows "Board received pattern".
6. Pin order: raise only the top-left pin and check it on the display, then
   the bottom-right one. For a single servo, the **Pin Test** tab shows one
   pin (the top-left one, whose servo is plugged into the ESP32's D18; see
   `firmware/README.md`, "Testing with one servo"). Tap it to raise or lower
   it on the board. It sends the usual pattern command with
   only that pin raised, so every other pin goes down. The Display preview
   isn't changed.
7. Retries: with ACKs turned off in the firmware, the app should try three
   times and then offer Retry.
8. Power off the ESP32 mid-send: the app should show "Connection lost".
9. Reset clears the preview only after the board acknowledges it.
10. VoiceOver and TalkBack read each pin as "Row r, column c, raised/lowered".
11. Real photos, transparent PNGs and very large images.

## Design and accessibility

- iOS-style look: native tab bar, large titles, grouped cards, light and dark mode.
- Text colours meet WCAG AA contrast.
- Nothing relies on colour alone. Raised pins are solid, lowered pins are
  rings, and every status has an icon and text.
- Grid cells are at least 40 pt. On narrow screens the grid scrolls instead
  of shrinking.
- Screen readers announce each pin, give row-by-row summaries of previews,
  and announce send, reset and save results. On the website these go through
  a hidden live region (React Native Web's own announcement call does nothing).
- Voice commands sit at the top of the Display tab, before the 30 pins, so a
  screen reader reaches them first. See "Voice commands" below.
- The connection status is in every screen's header; tapping it opens the
  Device tab.

## Voice commands

The Display tab has a **Speak** button and a box to type the same commands.
Everything works both ways: typing is there for noisy rooms, for speech the
recogniser doesn't follow, and for browsers without speech recognition.

- **What you can say:** "show a circle" (also square, triangle, diamond,
  cross, plus, heart, smile, checkerboard, a line, arrow up/down/left/right),
  "letter B", "number 3", "raise row 2 column 3", "lower row 2", "clear",
  "fill", "invert", "undo", "redo", "what's on the board", "read row 2",
  "open saved Morning", "send", "reset", "repeat", "stop", "help". Number
  words, homophones ("row to") and spoken letter names ("bee") are understood.
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
  (`src/voice/commands.ts`), from a fixed list. The audio is turned into words
  by the device:

  | Where | Recogniser | Leaves the device? |
  |---|---|---|
  | iPhone, Android app | The phone's own (`expo-speech-recognition`), on-device | No, where the phone supports it |
  | Chrome on a computer | Chrome's on-device recognition (downloads the language once) | No |
  | Chrome on Android, Safari, Edge | The browser's maker's servers | Only with **Online Speech Recognition** on (Device tab) |
  | Firefox | None | Type commands instead |

- **Speak Results** (Device tab) reads results aloud with the device's voice,
  for people who don't use a screen reader. While VoiceOver or TalkBack is on,
  the app stays quiet and lets the screen reader speak, so nothing is heard
  twice. (A browser can't tell whether a screen reader is running, so on the
  website leave it off if you use one.)

### Checking it with blind users

Unit tests cover the command list and the answers. They can't show whether
it's usable. Before calling it done:

1. Use it with VoiceOver's Screen Curtain (three-finger triple-tap) or
   TalkBack's dimmed screen: show a shape, check it by touch, send it, and
   reset, without looking.
2. Try it in a noisy room and with a quiet voice. The typed box must cover
   whatever fails.
3. Ask blind testers to do the same tasks without help. Note where they get
   stuck and what they try to say that isn't understood: those phrasings
   belong in `commands.ts`.

## How the board is handled

- Editing never sends anything. The board only changes when you press Send
  Pattern or Reset Physical Pins.
- A finished Bluetooth write doesn't count as success. The app waits for an
  ACK with the matching command ID.
- Reset clears the preview only after the ACK. If it fails, the app says the
  pins may still be up and offers Retry.
- Only one command runs at a time.
- Saved patterns remember their grid size. A pattern from a different size
  is cropped or padded, after you confirm.
- Export writes every saved pattern to a JSON file. Import adds patterns from
  such a file and never overwrites: duplicates are skipped and name clashes
  become "Name (2)".

## Dependency notes

- `react-native-ble-plx` 3.5.1 officially supports only up to RN 0.74 and
  Expo 51. This project is on RN 0.88 and Expo 58, and the native build hasn't
  been compiled yet. If it fails, the fork `@sfourdrinier/react-native-ble-plx`
  supports Expo 57+ with the same API, so only the import in
  `src/device/ble/BleDriver.ts` would change.
- `fast-png` decodes PNGs in plain JavaScript.
- All other native packages were added with `npx expo install`, so their
  versions match SDK 58.
