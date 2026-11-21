// PinVisual board settings. Change these to match your build.
//
// The grid size and the Bluetooth IDs must match the app (src/config/hardware.ts).
// The app's tests check that they do (src/config/__tests__/firmwareConfig.test.ts).
#pragma once

#include <stdint.h>

// ---- Grid (must match GRID in src/config/hardware.ts) ----
// The 3 x 3 board uses one driver. The 5 x 6 board needs support for multiple drivers.
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
// The PCA9685 at 0x40 drives pins in row order on channels 0 through 8.
#define PV_FIRST_I2C_ADDRESS 0x40
#define PV_CHANNELS_PER_BOARD 16
// Use D32 for SDA and D22 for SCL on this prototype.
#define PV_I2C_SDA 32
#define PV_I2C_SCL 22
// Hobby servos expect a pulse every 20 ms (50 Hz).
#define PV_SERVO_HZ 50
// Nominal PCA9685 oscillator frequency. Adjust if measured pulses differ from the requested widths.
#define PV_OSCILLATOR_HZ 25000000

// ---- Continuous-rotation servos ----
// Serial u/d defaults to this grid pin (0 = top-left). Direct GPIO mode also uses it.
#define PV_TEST_PIN 0
// Time the servo spins to move the pin between its lowered and raised positions.
#define PV_SERVO_TURN_MS 350
#define PV_DIRECT_GPIO 18
// 1 = drive the full grid on the PCA9685. 0 = drive the test pin through GPIO18.
#define PV_SERVO_BOARDS 1
