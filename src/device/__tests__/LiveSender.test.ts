import { createEmptyPattern, type Pattern, togglePin } from '@/domain/pattern';
import type { CommandResult } from '@/protocol/CommandClient';
import { LiveSender } from '../LiveSender';

/** A fake board: each send resolves when `finish()` is called (or at once with `instant`). */
function board(instant = false) {
  const sent: Pattern[] = [];
  let pending: ((r: CommandResult) => void) | null = null;
  const sink = {
    isBusy: false,
    sendPattern(p: Pattern) {
      sent.push(p);
      sink.isBusy = true;
      return new Promise<CommandResult>((resolve) => {
        const done = (r: CommandResult) => {
          sink.isBusy = false;
          resolve(r);
        };
        if (instant) done({ ok: true, commandId: sent.length, attempts: 1 });
        else pending = done;
      });
    },
  };
  const finish = async (ok = true) => {
    const p = pending;
    pending = null;
    p?.(ok ? { ok: true, commandId: sent.length, attempts: 1 } : { ok: false, commandId: null, attempts: 3, failure: 'timeout', message: 'No answer' });
    await Promise.resolve();
    await Promise.resolve();
  };
  return { sink, sent, finish };
}

const a = createEmptyPattern(5, 8);
const b = togglePin(a, 1, 1);
const c = togglePin(b, 2, 2);

describe('sending live pins to the board', () => {
  let t = 0;
  beforeEach(() => {
    jest.useFakeTimers();
    t = 0;
  });
  afterEach(() => jest.useRealTimers());
  const clock = () => t;
  const advance = async (ms: number) => {
    t += ms;
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  };

  it('sends a change once, and skips pins the board already shows', async () => {
    const { sink, sent, finish } = board();
    const s = new LiveSender(sink, undefined, 600, clock);
    s.push(b);
    expect(sent).toHaveLength(1);
    await finish();
    await advance(1000);
    s.push(togglePin(togglePin(b, 0, 0), 0, 0)); // same pins, another object
    await advance(1000);
    expect(sent).toHaveLength(1);
    expect(s.status.sent).toBe(1);
  });

  it('while a send is in flight, only the newest pattern goes next (the ones between are dropped)', async () => {
    const { sink, sent, finish } = board();
    const s = new LiveSender(sink, undefined, 600, clock);
    s.push(a);
    s.push(b);
    s.push(c);
    expect(sent).toEqual([a]);
    await advance(700);
    await finish();
    expect(sent).toEqual([a, c]);
  });

  it('never sends faster than the servos can follow', async () => {
    const { sink, sent } = board(true);
    const s = new LiveSender(sink, undefined, 600, clock);
    s.push(a);
    await advance(0);
    s.push(b);
    await advance(100);
    expect(sent).toHaveLength(1);
    await advance(600);
    expect(sent).toEqual([a, b]);
  });

  it('waits while another screen is sending, reports a failure, and stops cleanly', async () => {
    const { sink, sent, finish } = board();
    const statuses: (string | null)[] = [];
    const s = new LiveSender(sink, (st) => statuses.push(st.lastError), 600, clock);
    sink.isBusy = true;
    s.push(a);
    expect(sent).toHaveLength(0);
    sink.isBusy = false;
    await advance(400);
    expect(sent).toHaveLength(1);
    await finish(false);
    expect(statuses).toEqual(['No answer']);
    s.stop();
    s.push(b);
    await advance(2000);
    expect(sent).toHaveLength(1);
  });
});
