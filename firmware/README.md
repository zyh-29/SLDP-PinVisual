# PinVisual ESP32 firmware

The Arduino sketch receives 3 × 3 patterns over Bluetooth LE as `PinVisual-01`.
The current prototype has one continuous-rotation servo for the top-left pin.
The sketch reads that bit, pulses the servo for the configured turn time, then
stops the pulses before acknowledging the command. It assumes the pin starts
physically lowered.

## Wire and test one servo

Use one PCA9685 board at its default I²C address (`0x40`, all address jumpers
open). Put the servo on **channel 0**. On an original ESP32 DevKit, wire it as
follows. Other ESP32 boards may need different `PV_I2C_SDA` and `PV_I2C_SCL`
values in `pinvisual-esp32/config.h`.

| Connect | To |
|---|---|
| ESP32 GPIO21 | PCA9685 SDA |
| ESP32 GPIO22 | PCA9685 SCL |
| ESP32 3V3 | PCA9685 VCC (logic power) |
| Buck converter output + | PCA9685 V+ (at the servo's rated voltage) |
| Buck converter output − and ESP32 GND | PCA9685 GND |
| Servo signal, power, and ground | Channel 0 PWM, V+, and GND, respectively |

Keep OE low so the driver outputs are enabled. VCC powers the controller and
V+ powers the servo. Check V+ to GND at the driver board if the controller is
detected but the servo does not move.

1. In Arduino IDE, install the **esp32** board package by Espressif and the
   **Adafruit PWM Servo Driver Library** with its **Adafruit BusIO** dependency.
2. Open `pinvisual-esp32/pinvisual-esp32.ino`, select your ESP32 and serial port,
   and upload. Open Serial Monitor at **115200 baud** with **New Line** enabled.
3. Reset the ESP32. Look for `PCA9685 0x40 detected, servo on channel 0`. If it
   says `not detected`, check SDA, SCL, 3.3 V at VCC, shared GND, and the address pads.
4. With the mechanism starting down, send `u` to raise it and `d` to lower it.
   `s` shows the output status and assumed position. `t150` sets a 150 ms turn.
   If the pin moves in reverse, swap `kUpUs` and `kDownUs` in the sketch.
5. Once `u` and `d` work, connect to `PinVisual-01` in the app and try **Pin Test**.
   See [the BLE protocol](../docs/PROTOCOL.md) for message details.

The firmware can detect an I²C write failure and report a hardware fault to the
app. It has no sensor that verifies the servo has power or the pin has moved.

To test a direct signal connection instead, set `PV_SERVO_BOARDS` to `0` in
`config.h` and `PIN_TEST.usesPca9685` to `false` in `src/config/hardware.ts`. Connect
the servo signal to GPIO18 and use a separate servo supply with shared ground.

Run `npm run test:firmware` for the host-side protocol tests.
