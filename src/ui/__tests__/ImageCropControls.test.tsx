import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { ImageCropControls } from '../ImageCropControls';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

type Props = ComponentProps<typeof ImageCropControls>;

const handlers = () => ({
  onAutoCrop: jest.fn(),
  onWholeView: jest.fn(),
  onClear: jest.fn(),
  onCapture: jest.fn(),
  onStopLive: jest.fn(),
  onFlip: jest.fn(),
  onPick: jest.fn(),
  onCamera: jest.fn(),
  onScreen: jest.fn(),
});

const show = (props: Partial<Props> = {}) => {
  const h = handlers();
  return render(
    <ImageCropControls live={null} dark={false} focusTrouble={0} loading={false} canAutoCrop={false} {...h} {...props} />,
  ).then(() => h);
};

const camera = { kind: 'camera' as const, canFlip: true, facing: 'environment' as const };

describe('ImageCropControls', () => {
  it('offers a new photo, the camera and the screen for a still picture', async () => {
    const h = await show();
    expect(screen.getByRole('button', { name: 'Clear Image' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Live camera' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share screen' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear Image' }));
    expect(h.onClear).toHaveBeenCalled();
  });

  it('leaves out sources this device lacks', async () => {
    await show({ onCamera: undefined, onScreen: undefined });
    expect(screen.getByRole('button', { name: 'Choose Another Photo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Live camera' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share screen' })).toBeNull();
  });

  it('disables Auto Crop until the user has cropped or tapped', async () => {
    await show();
    expect(screen.getByRole('button', { name: 'Auto Crop' })).toBeDisabled();
  });

  it('shows camera buttons while the camera is on', async () => {
    const h = await show({ live: camera, canAutoCrop: true });
    expect(screen.getByRole('button', { name: 'Capture photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Whole View' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear Image' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Flip Camera' }).props.accessibilityHint).toMatch(/front camera/);

    await fireEvent.press(screen.getByRole('button', { name: 'Stop Camera' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Auto Crop' }));
    expect(h.onStopLive).toHaveBeenCalled();
    expect(h.onAutoCrop).toHaveBeenCalled();
  });

  it('hides Flip Camera on a device with one camera', async () => {
    await show({ live: { ...camera, canFlip: false } });
    expect(screen.queryByRole('button', { name: 'Flip Camera' })).toBeNull();
  });

  it('shows Stop Sharing and Whole Screen while sharing a screen', async () => {
    await show({ live: { kind: 'screen', canFlip: false } });
    expect(screen.getByRole('button', { name: 'Stop Sharing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Whole Screen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Capture photo' })).toBeNull();
  });

  it('warns when the camera is in the dark, before a focus problem', async () => {
    await show({ live: camera, dark: true, focusTrouble: 2 });
    expect(screen.getByText('Too dark to see')).toBeTruthy();
    expect(screen.queryByText('Hard to focus')).toBeNull();
  });

  it('warns when the camera cannot focus', async () => {
    await show({ live: camera, focusTrouble: 2 });
    expect(screen.getByText('Hard to focus')).toBeTruthy();
  });

  it('ignores camera warnings once the camera is off', async () => {
    await show({ dark: true, focusTrouble: 2 });
    expect(screen.queryByText('Too dark to see')).toBeNull();
    expect(screen.queryByText('Hard to focus')).toBeNull();
  });

  it('warns about sharing the entire screen', async () => {
    await show({ live: { kind: 'screen', shared: 'screen', canFlip: false } });
    expect(screen.getByText('Sharing the entire screen')).toBeTruthy();
  });
});
