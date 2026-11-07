import { act, renderHook } from '@testing-library/react-native';

import { createEmptyPattern, type Pattern } from '@/domain/pattern';
import { SETTLE_TIMEOUT_MS, useSettledPins } from '../useSettledPins';

const pins = createEmptyPattern(2, 2);

type Props = { settled: boolean; uri: string | undefined; shown: Pattern | null };
const setup = (initial: Props) =>
  renderHook(({ settled, uri, shown }: Props) => useSettledPins(settled, uri, shown), { initialProps: initial });

describe('useSettledPins', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('answers at once for a picture that has already settled', async () => {
    const { result } = await setup({ settled: true, uri: 'a', shown: pins });
    await expect(result.current('a')).resolves.toBe(pins);
  });

  it('waits until the picture settles', async () => {
    const { result, rerender } = await setup({ settled: false, uri: 'a', shown: null });
    const waiting = result.current('a');
    await rerender({ settled: true, uri: 'a', shown: pins });
    await expect(waiting).resolves.toBe(pins);
  });

  it('keeps waiting while a different picture settles', async () => {
    const { result, rerender } = await setup({ settled: false, uri: 'a', shown: null });
    let answer: Pattern | null | undefined;
    void result.current('b').then((p) => (answer = p));
    await rerender({ settled: true, uri: 'a', shown: pins });
    expect(answer).toBeUndefined();
    await rerender({ settled: true, uri: 'b', shown: pins });
    await act(async () => {});
    expect(answer).toBe(pins);
  });

  it('gives up with null when the picture never settles', async () => {
    const { result } = await setup({ settled: false, uri: 'a', shown: null });
    const waiting = result.current('a');
    await act(() => jest.advanceTimersByTime(SETTLE_TIMEOUT_MS));
    await expect(waiting).resolves.toBeNull();
  });
});
