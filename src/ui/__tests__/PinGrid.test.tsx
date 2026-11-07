import { fireEvent, render, screen } from '@testing-library/react-native';

import { createEmptyPattern, togglePin } from '@/domain/pattern';
import { PinGrid } from '../PinGrid';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

// 2 x 3 grid with the top-left and bottom-right pins raised.
const pattern = togglePin(togglePin(createEmptyPattern(2, 3), 0, 0), 1, 2);

describe('PinGrid for screen readers', () => {
  it('announces every editable pin by row, column and state', async () => {
    await render(<PinGrid pattern={pattern} onToggle={() => {}} cellSize={40} />);
    const pins = screen.getAllByRole('button');
    expect(pins).toHaveLength(6);
    expect(screen.getByLabelText('Row 1, column 1')).toHaveAccessibilityValue({ text: 'raised' });
    expect(screen.getByLabelText('Row 1, column 2')).toHaveAccessibilityValue({ text: 'lowered' });
    expect(screen.getByLabelText('Row 2, column 3')).toHaveAccessibilityValue({ text: 'raised' });
    expect(screen.getByLabelText('Row 1, column 1').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Row 1, column 2').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('tells each pin which way a double tap moves it', async () => {
    await render(<PinGrid pattern={pattern} onToggle={() => {}} cellSize={40} />);
    expect(screen.getByLabelText('Row 1, column 1').props.accessibilityHint).toMatch(/lower this pin/);
    expect(screen.getByLabelText('Row 1, column 2').props.accessibilityHint).toMatch(/raise this pin/);
  });

  it('reports the tapped pin', async () => {
    const onToggle = jest.fn();
    await render(<PinGrid pattern={pattern} onToggle={onToggle} cellSize={40} />);
    await fireEvent.press(screen.getByLabelText('Row 2, column 1'));
    expect(onToggle).toHaveBeenCalledWith(1, 0);
  });

  it('marks pins disabled while editing is off', async () => {
    await render(<PinGrid pattern={pattern} onToggle={() => {}} cellSize={40} disabled />);
    expect(screen.getByLabelText('Row 1, column 1')).toBeDisabled();
  });

  it('reads a view-only grid as one picture with a description', async () => {
    await render(<PinGrid pattern={pattern} cellSize={20} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const image = screen.getByRole('image');
    expect(image.props.accessibilityLabel).toMatch(/^Pin preview, 2 rows by 3 columns\./);
  });

  it('draws editable pins at a tappable size before it knows its width', async () => {
    await render(<PinGrid pattern={pattern} onToggle={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });

  it('draws a view-only grid once it knows its width', async () => {
    const { root } = await render(<PinGrid pattern={pattern} />);
    expect(screen.queryByRole('image')).toBeNull();
    await fireEvent(root!, 'layout', { nativeEvent: { layout: { width: 300, height: 200 } } });
    expect(screen.getByRole('image')).toBeTruthy();
  });
});
