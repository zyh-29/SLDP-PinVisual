// PinVisual board settings. Change these to match your build.
//
// The grid size and the Bluetooth IDs must match the app (src/config/hardware.ts).
// The app's tests check that they do (src/config/__tests__/firmwareConfig.test.ts).
#pragma once

#include <stdint.h>

// ---- Grid (must match GRID in src/config/hardware.ts) ----
#define PV_ROWS 5
#define PV_COLS 6

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
// The PCA9685's own clock, roughly 25-27 MHz depending on the chip. Measure it for exact pulses (see README).
#define PV_OSCILLATOR_HZ 27000000

// ---- Pin positions (pulse width, microseconds) ----
// Where a servo holds a pin down and up. Typical SG90 range is 500-2500 us; find yours by testing
// one pin from the serial monitor (see README, "Calibrating").
#define PV_LOWERED_US 1000
#define PV_RAISED_US 1600
// Per-pin corrections, in microseconds, added to both positions (row-major, PV_ROWS * PV_COLS values).
// For servos mounted a little off. Leave at 0 until a pin sits visibly higher or lower than the others.
static const int16_t PV_PIN_TRIM_US[PV_ROWS * PV_COLS] = {0};

// ---- Power ----
// Moving every servo at once can draw more current than the supply gives, and the ESP32 resets.
// Pins are moved in groups of this many, with a pause between groups.
#define PV_MOVE_GROUP 6
#define PV_MOVE_PAUSE_MS 25
// On power-up, lower every pin (a known starting state).
#define PV_LOWER_ON_START 1
// When the app disconnects: 1 = lower every pin, 0 = leave the last pattern up.
#define PV_LOWER_ON_DISCONNECT 0
