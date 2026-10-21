# PinVisual

An Expo + React Native + TypeScript app for a tactile pin display. It turns
images or hand-drawn patterns into raised (1) and lowered (0) pins and sends
them over Bluetooth Low Energy to an ESP32, which drives servos through PCA9685
boards. It runs fully offline, with no accounts and no cloud.

- Firmware protocol: **[docs/PROTOCOL.md](docs/PROTOCOL.md)**
- Hardware and grid settings: **`src/config/hardware.ts`** (grid is a provisional 5 × 8)

---

## Status

| Feature | State |
|---|---|
| Manual grid editing, Clear Grid | ✅ Working; tested in the iOS simulator (Expo Go) |
| Send Pattern / Reset Physical Pins | ✅ Covered by automated tests against a simulated board (test-only); needs a real board to try in the app |
| Protocol: framing, CRC, chunking, command IDs, retries, timeouts, ACK matching | ✅ Implemented and unit-tested against the simulated firmware |
| Image → pins (background removal, axis/grid removal for graphs, label removal, smart + manual crop, thin-line thickening, live screen sharing on web) | ✅ Unit-tested, and clicked through in the web app with a textbook-style triangle diagram; the photo picker and crop dragging still need a manual test on a phone |
| Shape snapping (triangle … hexagon, circle/oval), drawn filled | ✅ Unit-tested and checked in the web app |
| Smart Cut-Out (AI subject segmentation) | ✅ Web (U²-Net) checked in Chrome. ⚠️ iOS (Apple Vision) and Android (ML Kit) written, **need a new development build** to run |
| Letter recognition | ⏳ Planned |
| Save / load / delete patterns on the phone | ✅ Store logic unit-tested; UI rendered in the simulator |
| Export / import saved patterns (backup file) | ✅ Unit-tested; download and file import checked in Chrome. ⚠️ Phone share sheet and paste import not yet tried on a device |
| Tap to focus (shapes, cards, one of several graphs, one curve, one cut-out subject) | ✅ Unit-tested and checked in Chrome |
| **Live camera** on the website (phones and laptops) | ✅ Unit-tested, and checked in Chrome with a simulated phone camera (graphs on paper, a shape on a table, hand shake, denied permission). ⚠️ Not yet tried on a real phone |
| Graph Range (±2 / ±5 / ±10 units around the curve's key point) | ✅ Web, checked on 27 real Desmos screenshots. ⚠️ Needs `tesseract.js` installed to read axis numbers; phones count one grid square as one unit |
| Background removal refined GrabCut-style (shapes and objects, screen share and camera): background patterns away from the edge, speckle, pale subjects, other objects | ✅ Unit-tested (min cut checked against brute force; scenes compared with the true outline) and checked in Chrome with simulated camera clips |
| Camera lock by distinctive points (turning, tilting, quick moves, look-alike items), template matching as the fallback | ✅ Unit-tested on a virtual camera (60° turn, 30° tilt, 2.2x zoom, a jump of a third of the frame: corners within ~2 px) and checked in Chrome with a simulated phone camera that turns ±31°. ⚠️ Not yet tried on a real phone |
| Graph zoom: the curve keeps its size on the pins while you zoom (followed frame by frame through Desmos' 1-2-5 grid steps) | ✅ Unit-tested, and checked on a real Desmos zoom (10x in, steps 2 → 1 → 0.5 → 0.2: scale within 0.1%, window always 10 units) |
| Graph panning (arrows under Graph Range), and the graph in words ("Lowest point at (0, −3). Pins show x from −5 to 5…") | ✅ Unit-tested and checked in Chrome |
| One-Pin Lines: graph curves drawn as a connected line one pin wide | ✅ Unit-tested (also on real Desmos screenshots) and checked in Chrome |
| Type an equation (y = x^2 − 3, sin(x), 1/x, \|x\|…) and draw it, at an exact scale | ✅ Unit-tested and checked in Chrome |
| Send Live to Board: a live share's or camera's pins follow on the board (only changes, newest first, at most every 0.6 s for the servos) | ✅ Unit-tested against a fake board. ⚠️ Never run against a real board |
| **Real Bluetooth** (scan, connect, write, notify) | ⚠️ Implemented, **never run**: needs a development build, a physical phone, and firmware |
| **Web app** layout (laptop 1280/1440, tablet 820, phone 390) | ✅ Checked in headless Chrome: no horizontal overflow, no console errors |
| **Web Bluetooth** (Chrome/Edge) | ⚠️ Implemented, **never run** against a board |
| BLE UUIDs | ⛔ **Placeholders** until the firmware defines them |
| Physical pin positions | ⛔ Not verifiable: the hardware has no position sensing. The app only reports that the board acknowledged a command. |

## What happens where

```
src/
  app/                 Screens (Expo Router): Display, Image, Saved, Device
  config/hardware.ts   Grid size, BLE UUIDs, protocol timing (one place to edit)
  domain/pattern.ts    Grid model, pin order, bit packing
  protocol/            Message encoding, CRC-16, chunking, CommandClient (acks, retries)
  device/
    types.ts           DeviceDriver + Transport interfaces (BLE on phones and on the web)
    DeviceController   Connection state, the one-command-at-a-time lock, send/reset
    LiveSender         Send Live to Board: changes only, newest first, paced for the servos
    ble/BleDriver      react-native-ble-plx (iOS/Android); BleDriver.web.ts = Web Bluetooth
    __tests__/support  Simulated board for the automated tests only (MockFirmware); not in the app
  imaging/             Pixel conversion (pure, unit tested), PNG decoding, image loading (.web.ts = canvas)
    foreground         Background model, subject mask, axis/grid removal
    refineMask         GrabCut-style refinement of a filled subject's mask; maxflow.ts = the min cut
    features           Distinctive points (ORB: FAST corners, rotated BRIEF), matching
    featureTracker     Camera lock by points: RANSAC similarity + homography
    itemTracker        Camera lock: points first, template (tracker.ts) as the fallback
    smartCrop          What becomes pins (+ tap to focus); curves.ts finds graph curves, plotGrid.ts plot areas
    graph              Graph Range: axes, the curve's key point, the window; axisNumbers*.ts = OCR
    graphScale         Pixels per unit: from the axis numbers, the grid, or followed through a zoom
    graphSummary       The graph in words (screen readers)
    equation           Typed equations: a safe parser, drawn as a plot of known scale
    pinSampling        Thin-line thickening, mask → pins, the preview
    geometry / masks   Rectangles, points, hulls, overlap; connected pieces, growing masks; stats.ts = median
    imageInput.web     Live screen share and camera capture; cameraDevice.web = opening and focusing the camera,
                       imageDrop.web = drag and drop / paste
  storage/             Saved patterns (AsyncStorage, local only), export/import files (patternFile*.ts)
  state/               React providers and hooks (useImageConversion = the Image tab's pipeline; its frame-to-frame
                       decisions are plain functions in conversionLogic.ts; useConversionSettings = the settings)
  ui/                  Theme, components, AppTabs (native tabs) / AppTabs.web (sidebar), layout breakpoints;
                       the Image tab's cards (ImageSourcePicker, ConversionSettings, ImageResult, GraphRangeControl)
```

The app only connects to real boards over Bluetooth. The automated tests use a
simulated board (`src/device/__tests__/support`) that runs a software copy of the
firmware protocol through the same `DeviceDriver`/`Transport` interface, and can be
slow, lossy, silent or faulty to test retries, timeouts and error handling.

## Setup

Requirements:

- **Node.js 22.13 or newer.** React Native 0.88 (Expo SDK 58) requires it. This
  project was set up on Node 20.19, which prints engine warnings. Tests,
  type checks and JS bundling worked, but upgrade before building native apps.
- For iOS builds: Xcode and CocoaPods (`brew install cocoapods`), or use EAS Build.
- For Android builds: Android Studio / SDK, or use EAS Build.

```bash
npm install
npm test            # Jest unit tests
npm run typecheck   # tsc --noEmit
npx expo lint
```

GitHub runs the same checks, plus a web build, on every push and pull request
(`.github/workflows/ci.yml`, Node 22).

### Run the app

```bash
npm start
```

This starts the Expo dev server in **Expo Go** mode (`expo start --go`). In the
terminal, press:

- `i`: open in the iOS simulator
- `a`: open on an Android emulator or connected phone
- `w`: open the web app in your browser
- or scan the QR code with Expo Go on your phone

Once you have built and installed a development build (needed for Bluetooth on
the phone), use `npm run start:dev-client` instead. Plain `npx expo start`
looks for a development build by default, because `expo-dev-client` is
installed. Without one it fails with `No development build ... is installed`.

Bluetooth cannot run in Expo Go. The app detects this and says so on the Device
tab. The grid, image conversion and saved patterns all work.

### Web app (laptops, tablets and phones in a browser)

```bash
npm run web         # dev server at http://localhost:8081
npm run build:web   # static site in dist/ (single-page app)
```

#### Putting it on your website

1. Build. At the root of a site or subdomain (`https://pinvisual.example.com/`):
   `npm run build:web`. In a folder of a site (`https://example.com/pinvisual/`):
   `WEB_BASE_URL=/pinvisual npm run build:web` (the folder name must match).
2. Upload **everything inside `dist/`** (including the hidden `.nojekyll` file
   and the `_expo`, `ort`, `models` and, once installed, `tesseract` folders) to that place on your host.
3. Open it over **https://**. Bluetooth and screen sharing need it (or `localhost`).

No server code or rewrite rules are needed: the build also writes the page at
`/image`, `/saved`, `/device` and `404.html` (`scripts/web-routes.mjs`), so
opening or refreshing any tab works on any static host (GitHub Pages, Netlify,
Vercel, Cloudflare Pages, a plain web server). Check the build first with
`npx expo serve` (root builds only). **Vercel:** import the GitHub repo at
vercel.com/new and press Deploy; `vercel.json` holds the build settings, and
every push to `main` redeploys. Rebuild after changing the folder: it is
fixed at build time. The AI cut-out files (`ort/`, `models/`, about 15 MB) load
only when a busy photo needs them. Saved patterns stay in each visitor's
browser.

- **Laptop (900 px and wider):** macOS-style sidebar with the connection status
  at the bottom. Screens use two columns when the content area is 900 px or
  wider: the pin grid on the left and Send/Reset on the right.
- **Tablet and phone browsers:** bottom tab bar, one column, the same layout as
  the native app. Native iPads in landscape also get the two-column layout.
- **Bluetooth on web** uses Web Bluetooth (`src/device/ble/BleDriver.web.ts`) in
  **Chrome or Edge** on desktop and Android. The browser shows its own device
  chooser, and the app connects to the board you pick. Safari, Firefox and
  every iOS browser have no Web Bluetooth, so the Device tab says so. Web Bluetooth doesn't report the MTU, so the app uses safe
  20-byte writes.
- **Live Camera** (web, `src/imaging/imageInput.web.ts`): point a phone (or a
  laptop's webcam) at a worksheet, a screen or an object and the pins follow
  it live. It runs everything screen sharing does (smart crop, curves and
  plots, tap to focus, Graph Range, shapes, the pin lock), plus three things
  a camera needs (`src/imaging/cameraFrame.ts`): each frame is lightly
  blurred, because sensor noise would otherwise make every frame count as a
  photo and switch graph detection off; each pin is averaged over the last
  frames and only flips once it clearly changed, so noise and a shaking hand
  don't make pins flicker; and frames are 640 px and at most 4 a second,
  paced to the phone: the analysis runs on the page's main thread (which
  also shows the video), so each frame's cost is measured and a slower phone
  (many Androids) gets longer gaps, keeping the main thread at most ~45% busy
  and the preview smooth. **Lock:** once the camera finds an item (a graph, a
  shape, an object) on two frames in a row, it locks onto it (*Live · Locked*)
  and follows it as the phone moves, sideways, closer or further, turned or
  tilted, until you tap another item, which it then locks onto instead
  (`src/imaging/itemTracker.ts`). Mainly by the item's distinctive points
  (ORB, `features.ts` + `featureTracker.ts`): corners with a rotation-aware
  description, matched to each frame (near where they were, and anywhere, so a
  look-alike graph next to it can't take over), the movement fitted robustly
  (RANSAC: shift, turn, size, then perspective for tilt). The points are
  renewed as the item looks different, but only on a solid estimate or when
  the smart crop confirms it. Plain items with few corners, and blurred
  frames, fall back to template matching (`tracker.ts`: a small picture of the
  item, searched near its last place at a few sizes). About 5-10 ms a frame on
  a laptop. A turned graph is followed, but Graph Range still needs it
  roughly level (its gridlines are looked for across and down). The
  smart crop is pointed at the item every frame, the lens is asked to focus
  on it, and a locked graph keeps its units as you zoom: its scale is resized
  by how much bigger the tracked graph has become. Auto Crop or dragging the
  crop box releases the lock; so does the item staying out of view for ~3 s.
  **Screens and pages:** pointed at a laptop or phone screen, a sheet of
  paper or a whiteboard, the camera finds its four corners (like a document
  scanner, `src/imaging/surface.ts`) and straightens it from the
  full-resolution video, so a graph on a screen seen from the side gets
  straight gridlines and loses the room around it (*Live · Flat*). The crop
  box and taps still work on the camera view. Captures of a screen or page
  are straightened too. **Camera backgrounds** (`foreground.ts`, `camera`
  option): the background may have several colours (a checked cloth) and
  shadows, so it is modelled as the edge's main colours with shading
  allowed; wood grain or patterned cloth is not taken for graph curves
  (curves need a page-like background in raw camera frames).
  **Darkness:** an essentially black picture (a covered lens, a dark room) is
  not analysed (phones turn it into costly noise); the pins keep their last
  picture and a *Too dark* note shows. After the light changes, frames are
  skipped while the camera's exposure settles. Once locked onto an item, the
  smart crop only searches around it, which keeps slow phones smooth.
  **Focus:** phones with several back cameras sometimes
  give the browser a fixed-focus one (ultra-wide, depth), so the app checks
  and, if needed, switches to a back camera that can autofocus (remembered
  for next time), and keeps focus and exposure continuous. Tapping the
  picture also focuses the lens there (Chrome on Android; iPhones focus by
  themselves). Each frame's sharpness is measured; while the lens refocuses,
  blurry frames are skipped (the pins keep the last sharp result, and the
  badge says *Focusing…*), and after about 2 s of blur a tip suggests moving
  back a little. **Capture** refocuses first and keeps the sharpest of the
  next frames (waiting up to about 2 s for one as sharp as the live view). Phones open the back camera; **Flip Camera** appears
  when there is a front one too. **Capture** takes a photo (the camera's full
  picture, cleaned like the live frames) and carries on with it as a still
  picture, keeping whatever you tapped or cropped; Smart Cut-Out can then help
  with busy backgrounds. **Stop Camera**, or leaving the Image tab, turns the
  camera off and keeps the last live frame. Browsers only
  allow the camera on `https://` (Vercel is) or `localhost`. If the app is
  embedded in another page with an `<iframe>`, add `allow="camera"` to it.
- **Images on web** are read with a canvas (`src/imaging/loadImage.web.ts`).
  The conversion code is the same as in the mobile app.
- **More ways to add an image on web** (`src/imaging/imageInput.web.ts`):
  drag an image anywhere onto the Image tab (a file from Finder or the desktop,
  or an image dragged out of another web page: those arrive as a link and an
  `<img>` tag, not a file, and are downloaded; sites that forbid reuse (CORS)
  get a message suggesting Copy Image + paste), paste one with Cmd/Ctrl+V, or press
  **Share Screen** (desktop browsers only). Share Screen opens the browser's
  share picker (screen, window or tab) and keeps sharing: the crop box sits on
  the live video, and each new frame is processed as soon as it arrives (at
  most 5 times a second, only when the picture changed), so the pins preview
  follows. One `<video>` element both feeds processing and is shown behind the
  crop box: a shared window only sends a frame when something on it changes,
  so a second element attached later would stay black until then. Measured
  in Chrome: picture and pins preview about 0.25 s after sharing starts. Nothing reaches the board
  until you press **Use This Pattern** and then **Send**. **Stop Sharing** (or
  the browser's own stop button) keeps the last frame. Phones use the photo
  picker; to use something on a phone's screen, take a screenshot and choose it.

## Test on a physical phone

The simulator cannot test the following:

1. **Permissions**: the iOS Bluetooth prompt, Android 12+ "Nearby devices",
   Android 11 and older location permission, and the photo library prompt.
2. **Scanning** finds the ESP32 (name `PinVisual…` or the service UUID).
3. **Connecting** finds the service and both characteristics. With placeholder
   UUIDs this fails with a clear message, which is expected.
4. **MTU**: the Device tab shows the negotiated MTU and write size.
5. **Send** → firmware gets the right bytes (compare with the test vectors in
   `docs/PROTOCOL.md`) → the app shows "Board received pattern".
6. **Pin order**: raise only row 1, column 1 (top-left) and check the physical
   pin; then row 5, column 8 (bottom-right).
7. **Retries**: with firmware ACKs disabled, the app should try 3 times and
   then show a failure with Retry.
8. **Disconnect mid-send** (power off the ESP32): the app should show
   "Connection lost".
9. **Reset**: the preview clears and the app returns to the Display tab only
   after the ACK arrives.
10. **VoiceOver / TalkBack**: each pin reads as "Row r, column c, raised/lowered".
11. **Image picker**: real photos, PNG with transparency, very large images.

## Design and accessibility

- iOS-style design: native tab bar, large titles, grouped cards, system font
  sizes, SF Symbols (Material Symbols on Android), light and dark mode.
- Text colours are tuned for WCAG AA contrast.
- Status never relies on colour alone. Raised pins are solid domes and lowered
  pins are hollow rings. Every status has an icon and text.
- Grid cells are at least 40 pt and fill the width. On very narrow screens or
  large grids, the grid scrolls sideways instead of shrinking.
- Screen readers: each pin is announced as "Row r, column c", value "raised" or
  "lowered", with a hint. Read-only previews give a row-by-row summary. Send,
  reset and save results are announced.
- The connection status pill stays in every screen's header; tapping it opens
  the Device tab.

## Behaviour notes

- **Editing never sends.** The board changes only when you press Send Pattern or
  Reset Physical Pins.
- **Success means acknowledged.** A completed BLE write is not success. The app
  waits for an ACK with the same command ID (see `CommandClient`).
- **Reset** sends the RESET command. Only after the ACK does it clear the preview
  and return to the Display tab. If it fails, the app says the pins may not have
  been lowered and offers Retry.
- **Only one command at a time.** Send and Reset are disabled while one is
  pending, and the controller rejects overlapping calls too.
- **Image conversion** (`src/imaging/foreground.ts`): downscale to 800 px
  (also for screen sharing; enough to keep thin graph lines) → decode pixels (`fast-png` on phones, a canvas
  on web). Then:
  1. **Background colour** = median colour of a thin ring around the crop
     edge (a manual crop usually frames the background), or the image edge
     when the crop edge is clearly messier.
  2. **Subject** = pixels whose colour differs from it by more than
     *Tolerance*. Colour distance, not darkness, so pale fills count.
     Tolerance is **automatic** ("Auto · 24"): the histogram of distances
     from the background is cut with the triangle method (Zack 1977, OpenCV
     `THRESH_TRIANGLE`), where the background peak ends; never below a noise
     floor measured on the image edge (2.5 × its spread + 8) and kept within
     24–90. It is recomputed for every image, live frame and crop. Dragging
     the slider sets it by hand; **Auto** returns to automatic. The slider is
     hidden when tolerance doesn't apply (graph curves taken by their own
     colour, Smart Cut-Out).
     **Refinement** (shapes and objects, screen share and camera alike;
     `refineMask.ts`, GrabCut-style after Rother et al. 2004): the first
     mask judges each pixel alone against the edge colours, which leaves
     background patches whose colour isn't on the edge (a pattern, a
     shadow, a second desk colour), camera speckle, and bites out of pale
     subjects. So, on a ~160 px copy: everything well outside the box the
     smart crop picked is sure background; how often each colour is seen
     as background vs. subject is counted (by count, so a cloth pattern
     touching the object is still cloth); and all pixels are decided
     together by a minimum cut (`maxflow.ts`, Boykov–Kolmogorov), where
     neighbours pay to be split except across a real edge. Twice, then the
     outline is redrawn at full size from its colours. Graphs and thin
     line drawings skip it (the cut would thin a 1–2 px line); a result
     wildly different from the first mask is discarded. A few ms per frame.
  3. **Axes & grid**: long, thin, isolated straight lines are found. If a
     horizontal and a vertical one cross and something else remains (a curve,
     bars), the image is treated as a graph: the lines are removed (only
     where a pixel has the line's own colour, so a red curve crossing a grey
     axis survives; gaps where a stroke continues on both sides are filled
     back in) and the
     graph is stretched to fill all pins (its x/y scales are arbitrary). The
     *Remove Axes & Grid* switch appears only when lines are found and
     overrides the guess. A letter T or E is not mistaken for axes, because
     nothing remains once its lines are removed.
  4. **Labels & text**: pieces smaller than 15% of the biggest piece (labels,
     tick numbers, watermarks) are dropped. When the main subject is coloured,
     smaller grey/black pieces (axis numbers, captions) are dropped too.
  5. **Smart crop** (`src/imaging/smartCrop.ts`) decides what becomes pins:
     - *Photo or screenshot?* Screenshots, diagrams and clip art have lots of
       perfectly flat colour, photos almost none. Smart Cut-Out turns on by
       itself only for busy **photos**; on a graph it would keep one blob and
       drop the thin curves.
     - *Graphs (e.g. Desmos):* coloured, long, thin, solid strokes are curves;
       grey axes, gridlines and text, short icons, filled buttons, rectangle
       outlines (input boxes, frames, even with an icon fused to them) and
       scattered photo noise are ignored. Strokes that outline a filled area
       (a triangle diagram's edge) are a shape, not a graph.
       Curves count wherever the area around them is flat, so sharing the
       whole screen (photo wallpaper and all) still finds them.
     - *Graphs with a black or grey curve:* colour can't separate the curve
       from axes and text, so the **plot area** is found by its structure: a
       grid of long, thin, crossing horizontal and vertical lines, detected
       as local dips in brightness (so faint, shrunk gridlines count and solid
       toolbars don't). Inside the plot the background really is one colour;
       axes and gridlines are erased (every row of an anti-aliased line, dark
       core and light edge), labels are dropped as small, framed UI (zoom
       buttons) is dropped, and what remains is the curve.
       Curves are found at full size (shrinking fades thin lines), and their
       own colour becomes the subject, so no background guessing is needed
       near toolbars and panels.
     - *Shapes and objects:* each piece that differs from the background
       (flat or gradient) is scored by size, colour, closeness to the centre,
       not touching the edge and not looking like text. If the winner is a
       card (e.g. an image thumbnail), the search repeats inside it. Decided on
       a half-size copy for speed (under 10 ms per frame).
     - **Tap** in the crop area to choose what becomes pins; a ring marks the
       spot. It stays focused as live frames update; Auto Crop returns to
       automatic. (Clicks made directly on another window can't be seen by a
       web page, so tap in PinVisual.)
       - On a shape: the piece whose own pixels are under your finger wins,
         even when a bigger shape's box surrounds the spot (a dot inside an arc).
       - On a card's background (one result in a grid of image search results):
         the shape on that card. On empty space: the nearest thing.
       - On a page with several graphs: only the plot you tapped.
       - On a curve: only that curve (tap the blue line to drop the red
         parabola). On empty graph paper every curve stays.
       - With Smart Cut-Out on and several subjects found: the one you tapped.
     - **Graph Range** (graphs only, `src/imaging/graph.ts`): instead of
       squeezing the whole curve onto 40 pins, the pins show ±2, ±5 (default)
       or ±10 units at the graph's true proportions, placed where the curve
       says the most: a parabola's vertex (in the bottom or top row so both
       arms show), a cubic's or wave's middle, a circle's centre, where a root
       or log starts, where a line crosses the y-axis, or the origin between
       the branches of 1/x. Units come from the numbers on the axes, read on
       the device with Tesseract.js OCR (web, offline, served from
       `public/tesseract/`); without readable numbers (or on phones, for now)
       one major grid square counts as one unit, which on real Desmos
       screenshots can be off. Zooming in keeps the curve the same size on
       the pins: the window stays ±5 units even when the screen shows less,
       and the part off screen is just lowered pins (a note says so). In a
       live share the scale follows the zoom frame by frame (`followZoom`:
       when the grid spacing suddenly halves, the graphing tool switched to
       its next 1-2-5 step; the zoom itself changes little between frames),
       so the curve keeps its size even when the numbers can't be read. The
       numbers are read once the zoom settles, to confirm it. Zoomed out so far that ±5 units is a few pixels, the window is
       made larger and a note says so.
     - Drag the box or its corners to choose yourself. The same smart logic
       then runs inside your box (curves first, then the best object), so
       stray UI caught by the box is ignored and empty margins don't waste pins.
       Auto Crop goes back to the smart crop.
  6. **Thin lines** (graphs, outlines, handwriting) are thickened to about half
     a pin, so a line running through a pin raises it. Filled shapes are left alone.
  7. **Shapes** (not graphs): closed outlines are filled in (a solid shape is
     the easiest to feel on 40 pins). If the subject is a clean convex shape (triangle,
     square, rectangle, pentagon, hexagon, circle, oval), its exact corners
     are found (convex hull, corner simplification, edges extended to sharp
     corners) and the perfect shape is drawn on the pins, as large as the grid
     allows. It is then **perfected**: tilts under 8° are straightened, and
     nearly equilateral/isosceles/right triangles, rectangles, squares,
     diamonds, regular pentagons/hexagons and circles become exact. A
     mirror-symmetric shape gets a mirror-symmetric pin pattern centred on the
     grid's middle line, and sharp tips always get a pin. *Snap to Triangle*
     (etc.) appears only when a shape is found and turns this off.
  8. Otherwise the crop is placed on the grid (aspect ratio kept, centred, empty
     space lowered; stretched for graphs). **Sensitivity** (default 65%):
     higher raises more pins; a pin is raised when at least 100 − Sensitivity
     percent of it is subject.

  *What the pins see* shows the removed background as a checkerboard. With
  *Remove Background* off, darkness is used instead. When a **photo** has a
  busy background (the ring of pixels used to guess the background has many
  different colours), **Smart Cut-Out** turns on by itself (and can be switched off): an on-device AI model separates the main
  subject, like remove.bg but free and offline (`src/imaging/segment*.ts`):
  - **iPhone/iPad (iOS 17+):** Apple Vision subject lifting, through the local
    module `modules/subject-segmentation`. Not in Expo Go or the simulator.
  - **Android:** Google ML Kit Subject Segmentation (beta), same module. Play
    services downloads the model when the app is installed.
  - **Web:** U²-Net small (`public/models/u2netp.onnx`, 4.4 MB, Apache-2.0)
    run with ONNX Runtime Web (MIT). The runtime is copied into `public/ort/`
    by `scripts/copy-ort.mjs` on `npm install`; both are served by the app
    itself, so it works offline. Loaded the first time it is needed.
  - In Expo Go (no native module) the switch is hidden and colour-based removal
    is used.
- **Saved patterns** keep rows × cols. Patterns from a different grid size are
  flagged and only load after you confirm a centred crop or pad.
- **Backup** (Saved tab): **Export** writes every pattern to a small JSON file
  (`pinvisual-patterns-YYYY-MM-DD.json`; a download on web, the share sheet on
  phones). **Import** adds the patterns from such a file (file picker on web;
  paste the text on phones). Nothing is ever overwritten: identical patterns
  are skipped and a different one with a taken name becomes "Name (2)". Still
  no accounts or cloud: the file goes wherever you put it.

## Dependency notes

- `react-native-ble-plx` **3.5.1** (upstream). React Native Directory lists it as
  New Architecture compatible, but its own docs only claim RN 0.74 / Expo 51.
  This project uses RN 0.88 / Expo SDK 58. The JS bundles and native config
  plugin work, but the native build has not been compiled yet. If it fails, the
  community fork `@sfourdrinier/react-native-ble-plx` targets Expo SDK 57+ with
  the same API, so only the import in `src/device/ble/BleDriver.ts` would change.
- `fast-png` 8.0.0: pure-JS PNG decoder.
- Every other native dependency was installed with `npx expo install`, so
  versions match SDK 58. `npx expo-doctor` passes all 20 checks.
