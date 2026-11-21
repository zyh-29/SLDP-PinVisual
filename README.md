<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/images/logo-dark.svg">
    <img src="./assets/images/logo.svg" alt="PinVisual" width="360"/>
  </picture>
</p>

<p align="center">
  <a href="https://github.com/zyh-29/SLDP-PinVisual/actions/workflows/ci.yml"><img src="https://github.com/zyh-29/SLDP-PinVisual/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="https://zongyaohuang.com/pinvisual"><img src="https://img.shields.io/badge/try%20it-web-7C3AED.svg" alt="Try it on the web"/></a>
</p>

# PinVisual 📍

PinVisual is a React Native / Expo app for a **tactile pin display**, built so
blind and low-vision people can feel pictures, shapes, letters and graphs. You
draw a pattern, type a graph's equation, or say what you want, and it works out which
pins should be up and which should be down. The pattern goes over Bluetooth Low
Energy to an ESP32, which moves one servo per pin through PCA9685 servo boards.

Everything runs on the device. There are no accounts and no backend. The only
thing that can go online is speech recognition, and only if you turn on Online
Speech Recognition.

> 🌐 **The app is accessible at [zongyaohuang.com/pinvisual](https://zongyaohuang.com/pinvisual)**,
> with nothing to install. It works in any modern browser and can be added to a
> phone's home screen. Use Chrome or Edge to connect to a board over Bluetooth.

## 📱 App Information

- **Version:** 1.0.0
- **Platforms:** iOS, Android and web
- **Grid:** 3 × 3 (9 pins), set in `src/config/hardware.ts` (a 5 × 6 layout is kept there, on hold)
- **Bundle ID (iOS) / Package (Android):** `com.sldp.pinvisual`
- **Web app:** [zongyaohuang.com/pinvisual](https://zongyaohuang.com/pinvisual)

## ✨ Features

### Core Features

- ✏️ **Draw on the grid** and send the pattern to the board
- 📈 **Graphs and equations** - type or say `y = x^2 - 3`; pick the range, zoom,
  pan and hear a description ([how it works](docs/IMAGING.md))
- 🎙️ **Voice commands** - spoken or typed: "show a circle", "letter B", "graph y
  equals x squared", "send" ([full list](docs/VOICE.md))
- 🔤 **Letters and digits** - A–Z and 0–9 drawn for the pins
- ⠃ **Braille** - type a word or phrase and play it on the pins like a video,
  one braille cell after another (uncontracted UEB), with pause, step, speed and
  loop; a repeated cell drops the pins briefly so "ll" reads as two
- 💾 **Saved patterns** with backup export and import

### Technical Features

- 🔒 **On-device everything** - graph drawing and voice understanding run
  locally
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
against a simulated board but **not yet against real hardware**. The checklist for
real-device testing is in [docs/TESTING.md](docs/TESTING.md).

| Feature | Status |
|---|---|
| Drawing, Clear Grid, saving and loading | ✅ Works |
| Graph Range, zoom, panning, typed equations | ✅ Works |
| Letters and digits on the pins | ✅ Works |
| Braille player | 🟡 Works against a simulated board; not yet read on the real pins |
| Web layout (laptop, tablet, phone) | ✅ Works |
| Protocol (framing, CRC, chunking, retries, ACKs) | ✅ Done, with unit tests |
| Voice commands | 🟡 Works in Chrome by typing and with a stand-in recogniser; not yet tried with a real microphone, VoiceOver or TalkBack |
| Backup export and import | 🟡 Works on the web; phone share sheet untested |
| Send Pattern, Reset | 🟡 Tested against a simulated board only |
| Bluetooth on phones, Web Bluetooth | 🟡 Written, never run against a board |
| On-device AI suggestions, Speak Results | 🟡 Written; tested with stand-ins only |
| Board firmware (ESP32 + PCA9685) | 🟡 Protocol code passes its tests; not yet flashed to an ESP32 |
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

### Graphs

- Hand-written equation parser and plotter, and a graph-to-pins pipeline
  (smart crop, background removal, one-pin line tracing, shape fitting)

### Voice & Accessibility

- **expo-speech-recognition** and the Web Speech API (speech to text)
- **expo-speech** (Speak Results)
- On-device intent model trained with `npm run train:voice`

### Storage

- **AsyncStorage** for saved patterns
- React Context for app state

## 💻 Running It Locally

Requires Node.js 22.13 or newer.

```bash
git clone https://github.com/zyh-29/SLDP-PinVisual.git
cd SLDP-PinVisual
npm install
npm run web        # opens at http://localhost:8081
```

Bluetooth on phones needs a [development build](https://docs.expo.dev/develop/development-builds/introduction/)
(`npm run ios` / `npm run android`); Expo Go runs everything else.

## 🔌 Hardware

| What | Where |
|---|---|
| Parts, wiring, flashing, calibration | [firmware/README.md](firmware/README.md) |
| Bluetooth protocol and test vectors | [docs/PROTOCOL.md](docs/PROTOCOL.md) |
| Grid size, BLE UUIDs, timing | `src/config/hardware.ts` |
| Real phone and board test checklist | [docs/TESTING.md](docs/TESTING.md) |

Start with one continuous-rotation servo on PCA9685 channel 0. Follow the
firmware wiring and serial test, then use the app's **Pin Test** tab.

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
│   ├── app/              # Expo Router screens: Display, Image, Braille, Saved, Device, Pin Test
│   ├── config/           # hardware.ts: grid size, BLE UUIDs, protocol timing
│   ├── domain/           # Grid model, pin order, bit packing
│   ├── protocol/         # Message encoding, CRC-16, chunking, ACKs and retries
│   ├── device/           # Bluetooth drivers (phone + web), DeviceController
│   ├── imaging/          # Graph to pins pipeline (see docs/IMAGING.md)
│   ├── voice/            # Voice commands and on-device intent model (see docs/VOICE.md)
│   ├── storage/          # Saved patterns and backup files
│   ├── state/            # React providers and hooks
│   ├── ui/               # Theme, components, tab bar and sidebar
│   └── offline/          # Service worker registration (web)
├── firmware/             # ESP32 sketch and its protocol tests
├── scripts/              # Web build steps, voice model training
├── public/               # Static web files
└── docs/                 # Protocol, imaging, voice and testing docs
```

Files ending in `.web.ts` / `.web.tsx` are the browser versions of the file with
the same name. The tests use a simulated board (`src/device/__tests__/support`)
that can be made slow, lossy or faulty.

## 📚 Documentation

| Doc | What's in it |
|---|---|
| [docs/IMAGING.md](docs/IMAGING.md) | How a graph becomes pins |
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
- Voice commands sit before the pins, so a screen reader reaches them first

## 🙏 Acknowledgments

- Built with [Expo](https://expo.dev) and [React Native](https://reactnative.dev)
