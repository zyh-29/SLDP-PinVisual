# PinVisual ESP32 firmware

The Arduino sketch receives 3 × 3 patterns over Bluetooth LE as `PinVisual-01`.
It drives nine continuous-rotation servos. Each pattern or reset moves changed
pins one column at a time, from left to right. Up to two servos in the same
column move together, with a 100 ms pause between groups. The board
acknowledges the command after all the pulses stop. Start with all pins
physically lowered when powering on or resetting the ESP32.

## Wire and test the 3 × 3 board

Use one PCA9685 board at its default I²C address (`0x40`, all address jumpers
open). Connect the servos to channels **0–8** as viewed from the front of the
board.

| Pin row | Left channel | Center channel | Right channel |
|---|---:|---:|---:|
| Top | 0 | 1 | 2 |
| Middle | 3 | 4 | 5 |
| Bottom | 6 | 7 | 8 |

On an original ESP32 DevKit, wire the connections below. Other ESP32 boards may
need different `PV_I2C_SDA` and `PV_I2C_SCL` values in `config.h`.

| Connect | To |
|---|---|
| ESP32 D32 (GPIO32) | PCA9685 SDA |
| ESP32 D22 (GPIO22) | PCA9685 SCL |
| ESP32 3V3 | PCA9685 VCC (logic power) |
| Buck converter output + | PCA9685 V+ (at the servo's rated voltage) |
| Buck converter output − and ESP32 GND | PCA9685 GND |
| Each servo's signal, power, and ground | Its channel's PWM, V+, and GND, respectively |

Keep OE low so the driver outputs are enabled. VCC powers the controller and
V+ powers the servo. Check V+ to GND at the driver board if the controller is
detected but the servo does not move.

1. In Arduino IDE, install the **esp32** board package by Espressif and the
   **Adafruit PWM Servo Driver Library** with its **Adafruit BusIO** dependency.
2. Open `pinvisual-esp32/pinvisual-esp32.ino`, select your ESP32 and serial port,
   and upload. Open Serial Monitor at **115200 baud** with **New Line** enabled.
3. Reset the ESP32. Look for `PCA9685 0x40 detected, servo channels 0-8`. If it
   says `not detected`, check SDA, SCL, 3.3 V at VCC, shared GND, and the address pads.
4. Send `u1` and `d1` to raise and lower the top-left pin, then repeat for pins
   2 through 9. Serial pin numbers start at 1, so `u9` raises the bottom-right pin
   on channel 8. Bare `u` and `d` default to pin 1.
5. Send `s` to see the output status, assumed positions, and turn time. The
   default is 350 ms per move. Each pin reverses for the same duration
   it used to rise, even if the turn time has changed. For example, `t325`
   sets a 325 ms turn for subsequent raises until restart. The full-grid
   mode accepts 20–350 ms. Set `PV_SERVO_TURN_MS` in `config.h` to save
   the calibrated default.
   If the pin moves in reverse, swap `kUpUs` and `kDownUs` in the sketch.
6. Connect to `PinVisual-01` in the app. In **Display**, select multiple pins
   and tap **Send Pattern**, then use **Reset Physical Pins** to lower them.
   **Pin Test** exercises the top-left pin. See [the BLE protocol](../docs/PROTOCOL.md)
   for message details.

The firmware can detect an I²C write failure and report a hardware fault to the
app. It has no sensor that verifies the servo has power or the pin has moved.

To test a direct signal connection instead, set `PV_SERVO_BOARDS` to `0` in
`config.h` and `PIN_TEST.usesPca9685` to `false` in `src/config/hardware.ts`. Connect
the servo signal to GPIO18 and use a separate servo supply with shared ground.

Run `npm run test:firmware` for the host-side protocol tests.
