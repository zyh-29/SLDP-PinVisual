import { fireEvent, render, screen } from '@testing-library/react-native';

import { GRID } from '@/config/hardware';
import { DeviceProvider } from '@/state/DeviceProvider';
import { PatternProvider } from '@/state/PatternProvider';
import { VoiceProvider } from '@/voice/VoiceProvider';
import DisplayScreen from '@/app/(display)/index';

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
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), push: jest.fn(), back: jest.fn() },
  useFocusEffect: jest.fn(),
  usePathname: () => '/',
}));

const showDisplay = () =>
  render(
    <DeviceProvider>
      <PatternProvider>
        <VoiceProvider>
          <DisplayScreen />
        </VoiceProvider>
      </PatternProvider>
    </DeviceProvider>,
  );

const total = GRID.rows * GRID.cols;

describe('Display tab', () => {
  it('shows one labelled button per pin, all lowered at first', async () => {
    await showDisplay();
    const pins = screen.getAllByLabelText(/^Row \d+, column \d+$/);
    expect(pins).toHaveLength(total);
    pins.forEach((pin) => expect(pin).toHaveAccessibilityValue({ text: 'lowered' }));
    expect(screen.getByText(new RegExp(`0 of ${total} raised`))).toBeTruthy();
  });

  it('raises a pin when tapped and counts it', async () => {
    await showDisplay();
    await fireEvent.press(screen.getByLabelText('Row 1, column 1'));
    expect(screen.getByLabelText('Row 1, column 1')).toHaveAccessibilityValue({ text: 'raised' });
    expect(screen.getByText(new RegExp(`1 of ${total} raised`))).toBeTruthy();
  });

  it('clears the preview with Clear Grid', async () => {
    await showDisplay();
    await fireEvent.press(screen.getByLabelText('Row 2, column 3'));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear Grid' }));
    expect(screen.getByLabelText('Row 2, column 3')).toHaveAccessibilityValue({ text: 'lowered' });
  });

  it('explains board actions are unavailable with no board connected', async () => {
    await showDisplay();
    expect(screen.getByRole('button', { name: /No board connected/ })).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Send Pattern' });
    expect(send).toBeDisabled();
    expect(send.props.accessibilityHint).toMatch(/no board connected/);
    expect(screen.getByRole('button', { name: 'Reset Physical Pins' })).toBeDisabled();
  });
});
