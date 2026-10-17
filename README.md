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
| Send Pattern / Reset Physical Pins to **mock device** | ✅ Working; covered by automated tests (not tapped through in the simulator) |
| Protocol: framing, CRC, chunking, command IDs, retries, timeouts, ACK matching | ✅ Implemented and unit-tested against the simulated firmware |
| Image → pins (grayscale, aspect-ratio fit/fill, threshold, invert) | ✅ Conversion math and PNG decoding unit-tested; the photo picker still needs a manual test on a phone |
| Save / load / delete patterns on the phone | ✅ Store logic unit-tested; UI rendered in the simulator |
| **Real Bluetooth** (scan, connect, write, notify) | ⚠️ Implemented, **never run**: needs a development build, a physical phone, and firmware |
| **Web app** layout (laptop 1280/1440, tablet 820, phone 390) | ✅ Checked in headless Chrome: no horizontal overflow, no console errors; mock connect → toggle → send → reset clicked through end to end |
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
    types.ts           DeviceDriver + Transport interfaces, shared by mock and BLE
    DeviceController   Connection state, the one-command-at-a-time lock, send/reset
    ble/BleDriver      react-native-ble-plx (iOS/Android); BleDriver.web.ts = Web Bluetooth
    mock/              Simulated board that runs the same protocol (MockFirmware)
  imaging/             Pixel conversion (pure), PNG decoding, image loading (.web.ts = canvas)
  storage/             Saved patterns (AsyncStorage, local only)
  state/               React providers and hooks
  ui/                  Theme, components, AppTabs (native tabs) / AppTabs.web (sidebar), layout breakpoints
```

The **mock device** connects through the same `DeviceDriver`/`Transport`
interface as Bluetooth and runs a software copy of the firmware protocol. Mock
mode is always labelled "Mock Device" and never shown as "Connected". From the
Device tab you can make the simulated board slow, lossy, silent or faulty to
test retries, timeouts and error handling.

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
tab. Mock mode, the grid, image conversion and saved patterns all work.

### Web app (laptops, tablets and phones in a browser)

```bash
npm run web         # dev server at http://localhost:8081
npm run build:web   # static site in dist/ (single-page app)
```

`dist/` can go on any static host (Netlify, Vercel, GitHub Pages, an S3
bucket). Configure the host so unknown paths serve `index.html`; otherwise
`/device` won't load on refresh. Bluetooth only works on **https://** or
`localhost`.

- **Laptop (900 px and wider):** macOS-style sidebar with the connection status
  at the bottom. Screens use two columns when the content area is 900 px or
  wider: the pin grid on the left and Send/Reset on the right.
- **Tablet and phone browsers:** bottom tab bar, one column, the same layout as
  the native app. Native iPads in landscape also get the two-column layout.
- **Bluetooth on web** uses Web Bluetooth (`src/device/ble/BleDriver.web.ts`) in
  **Chrome or Edge** on desktop and Android. The browser shows its own device
  chooser, and the app connects to the board you pick. Safari, Firefox and
  every iOS browser have no Web Bluetooth, so the Device tab says so and mock
  mode still works. Web Bluetooth doesn't report the MTU, so the app uses safe
  20-byte writes.
- **Images on web** are read with a canvas (`src/imaging/loadImage.web.ts`).
  The conversion code is the same as in the mobile app.
- **Saved patterns on web** live in the browser's local storage, separate from
  the phone's.
- Confirmation dialogs use the browser's `confirm()`, because React Native's
  `Alert` does nothing on web.

### Development build (needed for Bluetooth)

`react-native-ble-plx` is a native module, so it needs a development build.

Local build, with a phone connected by USB:

```bash
npx expo prebuild --clean     # generates ios/ and android/ from app.json (don't edit those by hand)
npx expo run:ios --device     # or: npx expo run:android --device
```

Or a cloud build with EAS:

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile development --platform ios      # or android
# install the build on the phone, then:
npx expo start --dev-client
```

iOS needs an Apple developer account to install on a physical phone. Simulators
have no Bluetooth, so **BLE testing needs a real phone**.

Change the bundle ID (`com.sldp.pinvisual` in `app.json`) if it clashes with your
Apple or Google account.

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
  pins are hollow rings. Every status has an icon and text, and mock mode has
  its own icon and label.
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
- **Image conversion:** downscale with `expo-image-manipulator` → export PNG →
  decode pixels in JS with `fast-png`. The image manipulator has no pixel API,
  which is why decoding is a separate step. Then Rec. 709 grayscale (transparency
  counts as white) → area-average each pin's region → threshold (default 128;
  darker = raised) → optional invert. **Fit** pads with lowered pins; **Fill**
  crops edges equally. There is no background removal.
- **Saved patterns** keep rows × cols. Patterns from a different grid size are
  flagged and only load after you confirm a centred crop or pad.

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
