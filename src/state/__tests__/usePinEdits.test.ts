import { act, renderHook } from '@testing-library/react-native';

import { createEmptyPattern, getPin, type Pattern, togglePin } from '@/domain/pattern';
import { usePinEdits } from '../usePinEdits';

jest.mock('@/voice/announce', () => ({ announce: jest.fn() }));

const auto = togglePin(createEmptyPattern(2, 2), 0, 0);
const pictureA = { name: 'A' };
const pictureB = { name: 'B' };

type Props = { picture: object | null; result: Pattern | null; live: boolean };
const setup = (initial: Props) =>
  renderHook(({ picture, result, live }: Props) => usePinEdits(picture, result, live), { initialProps: initial });

describe('usePinEdits', () => {
  it('starts locked, showing the automatic pins', async () => {
    const { result } = await setup({ picture: pictureA, result: auto, live: false });
    expect(result.current.unlocked).toBe(false);
    expect(result.current.shown).toBe(auto);
  });

  it('ignores pin taps while locked', async () => {
    const { result } = await setup({ picture: pictureA, result: auto, live: false });
    await act(() => result.current.togglePinAt(1, 1));
    expect(result.current.shown).toBe(auto);
    expect(result.current.edited).toBe(false);
  });

  it('lets the user change pins once unlocked, and reset them to the picture', async () => {
    const { result } = await setup({ picture: pictureA, result: auto, live: false });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));
    expect(result.current.edited).toBe(true);
    expect(getPin(result.current.shown!, 1, 1)).toBe(1);

    await act(() => result.current.resetPins());
    expect(result.current.shown).toBe(auto);
    expect(result.current.unlocked).toBe(true);
  });

  it('keeps edits when locked again', async () => {
    const { result } = await setup({ picture: pictureA, result: auto, live: false });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));
    await act(() => result.current.toggleLock());
    expect(result.current.unlocked).toBe(false);
    expect(getPin(result.current.shown!, 1, 1)).toBe(1);
  });

  it('drops edits and locks again for a new picture', async () => {
    const { result, rerender } = await setup({ picture: pictureA, result: auto, live: false });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));
    await rerender({ picture: pictureB, result: auto, live: false });
    expect(result.current.unlocked).toBe(false);
    expect(result.current.shown).toBe(auto);
  });

  it('while live, keeps edits across frames until the automatic pins change', async () => {
    const { result, rerender } = await setup({ picture: pictureA, result: auto, live: true });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));

    // A new frame with the same automatic pins: the edit stays.
    await rerender({ picture: pictureB, result: togglePin(createEmptyPattern(2, 2), 0, 0), live: true });
    expect(result.current.edited).toBe(true);

    // The view changed enough to change the pins: start over.
    await rerender({ picture: { name: 'C' }, result: createEmptyPattern(2, 2), live: true });
    expect(result.current.edited).toBe(false);
    expect(result.current.unlocked).toBe(false);
  });

  it('forgets everything on clear', async () => {
    const { result } = await setup({ picture: pictureA, result: auto, live: false });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));
    await act(() => result.current.clear());
    expect(result.current.unlocked).toBe(false);
    expect(result.current.shown).toBe(auto);
  });
});
