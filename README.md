<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/images/logo-dark.svg">
    <img src="./assets/images/logo.svg" alt="PinVisual" width="360"/>
  </picture>
</p>

<p align="center">
  <a href="https://github.com/zyh-29/SLDP-PinVisual/actions/workflows/ci.yml"><img src="https://github.com/zyh-29/SLDP-PinVisual/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
  <a href="https://zongyaohuang.com/pinvisual"><img src="https://img.shields.io/badge/try%20it-web-7C3AED.svg" alt="Try it on the web"/></a>
</p>

# PinVisual 📍

PinVisual is a React Native / Expo app for a **tactile pin display**, built so
blind and low-vision people can feel pictures, shapes, letters and graphs. You
draw a pattern, give it a picture, or say what you want, and it works out which
pins should be up and which should be down. The pattern goes over Bluetooth Low
Energy to an ESP32, which moves one servo per pin through PCA9685 servo boards.

Everything runs on the device. There are no accounts and no backend, and
nothing leaves the device unless you turn on an online feature (picture search
or online speech recognition).

## 📱 App Information

- **Version:** 1.0.0
- **Platforms:** iOS, Android and web
- **Grid:** 5 × 6 (30 pins), set in `src/config/hardware.ts`
- **Bundle ID (iOS) / Package (Android):** `com.sldp.pinvisual`
- **Try it in a browser:** https://zongyaohuang.com/pinvisual

## ✨ Features

### Core Features

- ✏️ **Draw on the grid** and send the pattern to the board
- 🖼️ **Picture to pins** - photos, drawings, graphs, shared screens and the live
  camera, with automatic background removal, smart cropping and shape snapping
  ([how it works](docs/IMAGING.md))
- 📈 **Graphs and equations** - type `y = x^2 - 3` or point the camera at a graph;
  pick the range, zoom, pan and hear a description
- 🎙️ **Voice commands** - spoken or typed: "show a circle", "letter B", "graph y
  equals x squared", "send" ([full list](docs/VOICE.md))
- 🔤 **Letters and digits** - A–Z and 0–9 drawn for the pins
- 💾 **Saved patterns** with backup export and import

### Technical Features

- 🔒 **On-device everything** - image processing, subject cut-out and voice
  understanding run locally
- 🧠 **Smart Cut-Out** - Apple Vision (iOS 17+), ML Kit (Android), U²-Net with
  ONNX Runtime Web (browser)
- 🗣️ **Built-in voice model** - a small fastText-style network (177 KB) that
  understands commands phrased many ways, with no download
- 📡 **Reliable Bluetooth protocol** - framing, CRC-16, chunking, ACKs, retries
  and timeouts ([spec](docs/PROTOCOL.md))
- ✈️ **Works offline** on the web after the first visit, and installs to a
  phone's home screen
- ♿ **Screen reader first** - every pin, preview and result is announced
- 🌓 **Light and dark mode**, following Apple's Human Interface Guidelines

## 🚧 Project Status

The app works in the iOS simulator and in Chrome. Bluetooth has been tested
against a simulated board but **not yet against real hardware**. Help testing on
real devices is very welcome (see [docs/TESTING.md](docs/TESTING.md)).

| Feature | Status |
|---|---|
| Drawing, Clear Grid, saving and loading | ✅ Works |
| Picture to pins, shape snapping, tap to pick | ✅ Works on the web; not yet run through on a phone |
| Graph Range, zoom, panning, typed equations | ✅ Works. Axis numbers are read on the web only; on phones one grid square counts as one unit |
| Letters and digits on the pins | ✅ Works |
| Web layout (laptop, tablet, phone) | ✅ Works |
| Protocol (framing, CRC, chunking, retries, ACKs) | ✅ Done, with unit tests |
| Smart Cut-Out | 🟡 Works on the web; iOS and Android need a development build |
| Live camera, lock and capture (web) | 🟡 Works in Chrome; not yet tried on a real phone |
| Voice commands | 🟡 Works in Chrome by typing and with a stand-in recogniser; not yet tried with a real microphone, VoiceOver or TalkBack |
| Picture search (Openverse, Wikimedia Commons) | 🟡 Wikimedia works; Openverse untested live |
| Backup export and import | 🟡 Works on the web; phone share sheet untested |
| Send Pattern, Reset, Send Live | 🟡 Tested against a simulated board only |
| Bluetooth on phones, Web Bluetooth | 🟡 Written, never run against a board |
| On-device AI suggestions, Speak Results | 🟡 Written; tested with stand-ins only |
| Board firmware (ESP32 + PCA9685) | 🟡 Protocol code passes its tests; not yet flashed to an ESP32 |
| Letter recognition from a picture | ⬜ Not started |
| Pin position feedback | ⬜ Not possible: the hardware has no position sensors |

## 🛠️ Technology Stack

### Framework & Core

- **Expo** SDK 58
- **React Native** 0.88 with React 19.3 and the React Compiler
- **TypeScript** 6.0
- **Expo Router** (file-based routing, typed routes)
- **React Native Web** for the browser version

### Device & Hardware

- **react-native-ble-plx** (Bluetooth on phones) and **Web Bluetooth** (Chrome, Edge)
- **ESP32 + PCA9685** firmware in `firmware/` (Arduino, C++)

### Imaging & AI

- **ONNX Runtime Web** + **U²-Net** small model (browser subject cut-out)
- **Apple Vision** / **Google ML Kit** through a local Expo module (`modules/subject-segmentation`)
- **Tesseract.js** (reads graph axis numbers on the web)
- Hand-written image pipeline: lighting correction, GrabCut-style refinement,
  ORB feature tracking, shape fitting

### Voice & Accessibility

- **expo-speech-recognition** and the Web Speech API (speech to text)
- **expo-speech** (Speak Results)
- On-device intent model trained with `npm run train:voice`

### Storage

- **AsyncStorage** for saved patterns
- React Context for app state

## 🚀 Getting Started

### Prerequisites

- **Node.js 22.13 or newer** (24 recommended, see `.nvmrc`). Training the voice
  model needs 22.18 or newer.
- **npm**
- For phones: Xcode and CocoaPods (iOS), Android Studio (Android), or a free
  [Expo account](https://expo.dev/signup) to build in the cloud
- For web Bluetooth: Chrome or Edge

### Installation

```bash
# Clone the repository
git clone https://github.com/zyh-29/SLDP-PinVisual.git

# Navigate to project directory
cd SLDP-PinVisual

# Install dependencies (also copies ONNX Runtime and Tesseract.js into public/)
npm install

# Start the development server
npm start
```

Then press `w` for the browser, `i` for the iOS simulator, `a` for Android, or
scan the QR code with Expo Go.

### Environment Setup

No `.env` file or API keys are needed. The only build setting is optional:

| Variable | Used for |
|---|---|
| `WEB_BASE_URL` | Host the web app in a subfolder, e.g. `WEB_BASE_URL=/pinvisual npm run build:web` |

### Running on a Phone

Expo Go is the quickest way to try the app, but it **can't use Bluetooth**,
Smart Cut-Out on phones or on-device speech recognition. For those you need a
[development build](https://docs.expo.dev/develop/development-builds/introduction/):

```bash
# Build locally
npm run ios                  # needs Xcode
npm run android              # needs Android Studio

# Or build in the cloud with EAS
npx eas-cli@latest build --profile development --platform android   # or ios

# Then start the dev server for the installed build
npm run start:dev-client
```

The `ios/` and `android/` folders are generated from `app.json` and are not
checked in. Don't edit them by hand; change `app.json` or a config plugin.

### Using Your Own Expo Project

`app.json` points at the original author's Expo account. If you forked the repo
and want to use EAS:

1. Remove `"owner"` and `extra.eas.projectId` from `app.json`
2. Change `ios.bundleIdentifier` and `android.package` to your own
3. Run `npx eas-cli@latest init`

## 📜 Available Scripts

### Development

```bash
npm start                  # Start Expo (Expo Go mode)
npm run start:dev-client   # Start Expo for an installed development build
npm run web                # Web dev server at http://localhost:8081
npm run ios                # Build and run on iOS
npm run android            # Build and run on Android
npm run build:android:dev  # Android development APK with EAS
```

### Checks

```bash
npm run typecheck          # TypeScript
npm run lint               # ESLint
npm test                   # Jest unit tests
npm run test:firmware      # Firmware protocol tests (needs a C++17 compiler)
```

### Build & Tools

```bash
npm run build:web          # Static web build in dist/, with offline support
npm run train:voice        # Retrain the voice command model
```

## 🌐 Deploying the Web App

The web app is a static site, so it runs on any static host.

1. **Build:** `npm run build:web` (or `WEB_BASE_URL=/pinvisual npm run build:web`
   for a subfolder)
2. **Upload** everything in `dist/`, including the hidden `.nojekyll` file and
   the `_expo`, `ort`, `models` and `tesseract` folders
3. **Serve over https.** The camera, screen sharing and Bluetooth all need it.
   In an `<iframe>`, add `allow="camera"`

**Vercel:** import the repo and deploy. The included `vercel.json` builds for
the `/pinvisual` subfolder to match the live site. To host at the root instead,
set `buildCommand` to `npm run build:web` and remove `redirects` and `rewrites`.

**Offline:** the build adds a service worker that saves the app (about 3 MB),
then the cut-out model and graph-number reader in the background (about 26 MB).
It's off on the dev server.

## 🔌 Hardware

| What | Where |
|---|---|
| Parts, wiring, flashing, calibration | [firmware/README.md](firmware/README.md) |
| Bluetooth protocol and test vectors | [docs/PROTOCOL.md](docs/PROTOCOL.md) |
| Grid size, BLE UUIDs, timing | `src/config/hardware.ts` |
| Real phone and board test checklist | [docs/TESTING.md](docs/TESTING.md) |

You can start with **a single servo and no servo boards**: see "Testing with
one servo" in the firmware README, then use the app's **Pin Test** tab.

### How the App Talks to the Board

1. Editing never sends anything. The board only changes on **Send Pattern** or
   **Reset Physical Pins**
2. The app waits for an ACK with the matching command ID. A finished Bluetooth
   write alone doesn't count as success
3. No ACK → it retries up to three times, then offers Retry
4. Reset clears the preview only after the board acknowledges it
5. Only one command runs at a time

## 📁 Project Structure

```
./
├── src/
│   ├── app/              # Expo Router screens: Display, Image, Saved, Device, Pin Test
│   ├── config/           # hardware.ts: grid size, BLE UUIDs, protocol timing
│   ├── domain/           # Grid model, pin order, bit packing
│   ├── protocol/         # Message encoding, CRC-16, chunking, ACKs and retries
│   ├── device/           # Bluetooth drivers (phone + web), DeviceController, LiveSender
│   ├── imaging/          # Picture to pins pipeline (see docs/IMAGING.md)
│   ├── voice/            # Voice commands and on-device intent model (see docs/VOICE.md)
│   ├── storage/          # Saved patterns and backup files
│   ├── state/            # React providers and hooks
│   ├── ui/               # Theme, components, tab bar and sidebar
│   └── offline/          # Service worker registration (web)
├── modules/
│   └── subject-segmentation/  # Local Expo module: Apple Vision + ML Kit
├── firmware/             # ESP32 sketch and its protocol tests
├── scripts/              # Web build steps, engine copy, voice model training
├── public/               # Static web files, including the U²-Net model
└── docs/                 # Protocol, imaging, voice and testing docs
```

Files ending in `.web.ts` / `.web.tsx` are the browser versions of the file with
the same name. The tests use a simulated board (`src/device/__tests__/support`)
that can be made slow, lossy or faulty.

## 📚 Documentation

| Doc | What's in it |
|---|---|
| [docs/IMAGING.md](docs/IMAGING.md) | How a picture becomes pins: lighting, background, cropping, landscapes, graphs, live camera, screen sharing |
| [docs/VOICE.md](docs/VOICE.md) | Every voice command, how sentences are understood, retraining and measuring the model |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | The Bluetooth protocol between app and board |
| [docs/TESTING.md](docs/TESTING.md) | Manual checklists for real phones, real boards and blind testers |
| [firmware/README.md](firmware/README.md) | Building, wiring and flashing the board |

## ♿ Accessibility

- Nothing relies on colour alone: raised pins are solid, lowered pins are rings,
  and every status has an icon and text. Text meets WCAG AA contrast
- Grid cells are at least 40 pt; on narrow screens the grid scrolls instead of
  shrinking
- Screen readers announce each pin ("Row 2, column 3, raised"), summarise
  previews row by row, and announce send, reset and save results
- Voice commands sit before the 30 pins, so a screen reader reaches them first

## 📝 Development Guidelines

- ✅ Add packages with `npx expo install <package>` so versions match SDK 58
- ✅ Check the [SDK 58 docs](https://docs.expo.dev/versions/v58.0.0/); Expo APIs
  change between SDKs
- ✅ Run `npm run typecheck`, `npm run lint` and `npm test` before a pull request
- ✅ Change the protocol in three places together: `docs/PROTOCOL.md`, the app
  and the firmware, then run `npm run test:firmware`
- ❌ Don't edit `ios/` or `android/` by hand
- ❌ Don't send data off the device without a setting the user turns on

### Known Issues

- `react-native-ble-plx` 3.5.1 officially supports only up to Expo 51, and the
  native build hasn't been compiled on SDK 58 yet. If it fails, switch the import
  in `src/device/ble/BleDriver.ts` to `@sfourdrinier/react-native-ble-plx`
  (same API, supports Expo 57+)

## 🤝 Contributing

Contributions are welcome, especially testing on real hardware and with screen
reader users.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Bugs and ideas go in [GitHub Issues](https://github.com/zyh-29/SLDP-PinVisual/issues).

## 📄 License

PinVisual is released under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- Built with [Expo](https://expo.dev) and [React Native](https://reactnative.dev)
- Subject cut-out model: [U²-Net](https://github.com/xuebinqin/U-2-Net) (Apache-2.0)
- Browser inference: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT)
- Graph numbers: [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0)
- Picture search: [Openverse](https://openverse.org) and
  [Wikimedia Commons](https://commons.wikimedia.org); the app reads out each
  picture's credit and license
