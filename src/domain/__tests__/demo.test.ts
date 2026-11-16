import { GRID } from '@/config/hardware';
import { DeviceController } from '@/device/DeviceController';
import { MOCK_DEVICE_ID, MOCK_DEVICE_NAME, MockDriver } from '@/device/__tests__/support/MockDriver';
import { countRaised, togglePin } from '../pattern';
import { boardShowsDemo, emptyDemo } from '../demo';

describe('Demo: the 3 × 3 board', () => {
  it('starts with every pin lowered', () => {
    const d = emptyDemo();
    expect([d.rows, d.cols]).toEqual([GRID.rows, GRID.cols]);
    expect(countRaised(d)).toBe(0);
  });

  it('tells whether the board confirmed the demo', () => {
    const d = togglePin(emptyDemo(), 1, 1);
    expect(boardShowsDemo(null, d)).toBe(false);
    expect(boardShowsDemo(d, d)).toBe(true);
    expect(boardShowsDemo(emptyDemo(), d)).toBe(false);
  });

  it('reaches the board as a 3 × 3 pattern', async () => {
    const controller = new DeviceController(new MockDriver());
    await controller.connect({ id: MOCK_DEVICE_ID, name: MOCK_DEVICE_NAME });
    const d = togglePin(emptyDemo(), 0, 2);
    expect((await controller.sendPattern(d)).ok).toBe(true);
    expect(boardShowsDemo(controller.getSnapshot().lastAcknowledgedPattern, d)).toBe(true);
  });
});
