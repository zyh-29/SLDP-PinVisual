/**
 * Central hardware + protocol configuration.
 *
 * Everything that depends on the physical build or the ESP32 firmware lives
 * here, so changing the layout or the BLE identifiers is a one-file edit.
 * See docs/PROTOCOL.md for how the firmware must interpret these values.
 */

/** Pin grid layout. PROVISIONAL: 5 rows x 6 columns = 30 pins. */
export const GRID = {
  rows: 5,
  cols: 6,
  /**
   * Horizontal pin pitch divided by vertical pin pitch. 1 = square spacing.
   * Used by image conversion so pictures are not stretched on the pins.
   */
  pinPitchRatio: 1,
} as const;

/** Upper bounds the protocol supports (1 byte each for rows / cols). */
export const GRID_LIMITS = { maxRows: 64, maxCols: 64 } as const;

/**
 * BLE identifiers.
 *
 * PLACEHOLDERS: these UUIDs were generated for this app and are NOT yet defined
 * by the ESP32 firmware. Replace them with the firmware's values, then set
 * `uuidsArePlaceholders` to false.
 */
export const BLE = {
  uuidsArePlaceholders: true,
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
