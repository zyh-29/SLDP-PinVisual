import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { PIN_SETTLE_MS } from '@/config/hardware';
import { DeviceController } from '@/device/DeviceController';
import { MOCK_DEVICE_ID, MOCK_DEVICE_NAME, MockDriver } from '@/device/__tests__/support/MockDriver';
import { cellsToString } from '@/domain/pattern';
import { DeviceProvider } from '@/state/DeviceProvider';
import BrailleScreen from '@/app/braille/index';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() }, usePathname: () => '/braille' }));

const show = () =>
  render(
    <DeviceProvider>
      <BrailleScreen />
    </DeviceProvider>,
  );

describe('Braille tab', () => {
  it('waits for text', async () => {
    await show();
    expect(screen.getByText('No text yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next cell' })).toBeDisabled();
  });

  it('shows typed text one cell at a time', async () => {
    await show();
    await fireEvent.changeText(screen.getByLabelText('Text to show in braille'), 'Hi');
    expect(screen.getByText('capital sign')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Braille cell: capital sign, dot 6')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Next cell' }));
    expect(screen.getByLabelText('Braille cell: h, dots 1 2 5')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Cell 3: i, dots 2 4' }));
    expect(screen.getByText('3 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next cell' })).toBeDisabled();
  });

  it('plays a phrase like a video, one cell after another, and stops at the end', async () => {
    jest.useFakeTimers();
    try {
      await show();
      await fireEvent.changeText(screen.getByLabelText('Text to show in braille'), 'go up');
      expect(screen.getByText('1 of 5')).toBeTruthy();
      expect(screen.getByText(/in “go”/)).toBeTruthy();

      await fireEvent.press(screen.getByRole('button', { name: 'Play' }));
      expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
      await act(() => jest.advanceTimersByTime(1000));
      expect(screen.getByText('2 of 5')).toBeTruthy();
      await act(() => jest.advanceTimersByTime(1000));
      expect(screen.getByText(/between words/)).toBeTruthy();
      await act(() => jest.advanceTimersByTime(1000));
      expect(screen.getByText(/in “up”/)).toBeTruthy();
      // Each cell's timer starts once it's shown: one step at a time.
      for (let i = 0; i < 3; i++) await act(() => jest.advanceTimersByTime(1000));
      expect(screen.getByText('5 of 5')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('with a board: the next cell is only sent once the servos have stopped and the cell has had its full time', async () => {
    // The simulated board acknowledges 150 ms after a pattern arrives, as the real one does once its servo's turn
    // (TURN_MS) has finished.
    const mock = new MockDriver();
    const board = new DeviceController(mock);
    await board.connect({ id: MOCK_DEVICE_ID, name: MOCK_DEVICE_NAME });
    jest.useFakeTimers();
    try {
      const turnMs = mock.firmware!.ackDelayMs;
      const received: { at: number; pins: string }[] = [];
      mock.onFirmwareChange(() => {
        const pins = cellsToString(mock.firmware!.simulatedPins);
        if (received[received.length - 1]?.pins !== pins) received.push({ at: Date.now(), pins });
      });
      await render(
        <DeviceProvider board={board}>
          <BrailleScreen />
        </DeviceProvider>,
      );
      // "ab": a (dot 1), then b (dots 1 2).
      await fireEvent.changeText(screen.getByLabelText('Text to show in braille'), 'ab');
      await fireEvent.press(screen.getByRole('radio', { name: '0.5 s' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Play' }));
      for (let i = 0; i < 60; i++) await act(() => jest.advanceTimersByTimeAsync(50));

      const cells = received.filter((r) => r.pins !== '000000000');
      expect(cells.map((r) => r.pins)).toEqual(['100000000', '100100000']);
      // The right column never comes up.
      for (const r of received) expect([r.pins[2], r.pins[5], r.pins[8]]).toEqual(['0', '0', '0']);
      // Shortest speed: the servo's turn, then the settle time, then the whole half second on the pins.
      expect(cells[1].at - cells[0].at).toBeGreaterThanOrEqual(turnMs + PIN_SETTLE_MS + 500);
    } finally {
      jest.useRealTimers();
      await board.disconnect();
    }
  });

  it('says what it left out', async () => {
    await show();
    await fireEvent.changeText(screen.getByLabelText('Text to show in braille'), 'a€');
    expect(screen.getByText(/No braille here for “€”/)).toBeTruthy();
  });
});
