import { createEmptyPattern, togglePin } from '@/domain/pattern';
import { DeviceController } from '../DeviceController';
import type { DeviceDriver } from '../types';
import { MOCK_DEVICE_ID, MOCK_DEVICE_NAME, MockDriver } from './support/MockDriver';

/** Bluetooth where it can't run (e.g. Expo Go). */
const unavailableBle: DeviceDriver = {
  availability: async () => 'Bluetooth needs the development build.',
  ensureReady: async () => null,
  scan: () => ({ stop() {} }),
  connect: async () => {
    throw new Error('unavailable');
  },
};

/** A controller talking to a simulated board (test double for a Bluetooth link). */
function setup() {
  const mock = new MockDriver();
  const controller = new DeviceController(mock);
  return { mock, controller };
}

const pattern = togglePin(createEmptyPattern(5, 8), 1, 1);

describe('DeviceController', () => {
  it('refuses to send or reset without a connection', async () => {
    const { controller } = setup();
    const res = await controller.reset();
    expect(res).toMatchObject({ ok: false });
    expect(controller.getSnapshot().command).toMatchObject({ status: 'failed', kind: 'reset' });
  });

  it('connects and reports acknowledged sends', async () => {
    const { controller, mock } = setup();
    await controller.connect({ id: MOCK_DEVICE_ID, name: MOCK_DEVICE_NAME });
    expect(controller.getSnapshot().connection).toMatchObject({ status: 'connected', deviceName: MOCK_DEVICE_NAME });

    const res = await controller.sendPattern(pattern);
    expect(res.ok).toBe(true);
    expect(controller.getSnapshot().command).toMatchObject({ status: 'succeeded', kind: 'pattern' });
    expect(controller.getSnapshot().lastAcknowledgedPattern).toEqual(pattern);
    expect(mock.firmware?.simulatedPins).toEqual(pattern);

    expect((await controller.reset()).ok).toBe(true);
    expect(mock.firmware?.simulatedPins).toEqual(createEmptyPattern(5, 8));
  });

  it('prevents a reset while a send is in flight', async () => {
    const { controller } = setup();
    await controller.connect({ id: MOCK_DEVICE_ID, name: MOCK_DEVICE_NAME });
    const send = controller.sendPattern(pattern);
    expect(controller.isBusy).toBe(true);
    expect(await controller.reset()).toMatchObject({ ok: false, failure: 'busy' });
    expect((await send).ok).toBe(true);
  });

  it('surfaces why Bluetooth is unavailable instead of pretending to scan', async () => {
    const controller = new DeviceController(unavailableBle);
    await controller.startScan();
    expect(controller.getSnapshot().scanError).toMatch(/development build/);
    expect(controller.getSnapshot().scanning).toBe(false);
  });
});
