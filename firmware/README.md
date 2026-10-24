# PinVisual board firmware (ESP32 + PCA9685)

The sketch in `pinvisual-esp32/` turns an ESP32 into the board the app connects to.
It advertises over Bluetooth Low Energy as `PinVisual-01`, takes pin patterns from the
app ([docs/PROTOCOL.md](../docs/PROTOCOL.md)), and moves one servo per pin through
PCA9685 servo boards.

| File | What it is |
|---|---|
| `pinvisual-esp32.ino` | Bluetooth, servo output, serial commands |
| `config.h` | Your settings: grid size, servo positions, wiring pins, power |
| `protocol.h`, `protocol.cpp` | The protocol (plain C++, tested on a computer) |
| `../test/protocol_test.cpp` | Its tests: `npm run test:firmware` |

**Status:** the protocol code passes its tests, and gives the same answers as the
app's own model of the board on 500 random sessions. It has not been flashed to
a real ESP32 yet, so the Bluetooth and servo parts are untested on hardware.

## What you need

- An ESP32 board (the original ESP32, such as an ESP32 DevKit V1 or WROOM-32). Other
  ESP32s with Bluetooth LE (S3, C3) work too, with different I2C pins (see below).
- PCA9685 16-channel servo boards: 2 for the 30 pins of the 5 × 6 grid (one
  board holds 16).
- 30 hobby servos (such as SG90 or MG90S).
- A 5–6 V power supply for the servos, strong enough for all of them.
  SG90s draw up to about 0.7 A each while moving. The firmware moves them a few at
  a time (`PV_MOVE_GROUP` in `config.h`), so 5 V at 4–5 A is a sensible start.
- Jumper wires, and a USB cable for the ESP32.

## Wiring

```
ESP32                PCA9685 #1 (0x40)        PCA9685 #2 (0x41)
3V3  ─────────────── VCC ──────────────────── VCC
GND  ─────────────── GND ──────────────────── GND ───── power supply −
GPIO21 (SDA) ─────── SDA ──────────────────── SDA
GPIO22 (SCL) ─────── SCL ──────────────────── SCL
                     V+ (screw terminal) ───── V+ ───── power supply + (5–6 V)
```

- **Addresses:** the first board keeps its address pads open (0x40). On the
  second, bridge the **A0** pad with solder (0x41). A third board, for grids
  over 32 pins, would bridge **A1** (0x42).
- **Power:** the servos must get their power from the supply through the
  PCA9685's **V+** screw terminal, never from the ESP32. The ESP32 and the
  supply must share **GND**, or the signals won't work.
- **Servo plugs:** brown/black wire to GND, red to V+, orange/yellow to PWM.
- **Pin order:** pin `i` (row-major, see [docs/PROTOCOL.md](../docs/PROTOCOL.md)
  section 2) is board `i / 16`, channel `i % 16`. For the 5 × 6 grid:

  | Pins | Row, column | Board | Channels |
  |---|---|---|---|
  | 0–5 | row 1 | 0x40 | 0–5 |
  | 6–11 | row 2 | 0x40 | 6–11 |
  | 12–15 | row 3, columns 1–4 | 0x40 | 12–15 |
  | 16–17 | row 3, columns 5–6 | 0x41 | 0–1 |
  | 18–23 | row 4 | 0x41 | 2–7 |
  | 24–29 | row 5 | 0x41 | 8–13 |

  Row 1 is the top row and column 1 the leftmost, looking at the display from
  the user's side.
- **Other ESP32 boards:** change `PV_I2C_SDA` and `PV_I2C_SCL` in `config.h`
  (for example, many ESP32-S3 boards use 8 and 9).

## Flashing

1. Install the [Arduino IDE](https://www.arduino.cc/en/software) (2.x).
2. **Boards Manager:** install **esp32** by Espressif Systems.
3. **Library Manager:** install **Adafruit PWM Servo Driver Library** by Adafruit
   (accept its dependency, Adafruit BusIO).
4. Open `firmware/pinvisual-esp32/pinvisual-esp32.ino`. All four files open as
   tabs.
5. **Tools → Board:** your ESP32 (for example "ESP32 Dev Module"). **Tools → Port:**
   its USB port.
6. Upload. Open **Tools → Serial Monitor** at 115200 baud. You should see:
   ```
   PinVisual board starting
   Advertising as PinVisual-01
   ```
   If it says a servo board is not answering, check the I2C wires, the boards'
   power (VCC) and the address pads.

## Calibrating the servos

Every servo model and every mechanism needs different positions. Before
connecting the app, use the serial monitor:

| Command | Does |
|---|---|
| `s` | Status: grid, whether every board answers, connected or not |
| `t 0` | Raises pin 0 for a second, then lowers it, and prints its row, column, board and channel. Checks the wiring and pin order |
| `p 0 1500` | Holds pin 0 at a 1500 µs pulse. Try values until it's exactly up, then down |
| `u`, `d` | Raise or lower every pin |

Put the pulse widths you found into `config.h`:

- `PV_LOWERED_US` and `PV_RAISED_US`: the down and up positions for all pins.
- `PV_PIN_TRIM_US`: small corrections for single pins that sit higher or lower
  than the rest (30 values, row by row).

Then upload again.

## Connecting the app

1. Power the board. It advertises as `PinVisual-01`.
2. In the app, open **Device** and scan:
   - **Web app in Chrome or Edge** (Android, Windows, macOS, Linux): the browser
     shows its own device list; choose `PinVisual-01`. The page must be opened
     over `https://` or on `localhost`.
   - **Installed phone app** (development build): the board is listed first.
   - **iPhone Safari** has no Web Bluetooth, so use the installed app on iPhones.
3. Once connected, the Device tab shows the negotiated MTU. Send a pattern; the
   serial monitor shows nothing for normal sends, but `s` counts applied
   patterns.

Disconnecting restarts advertising, so the app can connect again at once.
With `PV_LOWER_ON_DISCONNECT 1` the pins also go down when the app leaves.

## If something doesn't work

| Symptom | Likely cause |
|---|---|
| The app doesn't find the board | Not powered or still starting; check the serial monitor says "Advertising". On Android, allow "Nearby devices" (or location on Android 11 and older). |
| "This device does not expose the PinVisual service" | The UUIDs in `config.h` and `src/config/hardware.ts` differ. `npm test` checks they match. |
| Every send fails with a grid mismatch | `PV_ROWS`/`PV_COLS` differ from the app's `GRID`. |
| Every send fails with "Hardware fault" | A PCA9685 isn't answering: wiring, VCC, or address pads. `s` shows it. |
| The ESP32 resets when pins move | The servos are drawing power through the ESP32, or the supply is too weak. Power them from V+ only; lower `PV_MOVE_GROUP` or raise `PV_MOVE_PAUSE_MS`. |
| Servos jitter or buzz at rest | The supply sags, or the GND isn't shared. Try a slightly different pulse width. |
| Pins are mirrored or in the wrong place | Wiring order: use `t <pin>` to find which servo each pin moves. |

## Changing the grid

Change `PV_ROWS`/`PV_COLS` here and `GRID` in `src/config/hardware.ts` together.
Each PCA9685 holds 16 pins. Add boards with the next addresses (0x42, 0x43, …),
and add a value per pin to `PV_PIN_TRIM_US`.
