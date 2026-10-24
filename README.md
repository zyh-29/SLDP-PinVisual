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
| Graph Range (±2, ±5 or ±10 units around the curve) | Works on the web. Reading axis numbers needs `tesseract.js`; on phones one grid square counts as one unit |
| Graph zoom, panning, and a spoken description of the graph | Works |
| One-Pin Lines (curves drawn one pin wide) | Works |
| Typing an equation to draw it | Works |
| Send Live to Board | Tested against a simulated board only |
| Bluetooth on phones | Written, never run. Needs a development build, a phone and firmware |
| Web layout (laptop, tablet, phone) | Works |
| Web Bluetooth (Chrome, Edge) | Written, never run against a board |
| Letter recognition | Not started |
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
                  foreground, refineMask, maxflow   background removal
                  smartCrop, curves, plotGrid       choosing what becomes pins
                  graph, graphScale, graphSummary   graphs: range, units, description
                  equation                          typed equations
                  features, featureTracker,         camera lock
                  itemTracker, tracker
                  surface                           flattening screens and pages
                  shapes, pinSampling               shapes, and the final pins
                  imageInput.web, cameraDevice.web  camera, screen sharing, drag and drop
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

### Graphs

Squeezing a whole curve onto 30 pins loses its shape, so Graph Range shows
±2, ±5 or ±10 units at the graph's real proportions. It centres on the most
interesting part: a parabola's vertex, the middle of a wave, where a line
crosses the y-axis, and so on.

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
- **Steadier pins.** Frames are lightly blurred to remove sensor noise, and
  each pin is averaged over a few frames so it doesn't flicker.
- **Speed.** Frames are 640 px and the app adapts how often it processes them
  to how fast the phone is.
- **Focus and light.** Blurry frames are skipped while the lens refocuses, and
  very dark frames aren't processed. Tapping the picture also focuses there
  (Chrome on Android).
- **Capture button.** Takes a full-resolution photo and carries on with it as
  a still picture.

The camera only works over https or on localhost. If the app is inside an
`<iframe>`, add `allow="camera"` to it.

### Screen sharing (desktop web)

Share Screen lets you pick a screen, window or tab. The pins follow it live,
up to five times a second. Nothing is sent to the board until you press
**Use This Pattern** and then **Send**.

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
   the bottom-right one.
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
  and announce send, reset and save results.
- The connection status is in every screen's header; tapping it opens the
  Device tab.

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
