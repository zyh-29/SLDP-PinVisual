import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { GRID } from '@/config/hardware';
import { DeviceProvider } from '@/state/DeviceProvider';
import { PatternProvider } from '@/state/PatternProvider';
import { VoiceProvider } from '@/voice/VoiceProvider';
import ImageScreen from '@/app/image/index';

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
  usePathname: () => '/image',
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const showImage = () =>
  render(
    <DeviceProvider>
      <PatternProvider>
        <VoiceProvider>
          <ImageScreen />
        </VoiceProvider>
      </PatternProvider>
    </DeviceProvider>,
  );

const drawEquation = async (text: string) => {
  await fireEvent.changeText(screen.getByLabelText('Equation'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Draw' }));
  // Let the conversion's effects settle.
  await act(async () => {});
};

describe('Image tab', () => {
  it('starts by offering a photo or an equation', async () => {
    await showImage();
    expect(screen.getByRole('button', { name: /^Choose Photo/ })).toBeTruthy();
    expect(screen.getByLabelText('Equation')).toBeTruthy();
  });

  it('turns a typed equation into pins, locked to the picture', async () => {
    await showImage();
    await drawEquation('y = x');
    expect(screen.getByRole('header', { name: 'WHAT THE PINS SEE' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear Image' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Auto Crop' })).toBeDisabled();
    // Locked: the result grid is a single picture, not separate pin buttons.
    expect(screen.queryAllByLabelText(/^Row \d+, column \d+$/)).toHaveLength(0);
  });

  it('shows why an equation could not be drawn', async () => {
    await showImage();
    await drawEquation('y = foo');
    expect(screen.getByText(/Unknown name “foo”/)).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'WHAT THE PINS SEE' })).toBeNull();
    expect(screen.getByLabelText('Equation')).toBeTruthy();
  });

  it('lets the user edit pins once unlocked, then goes back to the start on Clear Image', async () => {
    await showImage();
    await drawEquation('y = x');
    await fireEvent.press(screen.getByRole('button', { name: 'Pins locked' }));
    expect(screen.getAllByLabelText(/^Row \d+, column \d+$/)).toHaveLength(GRID.rows * GRID.cols);

    await fireEvent.press(screen.getByRole('button', { name: 'Clear Image' }));
    expect(screen.queryByRole('header', { name: 'WHAT THE PINS SEE' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Choose Photo/ })).toBeTruthy();
  });
});
