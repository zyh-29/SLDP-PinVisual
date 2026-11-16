import { fireEvent, render, screen } from '@testing-library/react-native';

import { ImageCropControls } from '../ImageCropControls';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

const show = async (canAutoCrop: boolean) => {
  const h = { onAutoCrop: jest.fn(), onClear: jest.fn() };
  await render(<ImageCropControls canAutoCrop={canAutoCrop} {...h} />);
  return h;
};

describe('ImageCropControls', () => {
  it('offers Auto Crop only after the user cropped or tapped', async () => {
    const h = await show(false);
    fireEvent.press(screen.getByText('Auto Crop'));
    expect(h.onAutoCrop).not.toHaveBeenCalled();
  });

  it('crops automatically again, and clears the graph', async () => {
    const h = await show(true);
    fireEvent.press(screen.getByText('Auto Crop'));
    fireEvent.press(screen.getByText('Clear Graph'));
    expect(h.onAutoCrop).toHaveBeenCalled();
    expect(h.onClear).toHaveBeenCalled();
  });
});
