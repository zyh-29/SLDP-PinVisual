import { GRID } from '@/config/hardware';
import { DeviceController } from '@/device/DeviceController';
import { MOCK_DEVICE_ID, MOCK_DEVICE_NAME, MockDriver } from '@/device/__tests__/support/MockDriver';
import { countRaised, getPin } from '../pattern';
import { PIN_COUNT, pinInfo, pinRaisedIn, singlePin, TEST_PIN } from '../pinTest';

describe('Pin Test: one pin at a time', () => {
  it('raises only the chosen pin, numbered across each row from the top left', () => {
    const first = singlePin(1, true);
    expect(countRaised(first)).toBe(1);
    expect(getPin(first, 0, 0)).toBe(1);
    const eighth = singlePin(8, true);
    expect(getPin(eighth, 1, 1)).toBe(1);
    expect(getPin(singlePin(PIN_COUNT, true), GRID.rows - 1, GRID.cols - 1)).toBe(1);
  });

  it('down lowers every pin', () => {
    expect(countRaised(singlePin(8, false))).toBe(0);
  });

  it('where a pin is, and its servo (16 channels a board, from I²C 0x40)', () => {
    expect(pinInfo(2)).toEqual({ row: 1, col: 2, gpio: null, servo: { board: 0, i2cAddress: 0x40, channel: 1 } });
    expect(pinInfo(8)).toMatchObject({ row: 2, col: 2 });
    expect(pinInfo(17).servo).toEqual({ board: 1, i2cAddress: 0x41, channel: 0 });
  });

  it('reads whether a pin is up from what the board confirmed', () => {
    expect(pinRaisedIn(null, 1)).toBe(false);
    expect(pinRaisedIn(singlePin(5, true), 5)).toBe(true);
    expect(pinRaisedIn(singlePin(5, true), 6)).toBe(false);
  });

  it('the tab tests the top-left pin, whose servo is on the ESP32’s D18', () => {
    expect(pinInfo(TEST_PIN)).toMatchObject({ row: 1, col: 1, gpio: 18 });
  });

  it('reaches the board as an ordinary pattern: that one pin up, then all down', async () => {
    const mock = new MockDriver();
    const controller = new DeviceController(mock);
    await controller.connect({ id: MOCK_DEVICE_ID, name: MOCK_DEVICE_NAME });
    expect((await controller.sendPattern(singlePin(8, true))).ok).toBe(true);
    expect(mock.firmware?.simulatedPins).toEqual(singlePin(8, true));
    expect(pinRaisedIn(controller.getSnapshot().lastAcknowledgedPattern, 8)).toBe(true);
    expect((await controller.sendPattern(singlePin(8, false))).ok).toBe(true);
    expect(countRaised(mock.firmware!.simulatedPins!)).toBe(0);
  });
});
