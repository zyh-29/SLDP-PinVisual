import { act, renderHook } from '@testing-library/react-native';

import { createEmptyPattern, getPin, type Pattern, togglePin } from '@/domain/pattern';
import { usePinEdits } from '../usePinEdits';

jest.mock('@/voice/announce', () => ({ announce: jest.fn() }));

const auto = togglePin(createEmptyPattern(2, 2), 0, 0);
const pictureA = { name: 'A' };
const pictureB = { name: 'B' };

type Props = { picture: object | null; result: Pattern | null };
const setup = (initial: Props) =>
  renderHook(({ picture, result }: Props) => usePinEdits(picture, result), { initialProps: initial });

describe('usePinEdits', () => {
  it('starts locked, showing the automatic pins', async () => {
    const { result } = await setup({ picture: pictureA, result: auto });
    expect(result.current.unlocked).toBe(false);
    expect(result.current.shown).toBe(auto);
  });

  it('ignores pin taps while locked', async () => {
    const { result } = await setup({ picture: pictureA, result: auto });
    await act(() => result.current.togglePinAt(1, 1));
    expect(result.current.shown).toBe(auto);
    expect(result.current.edited).toBe(false);
  });

  it('lets the user change pins once unlocked, and reset them to the picture', async () => {
    const { result } = await setup({ picture: pictureA, result: auto });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));
    expect(result.current.edited).toBe(true);
    expect(getPin(result.current.shown!, 1, 1)).toBe(1);

    await act(() => result.current.resetPins());
    expect(result.current.shown).toBe(auto);
    expect(result.current.unlocked).toBe(true);
  });

  it('keeps edits when locked again', async () => {
    const { result } = await setup({ picture: pictureA, result: auto });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));
    await act(() => result.current.toggleLock());
    expect(result.current.unlocked).toBe(false);
    expect(getPin(result.current.shown!, 1, 1)).toBe(1);
  });

  it('drops edits and locks again for a new picture', async () => {
    const { result, rerender } = await setup({ picture: pictureA, result: auto });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));
    await rerender({ picture: pictureB, result: auto });
    expect(result.current.unlocked).toBe(false);
    expect(result.current.shown).toBe(auto);
  });

  it('forgets everything on clear', async () => {
    const { result } = await setup({ picture: pictureA, result: auto });
    await act(() => result.current.toggleLock());
    await act(() => result.current.togglePinAt(1, 1));
    await act(() => result.current.clear());
    expect(result.current.unlocked).toBe(false);
    expect(result.current.shown).toBe(auto);
  });
});
