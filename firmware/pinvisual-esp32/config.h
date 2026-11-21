// PinVisual board settings. Change these to match your build.
//
// The grid size and the Bluetooth IDs must match the app (src/config/hardware.ts).
// The app's tests check that they do (src/config/__tests__/firmwareConfig.test.ts).
#pragma once

#include <stdint.h>

// ---- Grid (must match GRID in src/config/hardware.ts) ----
// The 3 x 3 board is in use. The 5 x 6 board is on hold: set 5 and 6 here and GRID = GRID_5X6 in the app to go back.
#define PV_ROWS 3
#define PV_COLS 3

// ---- Bluetooth (must match BLE in src/config/hardware.ts) ----
// The app lists devices whose name starts with "PinVisual" first.
#define PV_DEVICE_NAME "PinVisual-01"
#define PV_SERVICE_UUID "7a1e0001-3c4b-4f2a-9b8e-5d6c7b8a9f01"
#define PV_COMMAND_UUID "7a1e0002-3c4b-4f2a-9b8e-5d6c7b8a9f01"
#define PV_ACK_UUID "7a1e0003-3c4b-4f2a-9b8e-5d6c7b8a9f01"
// Largest MTU accepted (the app asks for 185 on Android; iOS picks its own).
#define PV_MTU 185

// ---- Servo boards (PCA9685) ----
// Pin i goes to board i / 16, channel i % 16. Board b is at I2C address PV_FIRST_I2C_ADDRESS + b
// (set with the A0-A5 solder jumpers: the first board has none bridged, the second has A0 bridged, ...).
#define PV_FIRST_I2C_ADDRESS 0x40
#define PV_CHANNELS_PER_BOARD 16
// I2C wires. 21 and 22 are the usual SDA and SCL on an ESP32 DevKit; other boards (ESP32-S3, C3) differ.
#define PV_I2C_SDA 21
#define PV_I2C_SCL 22
// Hobby servos expect a pulse every 20 ms (50 Hz).
#define PV_SERVO_HZ 50
// Nominal PCA9685 oscillator frequency. Adjust if measured pulses differ from the requested widths.
#define PV_OSCILLATOR_HZ 25000000

// ---- Single continuous-rotation servo prototype ----
// PV_TEST_PIN is the grid pin controlled by the sketch (0 = top-left).
// Match PIN_TEST in src/config/hardware.ts so the app shows the correct wiring.
#define PV_TEST_PIN 0
#define PV_DIRECT_GPIO 18
// 1 = drive the test servo through the PCA9685. 0 = drive it through GPIO18.
#define PV_SERVO_BOARDS 1
