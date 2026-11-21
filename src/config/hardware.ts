/**
 * Central hardware + protocol configuration.
 *
 * Everything that depends on the physical build or the ESP32 firmware lives
 * here, so changing the layout or the BLE identifiers is a one-file edit.
 * See docs/PROTOCOL.md for how the firmware must interpret these values.
 */

/**
 * The 5 rows x 6 columns (30 pin) layout. The 3 x 3 board is in use. Returning to 5 x 6 requires ESP32 firmware
 * that can drive multiple PCA9685 boards, as well as a matching grid size in the app and firmware.
 */
export const GRID_5X6 = { rows: 5, cols: 6, pinPitchRatio: 1 } as const;

/** The 3 x 3 (9 pin) board in use now. */
export const GRID_3X3 = { rows: 3, cols: 3, pinPitchRatio: 1 } as const;

/**
 * Pin grid layout every tab uses. `pinPitchRatio` is horizontal pin pitch divided by vertical pin pitch (1 = square
 * spacing); image conversion uses it so pictures are not stretched on the pins.
 */
export const GRID: { readonly rows: number; readonly cols: number; readonly pinPitchRatio: number } = GRID_3X3;

/** Upper bounds the protocol supports (1 byte each for rows / cols). */
export const GRID_LIMITS = { maxRows: 64, maxCols: 64 } as const;

/**
 * BLE identifiers. The board firmware (firmware/pinvisual-esp32/config.h) uses the same ones; a test checks that
 * they match (src/config/__tests__/firmwareConfig.test.ts). Change both together.
 */
export const BLE = {
  /** True while no firmware defines these IDs (the Device tab then warns). */
  uuidsArePlaceholders: false,
  /** Advertised name prefix used to highlight likely boards during a scan. */
  deviceNamePrefix: 'PinVisual',
  /** PLACEHOLDER primary service UUID. */
  serviceUUID: '7a1e0001-3c4b-4f2a-9b8e-5d6c7b8a9f01',
  /** PLACEHOLDER: app -> board command characteristic (Write With Response). */
  commandCharacteristicUUID: '7a1e0002-3c4b-4f2a-9b8e-5d6c7b8a9f01',
  /** PLACEHOLDER: board -> app acknowledgement characteristic (Notify). */
  ackCharacteristicUUID: '7a1e0003-3c4b-4f2a-9b8e-5d6c7b8a9f01',
  /** MTU the app asks for on Android. iOS negotiates on its own. */
  requestedMtu: 185,
  scanTimeoutMs: 15_000,
  connectTimeoutMs: 10_000,
} as const;

/**
 * How long after the board's acknowledgement a pin counts as still. The board acknowledges once a servo has
 * finished its move (see docs/PROTOCOL.md); a continuous-rotation servo still coasts a little after its pulses
 * stop. Anything timed on the pins (a braille cell's time) starts after this.
 */
export const PIN_SETTLE_MS = 100;

/** Application-level protocol timing. */
export const PROTOCOL = {
  version: 1,
  /** How long to wait for an acknowledgement after the last chunk is written. */
  ackTimeoutMs: 3_000,
  /** Total attempts per command (first try + retries). */
  maxAttempts: 3,
  /** Pause between attempts. */
  retryDelayMs: 400,
} as const;

/**
 * Suggested servo wiring (documentation only - the app never addresses
 * servos directly). Pin index i maps to PCA9685 board floor(i / 16),
 * channel i % 16, I2C address 0x40 + board.
 */
export const SERVO_LAYOUT = {
  channelsPerBoard: 16,
  firstI2cAddress: 0x40,
} as const;

/** The single servo exercised by Pin Test. Match the test pin and output settings in firmware config.h. */
export const PIN_TEST = {
  /** Grid pin index (0 = top-left). */
  pinIndex: 0,
  usesPca9685: true,
  /** ESP32 GPIO used for a direct connection when the PCA9685 is disabled. */
  directGpio: 18,
} as const;
