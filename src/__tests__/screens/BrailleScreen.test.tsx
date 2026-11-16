import { act, fireEvent, render, screen } from '@testing-library/react-native';

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

  it('says what it left out', async () => {
    await show();
    await fireEvent.changeText(screen.getByLabelText('Text to show in braille'), 'a€');
    expect(screen.getByText(/No braille here for “€”/)).toBeTruthy();
  });
});
