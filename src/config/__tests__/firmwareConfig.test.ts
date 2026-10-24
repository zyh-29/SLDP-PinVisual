/**
 * The board firmware (firmware/pinvisual-esp32/config.h) must use the same grid and Bluetooth IDs as the app, or
 * the app can't find the board (IDs) or every pattern is refused (grid). This fails when one is changed alone.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { BLE, GRID, SERVO_LAYOUT } from '../hardware';

const config = readFileSync(join(__dirname, '../../../firmware/pinvisual-esp32/config.h'), 'utf8');
const define = (name: string) => {
  const m = config.match(new RegExp(`^#define ${name}\\s+(.+)$`, 'm'));
  if (!m) throw new Error(`${name} is missing from config.h`);
  return m[1].trim().replace(/^"(.*)"$/, '$1');
};

describe('firmware config matches the app', () => {
  it('grid size', () => {
    expect(Number(define('PV_ROWS'))).toBe(GRID.rows);
    expect(Number(define('PV_COLS'))).toBe(GRID.cols);
  });

  it('Bluetooth IDs and name', () => {
    expect(define('PV_SERVICE_UUID').toLowerCase()).toBe(BLE.serviceUUID.toLowerCase());
    expect(define('PV_COMMAND_UUID').toLowerCase()).toBe(BLE.commandCharacteristicUUID.toLowerCase());
    expect(define('PV_ACK_UUID').toLowerCase()).toBe(BLE.ackCharacteristicUUID.toLowerCase());
    expect(define('PV_DEVICE_NAME').startsWith(BLE.deviceNamePrefix)).toBe(true);
    expect(Number(define('PV_MTU'))).toBeGreaterThanOrEqual(BLE.requestedMtu);
  });

  it('servo wiring', () => {
    expect(Number(define('PV_CHANNELS_PER_BOARD'))).toBe(SERVO_LAYOUT.channelsPerBoard);
    expect(Number(define('PV_FIRST_I2C_ADDRESS'))).toBe(SERVO_LAYOUT.firstI2cAddress);
  });
});
